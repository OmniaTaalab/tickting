'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';
import { getRoundRobinAssignee } from './ticket_assignment';
import type { TicketEvent, UserProfile } from '@/lib/types';

/**
 * Approves a transfer or reassignment request.
 * Updates the ticket and all linked admin events to maintain consistency.
 */
export async function approveRequestAction(
    eventId: string, 
    actor: { userId: string, name: string },
    newAssigneeId?: string 
) {
    const db = adminDb;
    if (!db) return { success: false, message: 'Database configuration error' };

    try {
        const eventDoc = await db.collection('ticket-events').doc(eventId).get();
        if (!eventDoc.exists) return { success: false, message: 'Request not found' };
        
        const event = { id: eventDoc.id, ...eventDoc.data() } as TicketEvent;
        
        // --- AUTHORITY CHECK ---
        const actorDoc = await db.collection('users').doc(actor.userId).get();
        const actorData = actorDoc.data() as UserProfile;
        
        if (actorData.role !== 'Admin') {
            const ticketId = event.ticketId;
            const ticketDoc = await db.collection('tickets').doc(ticketId).get();
            const ticketData = ticketDoc.data();
            
            const ticketCampusId = ticketData?.campusId;
            const ticketDeptId = ticketData?.departmentId;
            const actorCampuses = actorData.campusIds || [];
            const actorDeptId = actorData.departmentId;

            // Managers must own both the department and the campus of the ticket to approve
            const isAuthorized = 
                (ticketCampusId && actorCampuses.includes(ticketCampusId)) && 
                (ticketDeptId && actorDeptId === ticketDeptId);
            
            if (!isAuthorized) {
                return { success: false, message: 'Permission denied: You can only manage requests for your assigned department and campuses.' };
            }
        }

        // Friendly handling for already processed requests
        if (event.status !== 'pending' && event.status) {
            revalidatePath('/requests');
            return { 
                success: true, 
                message: `This request was already ${event.status} by ${event.processedBy || 'another administrator'}.` 
            };
        }

        const { ticketId, requestId, eventType, requestMetadata } = event;

        if (eventType === 'TICKET_TRANSFER_REQUESTED' && requestMetadata?.toDepartmentId) {
            const newCategoryId = requestMetadata.toDepartmentId;
            const categoryDoc = await db.collection('departments').doc(newCategoryId).get();
            const categoryName = categoryDoc.exists ? categoryDoc.data()!.name : 'Unknown Category';
            
            // Execute automatic assignment in the new category
            const newAssignee = await getRoundRobinAssignee(newCategoryId);
            const newStatus = newAssignee ? 'Open' : 'Queue';

            await db.collection('tickets').doc(ticketId).update({
                departmentId: newCategoryId,
                departmentName: categoryName,
                assignedTo: newAssignee ? {
                    userId: newAssignee.id,
                    name: newAssignee.name,
                    email: newAssignee.email || '',
                    avatarUrl: newAssignee.avatarUrl,
                } : null,
                status: newStatus,
                updatedAt: FieldValue.serverTimestamp(),
            });

            await logSystemEvent({
                eventType: 'TICKET_TRANSFER_APPROVED',
                actor,
                message: `${actor.name} approved transfer of ticket #${ticketId.substring(0,4)} to ${categoryName}.`,
                details: { ticketId, requestId, approvedBy: actor.userId }
            });
        } 
        else if (eventType === 'TICKET_REASSIGN_REQUESTED') {
            let assigneeData = null;
            let status = 'Queue';

            if (newAssigneeId && newAssigneeId !== 'unassigned') {
                const userDoc = await db.collection('users').doc(newAssigneeId).get();
                if (userDoc.exists) {
                    const ud = userDoc.data()! as UserProfile;
                    assigneeData = {
                        userId: newAssigneeId,
                        name: ud.name,
                        email: ud.email || '',
                        avatarUrl: ud.avatarUrl || '',
                    };
                    status = 'Open';
                }
            }

            await db.collection('tickets').doc(ticketId).update({
                assignedTo: assigneeData,
                status: status,
                updatedAt: FieldValue.serverTimestamp(),
            });

            await logSystemEvent({
                eventType: 'TICKET_REASSIGN_APPROVED',
                actor,
                message: `${actor.name} approved reassignment for ticket #${ticketId.substring(0,4)} to ${assigneeData?.name || 'Unassigned'}.`,
                details: { ticketId, requestId, approvedBy: actor.userId, newAssigneeId }
            });
        }

        // Sync all admin notifications for this specific request globally
        if (requestId) {
            const relatedEvents = await db.collection('ticket-events').where('requestId', '==', requestId).get();
            const batch = db.batch();
            relatedEvents.docs.forEach(doc => {
                batch.update(doc.ref, { status: 'approved', read: true, processedBy: actor.name });
            });
            await batch.commit();
        } else {
            await db.collection('ticket-events').doc(eventId).update({ status: 'approved', read: true, processedBy: actor.name });
        }

        revalidatePath('/requests');
        revalidatePath(`/tickets/${ticketId}`);
        return { success: true, message: 'Action executed and ticket updated successfully' };
    } catch (e: any) {
        console.error("Approval Error:", e);
        return { success: false, message: e.message };
    }
}

/**
 * Rejects a ticket action request.
 */
export async function rejectRequestAction(eventId: string, actor: { userId: string, name: string }) {
    const db = adminDb;
    if (!db) return { success: false, message: 'Database error' };

    try {
        const eventDoc = await db.collection('ticket-events').doc(eventId).get();
        if (!eventDoc.exists) return { success: false, message: 'Request not found' };
        
        const event = { id: eventDoc.id, ...eventDoc.data() } as TicketEvent;
        const { requestId, ticketId } = event;

        // --- AUTHORITY CHECK ---
        const actorDoc = await db.collection('users').doc(actor.userId).get();
        const actorData = actorDoc.data() as UserProfile;
        
        if (actorData.role !== 'Admin') {
            const ticketDoc = await db.collection('tickets').doc(ticketId).get();
            const ticketData = ticketDoc.data();
            
            const ticketCampusId = ticketData?.campusId;
            const ticketDeptId = ticketData?.departmentId;
            const actorCampuses = actorData.campusIds || [];
            const actorDeptId = actorData.departmentId;

            const isAuthorized = 
                (ticketCampusId && actorCampuses.includes(ticketCampusId)) && 
                (ticketDeptId && actorDeptId === ticketDeptId);
            
            if (!isAuthorized) {
                return { success: false, message: 'Permission denied: You can only manage requests for your assigned department and campuses.' };
            }
        }

        if (event.status !== 'pending' && event.status) {
            revalidatePath('/requests');
            return { success: true, message: 'Request already handled.' };
        }

        if (requestId) {
            const relatedEvents = await db.collection('ticket-events').where('requestId', '==', requestId).get();
            const batch = db.batch();
            relatedEvents.docs.forEach(doc => {
                batch.update(doc.ref, { status: 'rejected', read: true, processedBy: actor.name });
            });
            await batch.commit();
        } else {
            await db.collection('ticket-events').doc(eventId).update({ status: 'rejected', read: true, processedBy: actor.name });
        }

        await logSystemEvent({
            eventType: 'REQUEST_REJECTED',
            actor,
            message: `${actor.name} rejected a ticket request for ticket #${ticketId.substring(0,4)}.`,
            details: { ticketId, requestId, rejectedBy: actor.userId }
        });

        revalidatePath('/requests');
        return { success: true, message: 'Request rejected' };
    } catch (e: any) {
        console.error("Rejection Error:", e);
        return { success: false, message: e.message };
    }
}
