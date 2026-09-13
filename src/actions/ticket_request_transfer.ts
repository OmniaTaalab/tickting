'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';
import type { UserProfile } from '@/lib/types';

const RequestTransferSchema = z.object({
  ticketId: z.string().min(1),
  newCategoryId: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type RequestTransferState = {
  success: boolean;
  message?: string;
};

export async function requestTicketTransferAction(
  prevState: RequestTransferState,
  formData: FormData
): Promise<RequestTransferState> {
  const db = adminDb;
  if (!db) return { success: false, message: 'Database configuration error.' };

  const validated = RequestTransferSchema.safeParse({
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
    // 1. Check for existing pending request to avoid duplicates
    const existingRequests = await db.collection('ticket-events')
        .where('ticketId', '==', ticketId)
        .where('eventType', '==', 'TICKET_TRANSFER_REQUESTED')
        .where('status', '==', 'pending')
        .limit(1)
        .get();

    if (!existingRequests.empty) {
        return { 
            success: false, 
            message: 'A pending transfer request already exists for this ticket.' 
        };
    }

    const ticketDoc = await db.collection('tickets').doc(ticketId).get();
    if (!ticketDoc.exists) return { success: false, message: 'Ticket not found.' };
    const ticketData = ticketDoc.data()!;
    const ticketCampusId = ticketData.campusId;

    const targetCategoryDoc = await db.collection('departments').doc(newCategoryId).get();
    const targetCategoryName = targetCategoryDoc.exists ? targetCategoryDoc.data()!.name : 'Unknown Category';

    const requestId = `req_tr_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // 2. Identify eligible recipients: All Admins + CURRENT Department Managers ONLY
    const adminsSnapshot = await db.collection('users').where('role', '==', 'Admin').get();
    
    // Managers of the CURRENT department (Source)
    const sourceManagersSnapshot = await db.collection('users')
        .where('departmentId', '==', ticketData.departmentId)
        .where('role', '==', 'Manager')
        .get();

    const recipientIds = new Set<string>();
    
    // Admins always receive requests
    adminsSnapshot.docs.forEach(d => recipientIds.add(d.id));

    // STRICT: Only Managers of the SOURCE department who manage the specific campus receive the request
    sourceManagersSnapshot.docs.forEach(d => {
        const manager = d.data() as UserProfile;
        if (!ticketCampusId || (manager.campusIds && manager.campusIds.includes(ticketCampusId))) {
            recipientIds.add(d.id);
        }
    });
    
    const batch = db.batch();
    for (const rid of recipientIds) {
        const eventRef = db.collection('ticket-events').doc();
        batch.set(eventRef, {
            ticketId,
            eventType: 'TICKET_TRANSFER_REQUESTED',
            title: 'Transfer Requested',
            message: `${actorName} requested to move Ticket #${ticketData.ticketNumber || ticketId.substring(0,4)} to ${targetCategoryName}.`,
            recipient: rid,
            read: false,
            timestamp: FieldValue.serverTimestamp(),
            status: 'pending',
            requestId,
            requestMetadata: {
                requesterName: actorName,
                fromDepartmentId: ticketData.departmentId,
                fromDepartmentName: ticketData.departmentName,
                toDepartmentId: newCategoryId,
                toDepartmentName: targetCategoryName,
                fromUserId: ticketData.assignedTo?.userId || null,
                fromUserName: ticketData.assignedTo?.name || 'Unassigned',
                campusId: ticketCampusId || null,
            }
        });
    }
    await batch.commit();

    await logSystemEvent({
      eventType: 'TICKET_TRANSFER_REQUESTED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} requested to transfer ticket to category "${targetCategoryName}".`,
      details: { ticketId, targetCategoryId: newCategoryId, targetCategoryName, requestId }
    });

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/requests');
    
    return { 
        success: true, 
        message: `Transfer request sent to eligible administrators and current department managers.` 
    };
  } catch (e: any) {
    console.error('Request Transfer Error:', e);
    return { success: false, message: 'An unexpected error occurred: ' + e.message };
  }
}
