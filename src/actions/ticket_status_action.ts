'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { TicketStatus, UserProfile } from '@/lib/types';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

const VALID_STATUSES: TicketStatus[] = [
  'Open',
  'In Progress',
  'Resolved',
  'Closed',
  'Queue',
  'Waiting',
  'Duplicate',
  'Ignored',
];

const FINISHED_STATUSES: TicketStatus[] = [
  'Resolved',
  'Closed',
  'Duplicate',
  'Ignored',
];

export async function updateTicketStatusAction(
  ticketId: string,
  newStatus: TicketStatus,
  actor: { userId: string; name: string }
): Promise<{ success: boolean; message?: string }> {
  const db = adminDb;
  if (!db) return { success: false, message: 'Database error' };

  if (!ticketId || !VALID_STATUSES.includes(newStatus)) {
    return { success: false, message: 'Invalid ticket or status.' };
  }

  if (!actor?.userId || actor.userId === 'unknown' || actor.userId.startsWith('anon_')) {
    return { success: false, message: 'A valid staff account is required.' };
  }

  try {
    const actorDoc = await db.collection('users').doc(actor.userId).get();
    if (!actorDoc.exists) {
      return { success: false, message: 'Staff account not found.' };
    }
    const actorProfile = actorDoc.data() as UserProfile;
    if (!['Admin', 'Manager', 'Employee'].includes(actorProfile.role)) {
      return { success: false, message: 'Permission denied.' };
    }

    const ticketRef = db.collection('tickets').doc(ticketId);
    const docSnap = await ticketRef.get();
    if (!docSnap.exists) return { success: false, message: 'Ticket not found' };

    const ticket = docSnap.data()!;
    const previousStatus = (ticket.status || 'Open') as TicketStatus;

    if (
      actorProfile.role !== 'Admin' &&
      ticket.departmentId &&
      actorProfile.departmentId !== ticket.departmentId
    ) {
      return {
        success: false,
        message: `Permission denied: This ticket belongs to ${ticket.departmentName || 'another department'}. Transferred tickets are read-only.`,
      };
    }

    if (previousStatus === newStatus) {
      return { success: true, message: 'Ticket already has this status.' };
    }

    const updates: Record<string, any> = {
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const isCurrentlyFinished = FINISHED_STATUSES.includes(previousStatus);
    const isNewActive = !FINISHED_STATUSES.includes(newStatus);

    if (isCurrentlyFinished && isNewActive) {
      updates.reopenedCount = (ticket.reopenedCount || 0) + 1;
      updates.lastReopenedAt = FieldValue.serverTimestamp();
    }

    if (newStatus === 'Resolved') updates.resolvedAt = FieldValue.serverTimestamp();
    if (newStatus === 'Closed') updates.closedAt = FieldValue.serverTimestamp();
    if (newStatus === 'Ignored') updates.ignoredAt = FieldValue.serverTimestamp();

    if (newStatus === 'Queue') {
      updates.assignedTo = FieldValue.delete();
      updates.assignedAt = FieldValue.delete();
    }

    await ticketRef.update(updates);

    await logSystemEvent({
      eventType: 'TICKET_STATUS_CHANGED',
      actor: {
        userId: actor.userId,
        name: actorProfile.name || actor.name || 'Staff',
      },
      message: `${actorProfile.name || actor.name || 'Staff'} changed status of Ticket #${ticket.ticketNumber || ticketId.substring(0, 4)} from "${previousStatus}" to "${newStatus}".`,
      details: {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        previousStatus,
        newStatus,
      },
    });

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    revalidatePath('/analytics');

    return { success: true };
  } catch (error: any) {
    console.error('Error updating ticket status:', error);
    return { success: false, message: error?.message || 'Failed to update ticket status.' };
  }
}
