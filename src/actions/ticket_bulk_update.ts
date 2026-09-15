'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import type { TicketStatus, UserProfile } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { headers } from 'next/headers';
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


  if (ticketIds.length === 0) {
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
                avatarUrl: newAssignee.avatarUrl,
            };
            
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
    const batch = db.batch();
    
    // We need to fetch current tickets to check for REOPEN logic in bulk
    const ticketsSnap = await db.collection('tickets').where('__name__', 'in', ticketIds).get();
    
    ticketsSnap.docs.forEach(doc => {
      const ticketData = doc.data();
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
    });
    
    await batch.commit();

    await logSystemEvent({
      eventType: 'TICKET_BULK_UPDATE',
      actor: { userId: 'admin', name: 'Admin/Manager' },
      message: `Bulk updated ${ticketIds.length} ticket(s)${status ? ` (Status: ${status})` : ''}${newAssignee ? ` (Assigned to: ${newAssignee.name})` : ''}.`,
      details: {
        ticketIds,
        ticketCount: ticketIds.length,
        status: status || null,
        assignedTo: newAssignee?.name || null,
      },
    });

    if (newAssignee && assigneeId !== 'unassigned') {
        for (const tid of ticketIds) {
            await db.collection('ticket-events').add({
                ticketId: tid,
                eventType: 'TICKET_STATUS_CHANGED', 
                title: 'New Ticket Assigned',
                message: `A new ticket was assigned to you via bulk update.`,
                recipient: newAssignee.id,
                read: false,
                timestamp: FieldValue.serverTimestamp(),
            });
        }
    }

    revalidatePath('/tickets');
    return { success: true, message: `Updated ${ticketIds.length} tickets.` };

  } catch (error: any) {
    console.error("Bulk update failed:", error);
    return { success: false, message: error.message || "An unexpected error occurred." };
  }
}
