'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import type { TicketStatus, UserProfile } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';

type ActionState = {
  success: boolean;
  message?: string;
};

const VALID_STATUSES: TicketStatus[] = [
  'Open', 'In Progress', 'Resolved', 'Closed', 'Queue',
  'Waiting', 'Duplicate', 'Ignored',
];
const FINISHED_STATUSES: TicketStatus[] = ['Resolved', 'Closed', 'Duplicate', 'Ignored'];
const ACTIVE_STATUSES: TicketStatus[] = ['Open', 'In Progress', 'Queue', 'Waiting'];

export async function bulkUpdateTicketsAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = adminDb;
  if (!db) return { success: false, message: 'Firebase Admin not configured.' };

  const ticketIds = [...new Set(
    formData.getAll('ticketIds').filter((value): value is string =>
      typeof value === 'string' && value.trim().length > 0
    ),
  )];
  const statusValue = formData.get('status');
  const status = typeof statusValue === 'string' && statusValue.length > 0
    ? statusValue as TicketStatus
    : null;
  const assigneeValue = formData.get('assigneeId');
  const assigneeId = typeof assigneeValue === 'string' && assigneeValue.length > 0
    ? assigneeValue
    : null;

  if (ticketIds.length === 0) {
    return { success: false, message: 'No tickets selected.' };
  }
  if (status && !VALID_STATUSES.includes(status)) {
    return { success: false, message: 'Invalid ticket status.' };
  }
  if (!status && !assigneeId) {
    return { success: false, message: 'No update operation specified.' };
  }
  // Toolbar submits one operation at a time. Reject conflicting operations.
  if (status && assigneeId) {
    return { success: false, message: 'Change the status or assignee in separate operations.' };
  }

  const updatesPayload: Record<string, any> = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  let newAssignee: UserProfile | null = null;

  if (status) {
    updatesPayload.status = status;
    if (status === 'Resolved') {
      updatesPayload.resolvedAt = FieldValue.serverTimestamp();
      updatesPayload.firstRespondedAt = FieldValue.serverTimestamp();
    } else if (status === 'Closed') {
      updatesPayload.closedAt = FieldValue.serverTimestamp();
      updatesPayload.firstRespondedAt = FieldValue.serverTimestamp();
    } else if (status === 'In Progress') {
      updatesPayload.firstRespondedAt = FieldValue.serverTimestamp();
    } else if (status === 'Queue') {
      updatesPayload.assignedTo = FieldValue.delete();
      updatesPayload.assignedAt = FieldValue.delete();
    }
    // Ignored is a terminal status excluded from SLA; do not set response/resolution
    // timestamps or clear assignment. The status itself is sufficient for exclusion.
  }

  if (assigneeId) {
    if (assigneeId === 'unassigned') {
      updatesPayload.assignedTo = FieldValue.delete();
      updatesPayload.assignedAt = FieldValue.delete();
      updatesPayload.status = 'Queue';
    } else {
      try {
        const userDoc = await db.collection('users').doc(assigneeId).get();
        if (!userDoc.exists) {
          return { success: false, message: 'Assignee not found.' };
        }
        newAssignee = { id: userDoc.id, ...userDoc.data() } as UserProfile;
        updatesPayload.assignedTo = {
          userId: userDoc.id,
          name: newAssignee.name,
          email: newAssignee.email || '',
          avatarUrl: newAssignee.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(newAssignee.name)}`,
        };
        updatesPayload.assignedAt = FieldValue.serverTimestamp();
      } catch (e) {
        console.error('Error fetching assignee:', e);
        return { success: false, message: 'Failed to fetch assignee data.' };
      }
    }
  }

  try {
    const ticketRefs = ticketIds.map(id => db.collection('tickets').doc(id));
    const BATCH_SIZE = 400;
    let updatedCount = 0;
    const updatedTicketIds: string[] = [];

    // Read and write in chunks to avoid oversized Firestore requests.
    for (let i = 0; i < ticketRefs.length; i += BATCH_SIZE) {
      const refs = ticketRefs.slice(i, i + BATCH_SIZE);
      const snapshots = await db.getAll(...refs);
      const batch = db.batch();
      let chunkUpdates = 0;

      for (const ticketDoc of snapshots) {
        if (!ticketDoc.exists) continue;
        const ticketData = ticketDoc.data() || {};
        const currentStatus = (ticketData.status || 'Open') as TicketStatus;
        const finalUpdates = { ...updatesPayload };

        // Explicit status updates always win; unassigning sets Queue.
        // Assigning a person alone must not reopen Ignored/Duplicate/finished tickets.
        const targetStatus = (finalUpdates.status || currentStatus) as TicketStatus;
        if (FINISHED_STATUSES.includes(currentStatus) && ACTIVE_STATUSES.includes(targetStatus)) {
          finalUpdates.reopenedCount = (ticketData.reopenedCount || 0) + 1;
          finalUpdates.lastReopenedAt = FieldValue.serverTimestamp();
        }
        batch.update(ticketDoc.ref, finalUpdates);
        chunkUpdates++;
        updatedTicketIds.push(ticketDoc.id);
      }

      if (chunkUpdates > 0) {
        await batch.commit();
        updatedCount += chunkUpdates;
      }
    }

    if (updatedCount === 0) {
      return { success: false, message: 'None of the selected tickets were found.' };
    }

    try {
      await logSystemEvent({
        eventType: 'TICKET_BULK_UPDATE',
        actor: { userId: 'admin', name: 'Admin/Manager' },
        message: `Bulk updated ${updatedCount} ticket(s)${status ? ` (Status: ${status})` : ''}${newAssignee ? ` (Assigned to: ${newAssignee.name})` : ''}.`,
        details: {
          ticketIds: updatedTicketIds,
          ticketCount: updatedCount,
          status: status || (assigneeId === 'unassigned' ? 'Queue' : null),
          assignedTo: newAssignee?.name || (assigneeId === 'unassigned' ? 'Unassigned' : null),
        },
      });
    } catch (error) {
      console.error('Bulk update audit logging failed:', error);
    }

    if (newAssignee) {
      try {
        for (let i = 0; i < updatedTicketIds.length; i += BATCH_SIZE) {
          const chunkIds = updatedTicketIds.slice(i, i + BATCH_SIZE);
          const notifBatch = db.batch();
          for (const tid of chunkIds) {
            const notifRef = db.collection('ticket-events').doc();
            notifBatch.set(notifRef, {
              ticketId: tid,
              eventType: 'TICKET_STATUS_CHANGED',
              title: 'New Ticket Assigned',
              message: 'Ticket was assigned to you via bulk update.',
              recipient: newAssignee.id,
              read: false,
              timestamp: FieldValue.serverTimestamp(),
            });
          }
          await notifBatch.commit();
        }
      } catch (error) {
        console.error('Bulk update notifications failed:', error);
      }
    }

    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    revalidatePath('/tasks');
    revalidatePath('/analytics');

    return {
      success: true,
      message: `Successfully updated ${updatedCount} ticket${updatedCount === 1 ? '' : 's'}.`,
    };
  } catch (error: any) {
    console.error('Bulk update failed:', error);
    return { success: false, message: error?.message || 'An unexpected error occurred during bulk update.' };
  }
}
