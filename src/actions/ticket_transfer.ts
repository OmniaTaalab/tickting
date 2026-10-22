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
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type TransferState = {
  success: boolean;
  message?: string;
  errors?: { form?: string[] };
};

/**
 * Recover the actual routing scope of a ticket, including email mailbox routes.
 * Never infer a route by mixing school/division/grades from separate routes.
 * The round-robin matcher handles ambiguous or missing scope by returning null.
 */
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
  // Preserve every complete route. Do not flatten their grades into one list.
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
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });
  if (!validated.success) {
    return { success: false, message: 'Validation failed. Please check the selected category.' };
  }
  const { ticketId, newCategoryId, actorId, actorName } = validated.data;

  try {
    // Check the current actor. This keeps the existing department restriction,
    // and also blocks an unknown actor from bypassing that restriction.
    const actorDoc = await db.collection('users').doc(actorId).get();
    if (!actorDoc.exists) return { success: false, message: 'User not found.' };
    const actorData = actorDoc.data() as UserProfile;

    const ticketRef = db.collection('tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) return { success: false, message: 'Ticket not found.' };
    const ticketData = ticketDoc.data() as Ticket;

    if (actorData.role !== 'Admin' &&
        ticketData.departmentId && actorData.departmentId !== ticketData.departmentId) {
      return {
        success: false,
        message: `Permission denied: This ticket belongs to ${ticketData.departmentName || 'another department'}. Transferred tickets are read-only for previous departments.`,
      };
    }

    const categoryDoc = await db.collection('departments').doc(newCategoryId).get();
    if (!categoryDoc.exists) return { success: false, message: 'Selected category does not exist.' };
    const categoryName = categoryDoc.data()!.name;

    // The ONLY automatic assignment path here goes through the validated
    // department + campus + school + division + grade (+ mailbox route) scope.
    const newAssignee = await getRoundRobinAssignee(
      ticketAssignmentScope(ticketData, newCategoryId)
    );
    const newStatus = newAssignee ? 'Open' : 'Queue';

    const transferId = `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const transferRecord: TicketTransferRecord = {
      id: transferId,
      ticketId,
      ticketNumber: ticketData.ticketNumber || ticketId.substring(0, 4),
      ticketTitle: ticketData.title || ticketData.subject || 'No Subject',
      ticketSubject: ticketData.subject || ticketData.title || 'No Subject',
      ticketDescription: ticketData.description || '',
      campusId: ticketData.campusId || null,
      campusName: ticketData.campusName || null,
      divisionId: ticketData.divisionId || null,
      divisionName: ticketData.divisionName || null,
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

    // Keep all original ticket routing fields unchanged. Only ownership changes.
    const updates: Record<string, any> = {
      departmentId: newCategoryId,
      departmentName: categoryName,
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
      message: `${actorName} transferred ticket #${ticketData.ticketNumber || ticketId.substring(0, 4)} from "${ticketData.departmentName}" to "${categoryName}".`,
      details: {
        ticketId, transferId,
        fromDepartmentId: ticketData.departmentId,
        fromDepartmentName: ticketData.departmentName,
        newCategoryId, newCategoryName: categoryName,
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
      message: `Successfully transferred to ${categoryName}. ${newAssignee ? `Assigned to ${newAssignee.name}.` : 'No eligible staff available, moved to Queue.'}`,
    };
  } catch (e: any) {
    console.error('Transfer Error:', e);
    return { success: false, message: 'An unexpected error occurred: ' + e.message };
  }
}
