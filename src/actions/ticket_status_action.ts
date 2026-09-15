'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { TicketStatus } from '@/lib/types';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

export async function updateTicketStatusAction(
  ticketId: string, 
  newStatus: TicketStatus, 
  actor: { userId: string; name: string }
) {
  const db = adminDb;
  if (!db) return { success: false, message: 'Database error' };

  try {
    const ticketRef = db.collection('tickets').doc(ticketId);
    const docSnap = await ticketRef.get();
    if (!docSnap.exists) return { success: false, message: 'Ticket not found' };

    const ticket = docSnap.data()!;
    const previousStatus = ticket.status;

    const updates: Record<string, any> = {
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const isCurrentlyFinished = ['Resolved', 'Closed', 'Duplicate'].includes(previousStatus);
    const isNewActive = !['Resolved', 'Closed', 'Duplicate'].includes(newStatus);

    if (isCurrentlyFinished && isNewActive) {
      updates.reopenedCount = (ticket.reopenedCount || 0) + 1;
      updates.lastReopenedAt = FieldValue.serverTimestamp();
    }

    if (newStatus === 'Resolved') updates.resolvedAt = FieldValue.serverTimestamp();
    if (newStatus === 'Closed') updates.closedAt = FieldValue.serverTimestamp();

    if (newStatus === 'Queue') {
      updates.assignedTo = FieldValue.delete();
      updates.assignedAt = FieldValue.delete();
    }

    await ticketRef.update(updates);

    await logSystemEvent({
      eventType: 'TICKET_STATUS_CHANGED',
      actor,
      message: `${actor.name} changed status of Ticket #${ticket.ticketNumber || ticketId.substring(0, 4)} from "${previousStatus}" to "${newStatus}".`,
      details: {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        previousStatus,
        newStatus,
      },
    });

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/tickets');
    return { success: true };
  } catch (error: any) {
    console.error('Error updating ticket status:', error);
    return { success: false, message: error.message };
  }
}
