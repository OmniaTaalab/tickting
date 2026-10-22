'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';
import { getRoundRobinAssignee } from './ticket_assignment';
import type { TicketEvent, UserProfile, Ticket, TicketTransferRecord } from '@/lib/types';

/**
 * Validate a specifically selected employee against the ticket's actual scope.
 * Manual reassignment does NOT require Available/activeSessionId: managers may
 * allocate work for later. Scope is still mandatory and never bypassed.
 */
async function employeeCoversTicketScope(
    db: NonNullable<typeof adminDb>,
    employee: UserProfile,
    ticket: Ticket
): Promise<boolean> {
    const t = ticket as any;
    const e = employee as any;
    const values = (...inputs: unknown[]): string[] => inputs.flatMap((input) =>
        Array.isArray(input) ? input : [input]
    ).filter((input): input is string => typeof input === 'string' && input.trim().length > 0)
     .map((input) => input.trim());
    const normalized = (v: unknown) => String(v || '').normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

    if (e.role !== 'Employee' || !t.departmentId || e.departmentId !== t.departmentId) return false;
    if (!t.campusId || !values(e.campusIds, e.campusId).includes(t.campusId)) return false;

    const routes = Array.isArray(t.routingOptions) ? t.routingOptions : [];
    const requestedSchool = t.schoolName || t.school;
    const requestedDivision = t.divisionName || t.division;
    const requestedGrade = t.gradeName || t.grade;
    const candidates = routes.filter((r: any) =>
        (!requestedSchool || normalized(r.school) === normalized(requestedSchool)) &&
        (!requestedDivision || normalized(r.division) === normalized(requestedDivision)) &&
        (!requestedGrade || values(r.grades).some(g => normalized(g) === normalized(requestedGrade)))
    );
    // No mixing of grades from different routes when one mailbox spans many routes.
    if (routes.length > 0 && candidates.length !== 1) return false;
    const route = candidates.length === 1 ? candidates[0] : null;

    const schoolName = requestedSchool || route?.school;
    const divisionName = requestedDivision || route?.division;
    const gradeNames = t.gradeId ? [] : requestedGrade ? [requestedGrade] :
        route ? values(route.grades) : values(t.grades, t.allowedGrades);

    // All required dimensions must be known: absence must not mean "match all".
    if (!t.schoolId && !schoolName) return false;
    if (!t.divisionId && !divisionName) return false;
    if (!t.gradeId && gradeNames.length === 0) return false;

    const [schools, divisions, grades] = await Promise.all([
        db.collection('schools').get(),
        db.collection('divisions').get(),
        db.collection('grades').get(),
    ]);
    const lookup = (snap: FirebaseFirestore.QuerySnapshot, name: string): string[] =>
        snap.docs.filter(d => {
            const v = d.data() as any;
            return values(v.name, v.nameEn, v.label, v.title, v.code, v.displayName)
                .some(text => normalized(text) === normalized(name));
        }).map(d => d.id);

    const matchDimension = (
        agentIds: unknown, agentNames: unknown, targetId: unknown,
        targetName: unknown, catalog: FirebaseFirestore.QuerySnapshot
    ): boolean => {
        const ids = values(agentIds);
        const names = values(agentNames).map(normalized);
        const id = typeof targetId === 'string' ? targetId.trim() : '';
        const name = typeof targetName === 'string' ? targetName.trim() : '';
        // An explicit ID is authoritative; never override it with a conflicting name.
        if (id) return ids.includes(id);
        if (!name) return false;
        return lookup(catalog, name).some(target => ids.includes(target)) ||
            names.includes(normalized(name));
    };

    if (!matchDimension(e.schoolIds, values(e.schoolNames, e.schools, e.schoolName, e.school),
        t.schoolId, schoolName, schools)) return false;
    if (!matchDimension(e.divisionIds, values(e.divisionNames, e.divisions, e.divisionName, e.division),
        t.divisionId, divisionName, divisions)) return false;

    if (t.gradeId) return matchDimension(e.gradeIds, values(e.gradeNames, e.grades, e.gradeName, e.grade),
        t.gradeId, requestedGrade, grades);
    return gradeNames.some(name => matchDimension(
        e.gradeIds, values(e.gradeNames, e.grades, e.gradeName, e.grade), null, name, grades
    ));
}

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
        
        const ticketId = event.ticketId;
        const ticketDoc = await db.collection('tickets').doc(ticketId).get();
        if (!ticketDoc.exists) return { success: false, message: 'Ticket not found' };
        const ticketData = ticketDoc.data() as Ticket;

        if (actorData.role !== 'Admin') {
            const ticketCampusId = ticketData?.campusId;
            const ticketDeptId = ticketData?.departmentId;
            const actorCampuses = actorData.campusIds || [];
            const actorDeptId = actorData.departmentId;

            // Managers must own both the department and the campus of the ticket to approve
            const isAuthorized = 
                (!ticketCampusId || actorCampuses.length === 0 || actorCampuses.includes(ticketCampusId)) && 
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

        const { requestId, eventType, requestMetadata } = event;

        if (eventType === 'TICKET_TRANSFER_REQUESTED' && requestMetadata?.toDepartmentId) {
            const newCategoryId = requestMetadata.toDepartmentId;
            const categoryDoc = await db.collection('departments').doc(newCategoryId).get();
            const categoryName = categoryDoc.exists ? categoryDoc.data()!.name : 'Unknown Category';
            
            // Execute automatic assignment in the new category
            const newAssignee = await getRoundRobinAssignee({
                departmentId: newCategoryId,
                campusId: ticketData.campusId,
                schoolId: ticketData.schoolId,
                divisionId: ticketData.divisionId,
                gradeId: ticketData.gradeId,
                schoolName: ticketData.schoolName,
                divisionName: ticketData.divisionName,
                gradeName: ticketData.gradeName,
                grades: (ticketData as any).allowedGrades || (ticketData as any).grades,
                mailboxEmail: ticketData.mailboxEmail,
                routingOptions: (ticketData as any).routingOptions,
            });
            const newStatus = newAssignee ? 'Open' : 'Queue';

            const transferId = requestId || `tr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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
                fromDepartmentId: requestMetadata?.fromDepartmentId || ticketData.departmentId,
                fromDepartmentName: requestMetadata?.fromDepartmentName || ticketData.departmentName || 'Previous Department',
                fromUser: (requestMetadata?.fromUserId && requestMetadata?.fromUserName) ? {
                    userId: requestMetadata.fromUserId,
                    name: requestMetadata.fromUserName,
                    avatarUrl: '',
                    email: '',
                } : (ticketData.assignedTo ? {
                    userId: ticketData.assignedTo.userId,
                    name: ticketData.assignedTo.name,
                    avatarUrl: ticketData.assignedTo.avatarUrl || '',
                    email: ticketData.assignedTo.email || '',
                } : null),
                toDepartmentId: newCategoryId,
                toDepartmentName: categoryName,
                involvedDepartmentIds: [requestMetadata?.fromDepartmentId || ticketData.departmentId, newCategoryId].filter(Boolean),
                toUser: newAssignee ? {
                    userId: newAssignee.id,
                    name: newAssignee.name,
                    avatarUrl: newAssignee.avatarUrl || '',
                    email: newAssignee.email || '',
                } : null,
                requestedBy: {
                    userId: event.recipient || actor.userId,
                    name: requestMetadata?.requesterName || actor.name,
                },
                approvedBy: {
                    userId: actor.userId,
                    name: actor.name,
                },
                transferredAt: new Date().toISOString(),
            };

            const batch = db.batch();
            
            batch.update(db.collection('tickets').doc(ticketId), {
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
            });

            batch.set(db.collection('ticket-transfers').doc(transferId), {
                ...transferRecord,
                transferredAtTimestamp: FieldValue.serverTimestamp(),
            });

            await batch.commit();

            await logSystemEvent({
                eventType: 'TICKET_TRANSFER_APPROVED',
                actor,
                message: `${actor.name} approved transfer of ticket #${ticketData.ticketNumber || ticketId.substring(0,4)} to ${categoryName}.`,
                details: { 
                    ticketId, 
                    transferId, 
                    requestId, 
                    approvedBy: actor.userId, 
                    fromDepartmentId: transferRecord.fromDepartmentId,
                    toDepartmentId: newCategoryId,
                    newAssigneeName: newAssignee?.name || 'In Queue'
                }
            });

            // Notify new assignee if present
            if (newAssignee) {
                await db.collection('ticket-events').add({
                    ticketId,
                    eventType: 'TICKET_STATUS_CHANGED',
                    title: 'New Transferred Ticket',
                    message: `Ticket #${ticketData.ticketNumber || ticketId.substring(0, 4)} was transferred to your category and assigned to you.`,
                    recipient: newAssignee.id,
                    read: false,
                    timestamp: FieldValue.serverTimestamp(),
                });
            }
        } 
        else if (eventType === 'TICKET_REASSIGN_REQUESTED') {
            let assigneeData = null;
            let status = 'Queue';

            if (newAssigneeId && newAssigneeId !== 'unassigned') {
                const userDoc = await db.collection('users').doc(newAssigneeId).get();
                if (!userDoc.exists) {
                    return { success: false, message: 'Selected employee does not exist.' };
                }
                const ud = userDoc.data() as UserProfile;
                const eligible = await employeeCoversTicketScope(db, ud, ticketData);
                if (!eligible) {
                    return {
                        success: false,
                        message: 'Reassignment blocked: selected employee does not match the ticket department, campus, school, division and grades. The ticket was not changed.'
                    };
                }
                assigneeData = {
                    userId: newAssigneeId,
                    name: ud.name,
                    email: ud.email || '',
                    avatarUrl: ud.avatarUrl || '',
                };
                status = 'Open';
            }

            await db.collection('tickets').doc(ticketId).update({
                assignedTo: assigneeData,
                assignedAt: assigneeData ? FieldValue.serverTimestamp() : FieldValue.delete(),
                status: status,
                updatedAt: FieldValue.serverTimestamp(),
            });

            await logSystemEvent({
                eventType: 'TICKET_REASSIGN_APPROVED',
                actor,
                message: `${actor.name} approved reassignment for ticket #${ticketData.ticketNumber || ticketId.substring(0,4)} to ${assigneeData?.name || 'Unassigned'}.`,
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
        revalidatePath('/track-history');
        revalidatePath('/tickets');
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
                (!ticketCampusId || actorCampuses.length === 0 || actorCampuses.includes(ticketCampusId)) && 
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