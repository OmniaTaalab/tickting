'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';
import type { UserProfile } from '@/lib/types';

const RequestReassignSchema = z.object({
  ticketId: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type RequestReassignState = {
  success: boolean;
  message?: string;
};

export async function requestTicketReassignmentAction(
  prevState: RequestReassignState,
  formData: FormData
): Promise<RequestReassignState> {
  const db = adminDb;
  if (!db) return { success: false, message: 'Database configuration error.' };

  const validated = RequestReassignSchema.safeParse({
    ticketId: formData.get('ticketId'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validated.success) {
    return { success: false, message: 'Validation failed.' };
  }

  const { ticketId, actorId, actorName } = validated.data;

  try {
    // 1. Check for duplicate pending requests
    const existing = await db.collection('ticket-events')
        .where('ticketId', '==', ticketId)
        .where('eventType', '==', 'TICKET_REASSIGN_REQUESTED')
        .where('status', '==', 'pending')
        .limit(1)
        .get();

    if (!existing.empty) {
        return { success: false, message: 'A pending reassignment request already exists.' };
    }

    const ticketDoc = await db.collection('tickets').doc(ticketId).get();
    if (!ticketDoc.exists) return { success: false, message: 'Ticket not found.' };
    const ticketData = ticketDoc.data()!;
    const ticketCampusId = ticketData.campusId;

    const requestId = `req_re_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    // 2. Identify eligible recipients: Admins + Campus-specific Managers
    const adminsSnapshot = await db.collection('users').where('role', '==', 'Admin').get();
    const managersSnapshot = await db.collection('users')
        .where('departmentId', '==', ticketData.departmentId)
        .where('role', '==', 'Manager')
        .get();

    const recipientIds = new Set<string>();
    
    // Admins always receive
    adminsSnapshot.docs.forEach(d => recipientIds.add(d.id));

    // STRICT: Only managers of the correct campus receive the request
    managersSnapshot.docs.forEach(d => {
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
            eventType: 'TICKET_REASSIGN_REQUESTED',
            title: 'Reassignment Requested',
            message: `${actorName} requested to reassign Ticket #${ticketData.ticketNumber || ticketId.substring(0,4)}.`,
            recipient: rid,
            read: false,
            timestamp: FieldValue.serverTimestamp(),
            status: 'pending',
            requestId,
            requestMetadata: {
                requesterName: actorName,
                fromDepartmentId: ticketData.departmentId,
                fromDepartmentName: ticketData.departmentName,
                fromUserId: ticketData.assignedTo?.userId || null,
                fromUserName: ticketData.assignedTo?.name || 'Unassigned',
                campusId: ticketCampusId || null,
            }
        });
    }
    await batch.commit();

    await logSystemEvent({
      eventType: 'TICKET_REASSIGN_REQUESTED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} requested to reassign ticket.`,
      details: { ticketId, ticketNumber: ticketData.ticketNumber, requestId }
    });

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/requests');
    
    return { 
        success: true, 
        message: `Reassignment request sent to eligible administrators and managers.` 
    };
  } catch (e: any) {
    console.error('Request Reassign Error:', e);
    return { success: false, message: 'An unexpected error occurred: ' + e.message };
  }
}
