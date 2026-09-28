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
    // 1. Get actor profile to verify authority
    const actorDoc = await db.collection('users').doc(actorId).get();
    const actorData = actorDoc.exists ? (actorDoc.data() as UserProfile) : null;

    // 2. Get current ticket to know previous state
    const ticketDoc = await db.collection('tickets').doc(ticketId).get();
    if (!ticketDoc.exists) return { success: false, message: 'Ticket not found.' };
    const ticketData = ticketDoc.data() as Ticket;

    // Authorization check: Non-admins must belong to the CURRENT department of the ticket
    if (actorData && actorData.role !== 'Admin') {
      if (ticketData.departmentId && actorData.departmentId !== ticketData.departmentId) {
        return {
          success: false,
          message: `Permission denied: This ticket belongs to ${ticketData.departmentName || 'another department'}. Transferred tickets are read-only for previous departments.`,
        };
      }
    }

    // 3. Get the new category details
    const categoryDoc = await db.collection('departments').doc(newCategoryId).get();
    if (!categoryDoc.exists) return { success: false, message: 'Selected category does not exist.' };
    const categoryName = categoryDoc.data()!.name;
    const campusId = ticketData?.campusId;

    // 4. Get the next available assignee in that category via Round Robin
    const newAssignee = await getRoundRobinAssignee(newCategoryId, campusId);
    
    // If no one is available, the status becomes "Queue"
    const newStatus = newAssignee ? 'Open' : 'Queue';

    // 5. Construct comprehensive historical transfer record
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
      requestedBy: {
        userId: actorId,
        name: actorName,
      },
      approvedBy: {
        userId: actorId,
        name: actorName,
      },
      transferredAt: new Date().toISOString(),
    };

    const updates: Record<string, any> = {
      departmentId: newCategoryId,
      departmentName: categoryName,
      assignedTo: newAssignee ? {
        userId: newAssignee.id,
        name: newAssignee.name,
        email: newAssignee.email || '',
        avatarUrl: newAssignee.avatarUrl,
      } : null,
      assignedAt: newAssignee ? FieldValue.serverTimestamp() : null,
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
      transferHistory: FieldValue.arrayUnion(transferRecord),
    };

    // 6. Update the ticket and write to ticket-transfers collection in batch
    const batch = db.batch();
    batch.update(db.collection('tickets').doc(ticketId), updates);
    batch.set(db.collection('ticket-transfers').doc(transferId), {
      ...transferRecord,
      transferredAtTimestamp: FieldValue.serverTimestamp(),
    });
    await batch.commit();

    // 7. Log the event
    await logSystemEvent({
      eventType: 'TICKET_TRANSFERRED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} transferred ticket #${ticketData.ticketNumber || ticketId.substring(0, 4)} from "${ticketData.departmentName}" to "${categoryName}".`,
      details: { 
        ticketId, 
        transferId,
        fromDepartmentId: ticketData.departmentId,
        fromDepartmentName: ticketData.departmentName,
        newCategoryId, 
        newCategoryName: categoryName, 
        previousAssigneeId: ticketData.assignedTo?.userId || null,
        previousAssigneeName: ticketData.assignedTo?.name || 'Unassigned',
        newAssigneeId: newAssignee?.id || null,
        newAssigneeName: newAssignee?.name || 'In Queue'
      }
    });

    // 8. Notify the new assignee if present via in-app event
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
      message: `Successfully transferred to ${categoryName}. ${newAssignee ? `Assigned to ${newAssignee.name}.` : 'No staff available, moved to Queue.'}` 
    };
  } catch (e: any) {
    console.error('Transfer Error:', e);
    return { success: false, message: 'An unexpected error occurred: ' + e.message };
  }
}
