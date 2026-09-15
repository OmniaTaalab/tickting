'use server';

import { z } from 'zod';
import { adminDb, adminStorage } from '@/lib/firebaseAdmin';
import type { TicketStatus, TicketPriority, TicketChannel, Department } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getRoundRobinAssignee } from './ticket_assignment';
import { isWithinWorkingHours } from '@/lib/working-hours-utils';
import { logSystemEvent } from '@/lib/system-log';

const FormSchema = z.object({
  title: z.string().min(3, 'Title is required.').max(100, 'Title cannot exceed 100 characters.'),
  departmentId: z.string().min(1, 'Please select a category.'),
  schoolId: z.string().min(1, 'Please select a school.'),
  campusId: z.string().min(1, 'Please select a campus.'),
  divisionId: z.string().min(1, 'Please select a division.'),
  gradeId: z.string().min(1, 'Please select a grade.'),
  channel: z.enum(['Phone', 'Walk-in', 'Social Media', 'Form']),
  description: z.string().min(10, 'Description must be at least 10 characters.'),
  parentName: z.string().min(2, 'Parent Name is required.'),
  parentEmail: z.string().email('A valid email is required.'),
  studentBlbId: z.string().optional(),
  staffId: z.string().optional(),
  staffName: z.string().optional(),
  staffEmail: z.string().optional(),
  staffAvatar: z.string().optional(),
});

export type CreateTicketState = {
  errors?: {
    title?: string[];
    departmentId?: string[];
    schoolId?: string[];
    campusId?: string[];
    divisionId?: string[];
    gradeId?: string[];
    description?: string[];
    channel?: string[];
    parentName?: string[];
    parentEmail?: string[];
    form?: string[];
  };
  message?: string | null;
  success: boolean;
  ticketId?: string;
};

function generateRandom4Digit() {
  return Math.floor(1000 + Math.random() * 9000);
}

const MAILBOX_MAPPING: Record<string, string> = {
    "1st Settlement": "accounting.1stsettlement@nis-egypt.com",
    "El-Sherouk": "accounting.shorouk@nis-egypt.com",
    "6th October": "accounting.6thoctober@nis-egypt.com",
    "Nasr City": "Accounting.NasrCity@nis-egypt.com",
    "New Capital International": "accounting.newcapital.int@nis-egypt.com",
    "New Capital National": "accounting.newcapital.national@nis-egypt.com",
    "Porto Said": "accounting.portosaid@nis-egypt.com",
};

export async function createTicketAction(
  prevState: CreateTicketState,
  formData: FormData
): Promise<CreateTicketState> {
  const db = adminDb;
  const storage = adminStorage;
  console.log('🔥 Firebase Admin Check:', {
  adminDbExists: !!adminDb,
  adminStorageExists: !!adminStorage,
});
  if (!db || !storage) {
    return {
      success: false,
      errors: { form: ['Database connection error.'] },
      message: 'Server configuration error.',
    };
  }

  const validatedFields = FormSchema.safeParse({
    title: formData.get('title'),
    departmentId: formData.get('departmentId'),
    schoolId: formData.get('schoolId'),
    campusId: formData.get('campusId'),
    divisionId: formData.get('divisionId'),
    gradeId: formData.get('gradeId'),
    channel: formData.get('channel'),
    description: formData.get('description'),
    parentName: formData.get('parentName'),
    parentEmail: formData.get('parentEmail'),
    studentBlbId: formData.get('studentBlbId') || undefined,
    staffId: formData.get('staffId') || undefined,
    staffName: formData.get('staffName') || undefined,
    staffEmail: formData.get('staffEmail') || undefined,
    staffAvatar: formData.get('staffAvatar') || undefined,
  });

  if (!validatedFields.success) {
    return {
      success: false,
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Please check the form for errors.',
    };
  }

  const { 
    title, departmentId, schoolId, campusId, divisionId, gradeId,
    channel, description, parentName, parentEmail, studentBlbId,
    staffId, staffName, staffEmail, staffAvatar
  } = validatedFields.data;
  
  const attachments: string[] = [];
  const attachmentEntries = formData.getAll('attachments');
  
  for (const entry of attachmentEntries) {
    if (!entry || !(entry instanceof File)) continue;
    if (entry.size === 0) continue;

    try {
      const buffer = Buffer.from(await entry.arrayBuffer());
      const originalFileName = entry.name || 'attachment';
      const safeFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
      const fileName = `${Date.now()}_${crypto.randomUUID()}_${safeFileName}`;
      const filePath = `attachments/${fileName}`;

      const bucket = storage.bucket();
      const fileRef = bucket.file(filePath);
      const token = crypto.randomUUID();

      await fileRef.save(buffer, {
        resumable: false,
        contentType: entry.type || 'application/octet-stream',
        metadata: {
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });

      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
      attachments.push(downloadUrl);
    } catch (uploadError) {
      console.error(`File upload failed:`, uploadError);
    }
  }

  const finalSubject = title;
  let newTicketId = '';

  try {
    const [deptDoc, schoolDoc, campusDoc, divisionDoc, gradeDoc] = await Promise.all([
        db.collection('departments').doc(departmentId).get(),
        db.collection('schools').doc(schoolId).get(),
        db.collection('campuses').doc(campusId).get(),
        db.collection('divisions').doc(divisionId).get(),
        db.collection('grades').doc(gradeId).get(),
    ]);

    if (!deptDoc.exists) {
      return { success: false, message: 'Selected category does not exist.' };
    }

    const departmentData = deptDoc.data() as Department;
    const departmentName = departmentData.name || 'General';
    const schoolNameValue = schoolDoc.exists ? schoolDoc.data()?.name : 'N/A';
    const campusNameValue = campusDoc.exists ? campusDoc.data()?.name : 'N/A';
    const divisionNameValue = divisionDoc.exists ? divisionDoc.data()?.name : 'N/A';
    const gradeNameValue = gradeDoc.exists ? gradeDoc.data()?.name : 'N/A';

    const isNowWorking = isWithinWorkingHours(departmentData.workingHours);
    let assignedUser = null;
    let status: TicketStatus = 'Queue'; 

    if (isNowWorking) {
        assignedUser = await getRoundRobinAssignee(departmentId, campusId);
        if (assignedUser) status = 'Open';
    }

    const ticketNumber = generateRandom4Digit();
    const now = new Date();
    const mailboxEmail = campusNameValue ? MAILBOX_MAPPING[campusNameValue] : null;

    const finalPriority: TicketPriority = channel === 'Walk-in' ? 'High' : 'Normal';

    const ticketPayload = {
      ticketNumber,
      title,
      subject: finalSubject,
      description,
      status, 
      priority: finalPriority,
      channel: channel as TicketChannel,
      departmentId,
      departmentName,
      schoolId,
      schoolName: schoolNameValue || 'N/A', 
      campusId,
      campusName: campusNameValue || 'N/A', 
      divisionId,
      divisionName: divisionNameValue || 'N/A',
      gradeId,
      gradeName: gradeNameValue || 'N/A',
      parentName,
      parentEmail,
      studentBlbId: studentBlbId || null,
      mailboxEmail: mailboxEmail || null,
      createdBy: {
        userId: staffId || `anon_${Date.now()}`,
        name: staffName || parentName,
        email: staffEmail || parentEmail,
        avatarUrl: staffAvatar || `https://api.dicebear.com/9.x/initials/svg?seed=${(staffName || parentName).replace(/\s/g, '+')}`,
      },
      assignedTo: assignedUser ? {
        userId: assignedUser.id,
        name: assignedUser.name,
        email: assignedUser.email || '',
        avatarUrl: assignedUser.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${assignedUser.name.replace(/\s/g, '+')}`,
      } : null,
      assignedAt: assignedUser ? FieldValue.serverTimestamp() : null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      messages: [
        {
          id: String(generateRandom4Digit()),
          author: { 
              userId: staffId || `anon_${Date.now()}`, 
              name: staffName || parentName, 
              avatarUrl: staffAvatar || `https://api.dicebear.com/9.x/initials/svg?seed=${(staffName || parentName).replace(/\s/g, '+')}`
          },
          text: description,
          createdAt: now.toISOString(),
          attachments: attachments,
        },
      ],
      attachments: attachments,
    };

    const docRef = await db.collection('tickets').add(ticketPayload);
    newTicketId = docRef.id;

    await logSystemEvent({
      eventType: 'TICKET_CREATED',
      actor: { userId: staffId || 'visitor', name: staffName || parentName },
      message: `Ticket #${ticketNumber} "${title}" created by ${staffName || parentName} (${assignedUser ? `Assigned to ${assignedUser.name}` : 'Placed in Queue'}).`,
      details: {
        ticketId: docRef.id,
        ticketNumber,
        title,
        category: departmentName,
        departmentId: departmentId || null,
        schoolId: schoolId || null,
        campusId: campusId || null,
        divisionId: divisionId || null,
        gradeId: gradeId || null,
        channel,
        status,
        assignedTo: assignedUser ? assignedUser.name : null,
      },
    });

    if (assignedUser) {
      await db.collection('ticket-events').add({
        ticketId: docRef.id,
        eventType: 'TICKET_CREATED',
        title: 'New Ticket Assigned',
        message: `Ticket #${ticketNumber} assigned to you.`,
        recipient: assignedUser.id,
        read: false,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    revalidatePath('/tickets');
    revalidatePath('/dashboard');
  } catch (error: any) {
    if (error?.message === 'NEXT_REDIRECT' || error?.digest?.startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('Error creating ticket:', error);
    return { success: false, message: error?.message || 'Database error while saving ticket.' };
  }

  if (newTicketId) {
    redirect(`/tickets/${newTicketId}`);
  }
  
  return { success: true };
}
