'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import type { TicketStatus, UserProfile } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';

type ActionState = {
    success: boolean;
    message?: string;
}

export async function bulkUpdateTicketsAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = adminDb;
  if (!db) {
    return { success: false, message: "Firebase Admin not configured." };
  }
  
  const ticketIds = formData.getAll('ticketIds') as string[];
  const status = formData.get('status') as TicketStatus | null;
  const assigneeId = formData.get('assigneeId') as string | null;

  if (!ticketIds || ticketIds.length === 0) {
    return { success: false, message: "No tickets selected." };
  }

  const updatesPayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp()
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
      // SPECIFIC REQUIREMENT: Clear assignee if status is set to Queue
      updatesPayload.assignedTo = FieldValue.delete();
      updatesPayload.assignedAt = FieldValue.delete();
    }
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
            const rawData = userDoc.data();
            newAssignee = { id: userDoc.id, ...rawData } as UserProfile;
            updatesPayload.assignedTo = {
                userId: userDoc.id,
                name: newAssignee.name,
                email: newAssignee.email || '',
                avatarUrl: newAssignee.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(newAssignee.name)}`,
            };
            updatesPayload.assignedAt = FieldValue.serverTimestamp();
            
            if (!status) {
                updatesPayload.status = 'Open';
            }
        } catch (e) {
            console.error("Error fetching assignee:", e);
            return { success: false, message: 'Failed to fetch assignee data.' };
        }
    }
  }
  
  if (Object.keys(updatesPayload).length <= 1) { 
      return { success: false, message: "No update operation specified." };
  }

  try {
    // 1. Fetch tickets using db.getAll which avoids the Firestore 'in' 30-element query limitation
    const ticketRefs = ticketIds.map(id => db.collection('tickets').doc(id));
    const ticketSnapshots = await db.getAll(...ticketRefs);
    
    // 2. Perform updates in batches of 400 (Firestore maximum per batch is 500)
    const BATCH_SIZE = 400;
    let updatedCount = 0;

    for (let i = 0; i < ticketSnapshots.length; i += BATCH_SIZE) {
      const chunk = ticketSnapshots.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      for (const doc of chunk) {
        if (!doc.exists) continue;
        const ticketData = doc.data() || {};
        const currentStatus = ticketData.status || 'Open';
        const finalUpdates = { ...updatesPayload };

        // Reopen detection: Finished -> Active
        const isFinished = ['Resolved', 'Closed', 'Duplicate'].includes(currentStatus);
        const targetStatus = status || currentStatus;
        const isNewActive = ['Open', 'In Progress', 'Queue', 'Waiting'].includes(targetStatus);

        if (isFinished && isNewActive) {
            finalUpdates.reopenedCount = (ticketData.reopenedCount || 0) + 1;
            finalUpdates.lastReopenedAt = FieldValue.serverTimestamp();
        }

        batch.update(doc.ref, finalUpdates);
        updatedCount++;
      }

      await batch.commit();
    }

    // 3. System audit logging
    await logSystemEvent({
      eventType: 'TICKET_BULK_UPDATE',
      actor: { userId: 'admin', name: 'Admin/Manager' },
      message: `Bulk updated ${updatedCount} ticket(s)${status ? ` (Status: ${status})` : ''}${newAssignee ? ` (Assigned to: ${newAssignee.name})` : ''}.`,
      details: {
        ticketIds,
        ticketCount: updatedCount,
        status: status || null,
        assignedTo: newAssignee?.name || (assigneeId === 'unassigned' ? 'Unassigned' : null),
      },
    });

    // 4. Create in-app notifications in batched writes for the assignee
    if (newAssignee && assigneeId !== 'unassigned') {
        for (let i = 0; i < ticketIds.length; i += BATCH_SIZE) {
          const chunkIds = ticketIds.slice(i, i + BATCH_SIZE);
          const notifBatch = db.batch();

          for (const tid of chunkIds) {
            const notifRef = db.collection('ticket-events').doc();
            notifBatch.set(notifRef, {
                ticketId: tid,
                eventType: 'TICKET_STATUS_CHANGED', 
                title: 'New Ticket Assigned',
                message: `Ticket was assigned to you via bulk update.`,
                recipient: newAssignee.id,
                read: false,
                timestamp: FieldValue.serverTimestamp(),
            });
          }

          await notifBatch.commit();
        }
    }

    // 5. Revalidate cache
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    revalidatePath('/tasks');
    revalidatePath('/analytics');

    return { 
      success: true, 
      message: `Successfully updated ${updatedCount} ticket${updatedCount === 1 ? '' : 's'}.` 
    };

  } catch (error: any) {
    console.error("Bulk update failed:", error);
    return { success: false, message: error.message || "An unexpected error occurred during bulk update." };
  }
}
