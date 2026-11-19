'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { getRoundRobinAssignee } from './ticket_assignment';
import { revalidatePath } from 'next/cache';
import type { Ticket, UserProfile, TicketTransferRecord } from '@/lib/types';

const TransferSchema = z.object({
  ticketId: z.string().min(1),
  newCategoryId: z.string().min(1),
  campusId: z.string().optional().default(''),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type TransferState = {
  success: boolean;
  message?: string;
  errors?: { form?: string[] };
};

/** Preserve complete mailbox routes, without mixing separate routes. */
function ticketAssignmentScope(ticket: Ticket, departmentId: string) {
  const t = ticket as Ticket & {
    school?: string | null;
    division?: string | null;
    grade?: string | null;
    grades?: string[];
    allowedGrades?: string[];
    routingOptions?: Array<{ school: string; division: string; grades: string[] }>;
    originalRecipientEmail?: string | null;
  };
  const routes = Array.isArray(t.routingOptions) ? t.routingOptions : [];
  const routingOptions = routes.map(route => ({
    school: route.school,
    division: route.division,
    grades: Array.isArray(route.grades) ? route.grades : [],
  }));
  const grades = Array.isArray(t.grades) && t.grades.length > 0
    ? t.grades
    : (Array.isArray(t.allowedGrades) ? t.allowedGrades : []);
  return {
    departmentId,
    campusId: t.campusId || null,
    schoolId: t.schoolId || null,
    divisionId: t.divisionId || null,
    gradeId: t.gradeId || null,
    schoolName: t.schoolName || t.school || null,
    divisionName: t.divisionName || t.division || null,
    gradeName: t.gradeName || t.grade || null,
    grades,
    mailboxEmail: t.originalRecipientEmail || t.mailboxEmail || null,
    routingOptions,
  };
}

export async function transferTicketToCategoryAction(
  prevState: TransferState,
  formData: FormData
): Promise<TransferState> {
  const db = adminDb;
  if (!db) return { success: false, message: 'Database configuration error.' };

  const validated = TransferSchema.safeParse({
    ticketId: formData.get('ticketId'),
    newCategoryId: formData.get('newCategoryId'),
    campusId: formData.get('campusId') || '',
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });
  if (!validated.success) {
    return { success: false, message: 'Validation failed. Please check the selected category.' };
  }
  const { ticketId, newCategoryId, campusId: selectedCampusId, actorId, actorName } = validated.data;

  try {
    const actorDoc = await db.collection('users').doc(actorId).get();
    if (!actorDoc.exists) return { success: false, message: 'User not found.' };
    const actorData = actorDoc.data() as UserProfile;
    // Admin makes an immediate transfer; other roles use requestTicketTransferAction.
    if (actorData.role !== 'Admin') {
      return { success: false, message: 'A Manager or Employee must request transfer approval.' };
    }

    const ticketRef = db.collection('tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) return { success: false, message: 'Ticket not found.' };
    const ticketData = ticketDoc.data() as Ticket;

    const categoryDoc = await db.collection('departments').doc(newCategoryId).get();
    if (!categoryDoc.exists) return { success: false, message: 'Selected category does not exist.' };
    const categoryName = categoryDoc.data()!.name;

    const targetCampusId = selectedCampusId || ticketData.campusId || '';
    const campusChanged = !!selectedCampusId && selectedCampusId !== (ticketData.campusId || '');
    const campusDoc = targetCampusId ? await db.collection('campuses').doc(targetCampusId).get() : null;
    if (selectedCampusId && !campusDoc?.exists)
      return { success: false, message: 'Selected Campus does not exist.' };
    const targetCampusName = campusDoc?.data()?.name || ticketData.campusName || null;

    // Changing Campus invalidates the old academic route. An unchanged Campus retains it.
    const routingReset = campusChanged ? {
      schoolId: null, schoolName: null, school: null,
      divisionId: null, divisionName: null, division: null,
      gradeId: null, gradeName: null, grade: null,
      grades: [], allowedGrades: [], routingOptions: [],
    } : {};
    const ticketForAssignment = {
      ...ticketData,
      campusId: targetCampusId || null,
      campusName: targetCampusName,
      ...routingReset,
    } as Ticket;
    const newAssignee = await getRoundRobinAssignee(ticketAssignmentScope(ticketForAssignment, newCategoryId));
    const newStatus = newAssignee ? 'Open' : 'Queue';

    const transferId = `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const transferRecord: TicketTransferRecord = {
      id: transferId,
      ticketId,
      ticketNumber: ticketData.ticketNumber || ticketId.substring(0, 4),
      ticketTitle: ticketData.title || ticketData.subject || 'No Subject',
      ticketSubject: ticketData.subject || ticketData.title || 'No Subject',
      ticketDescription: ticketData.description || '',
      campusId: targetCampusId || null,
      campusName: targetCampusName,
      divisionId: ticketForAssignment.divisionId || null,
      divisionName: ticketForAssignment.divisionName || null,
      fromDepartmentId: ticketData.departmentId,
      fromDepartmentName: ticketData.departmentName || 'Previous Department',
      fromUser: ticketData.assignedTo ? {
        userId: ticketData.assignedTo.userId,
        name: ticketData.assignedTo.name,
        avatarUrl: ticketData.assignedTo.avatarUrl || '',
        email: ticketData.assignedTo.email || '',
      } : null,
      toDepartmentId: newCategoryId,
      toDepartmentName: categoryName,
      involvedDepartmentIds: [ticketData.departmentId, newCategoryId].filter(Boolean),
      toUser: newAssignee ? {
        userId: newAssignee.id,
        name: newAssignee.name,
        avatarUrl: newAssignee.avatarUrl || '',
        email: newAssignee.email || '',
      } : null,
      requestedBy: { userId: actorId, name: actorName },
      approvedBy: { userId: actorId, name: actorName },
      transferredAt: new Date().toISOString(),
    };

    const updates: Record<string, any> = {
      departmentId: newCategoryId,
      departmentName: categoryName,
      campusId: targetCampusId || null,
      campusName: targetCampusName,
      ...routingReset,
      assignedTo: newAssignee ? {
        userId: newAssignee.id,
        name: newAssignee.name,
        email: newAssignee.email || '',
        avatarUrl: newAssignee.avatarUrl || '',
      } : null,
      assignedAt: newAssignee ? FieldValue.serverTimestamp() : null,
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
      transferHistory: FieldValue.arrayUnion(transferRecord),
    };

    const batch = db.batch();
    batch.update(ticketRef, updates);
    batch.set(db.collection('ticket-transfers').doc(transferId), {
      ...transferRecord,
      transferredAtTimestamp: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    await logSystemEvent({
      eventType: 'TICKET_TRANSFERRED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} transferred ticket #${ticketData.ticketNumber || ticketId.substring(0, 4)} from "${ticketData.departmentName}" to "${categoryName}"${targetCampusName ? ` / ${targetCampusName}` : ''}.`,
      details: {
        ticketId, transferId,
        fromDepartmentId: ticketData.departmentId,
        fromDepartmentName: ticketData.departmentName,
        newCategoryId, newCategoryName: categoryName,
        oldCampusId: ticketData.campusId || null,
        newCampusId: targetCampusId || null,
        previousAssigneeId: ticketData.assignedTo?.userId || null,
        previousAssigneeName: ticketData.assignedTo?.name || 'Unassigned',
        newAssigneeId: newAssignee?.id || null,
        newAssigneeName: newAssignee?.name || 'In Queue',
      },
    });

    if (newAssignee) {
      await db.collection('ticket-events').add({
        ticketId,
        eventType: 'TICKET_STATUS_CHANGED',
        title: 'New Transferred Ticket',
        message: `Ticket #${ticketData.ticketNumber || ticketId.substring(0, 4)} was transferred to your department (${categoryName}) and assigned to you.`,
        recipient: newAssignee.id,
        read: false,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/tickets');
    revalidatePath('/track-history');
    revalidatePath('/dashboard');
    return {
      success: true,
      message: `Successfully transferred to ${categoryName}${targetCampusName ? ` / ${targetCampusName}` : ''}. ${newAssignee ? `Assigned to ${newAssignee.name}.` : 'No eligible staff available, moved to Queue.'}`,
    };
  } catch (e: any) {
    console.error('Transfer Error:', e);
    return { success: false, message: 'An unexpected error occurred: ' + e.message };
  }
}
