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
 * allocate work for later. Academic scope remains mandatory.
 * General Support and Operations are exempt from academic scope restrictions.
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

    // These categories only require the assignee to be an employee in the same department.
    // Verify the department name from Firestore rather than trusting the ticket's display name.
    const departmentDoc = await db.collection('departments').doc(t.departmentId).get();
    const departmentName = departmentDoc.exists ? normalized(departmentDoc.data()?.name) : '';
    if (departmentName === 'generalsupport' || departmentName === 'operations') return true;

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

/** Ticket fields set while a category-transfer request waits for a manager. */
const PENDING_TRANSFER_CLEARED = {
    pendingTransferRequestId: FieldValue.delete(),
    pendingTransferCategoryId: FieldValue.delete(),
    pendingTransferCategoryName: FieldValue.delete(),
};

/** Record the decision on the canonical request document (older requests have none). */
async function closeTransferRequest(
    db: NonNullable<typeof adminDb>,
    requestId: string | undefined | null,
    status: 'approved' | 'rejected',
    actor: { userId: string, name: string }
): Promise<void> {
    if (!requestId) return;
    try {
        const requestRef = db.collection('ticket-transfer-requests').doc(requestId);
        if (!(await requestRef.get()).exists) return;
        await requestRef.update({
            status,
            processedBy: actor.name,
            processedById: actor.userId,
            processedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        });
    } catch (error) {
        // The ticket itself is already updated; a stale request document must not fail the action.
        console.error('Could not close transfer request', requestId, error);
    }
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
            const categoryTransfer = event.eventType === 'TICKET_TRANSFER_REQUESTED';
            // A category-transfer request must be decided by the manager of the
            // SOURCE category and SOURCE campus, never the destination scope.
            const ticketCampusId = categoryTransfer
                ? (event.requestMetadata?.fromCampusId ?? ticketData?.campusId)
                : ticketData?.campusId;
            const ticketDeptId = categoryTransfer
                ? (event.requestMetadata?.fromDepartmentId ?? ticketData?.departmentId)
                : ticketData?.departmentId;
            const actorCampuses = [
                ...((actorData.campusIds || []) as string[]),
                ...((actorData as UserProfile & { campusId?: string }).campusId
                    ? [(actorData as UserProfile & { campusId?: string }).campusId!]
                    : []),
            ];
            const actorDeptId = actorData.departmentId;

            // Only the recipient manager in the original scope can approve.
            const isAuthorized = categoryTransfer
                ? actorData.role === 'Manager' && event.recipient === actor.userId &&
                  actorDeptId === ticketDeptId &&
                  (!ticketCampusId || actorCampuses.includes(ticketCampusId))
                : (!ticketCampusId || actorCampuses.length === 0 || actorCampuses.includes(ticketCampusId)) &&
                  (ticketDeptId && actorDeptId === ticketDeptId);
            
            if (!isAuthorized) {
                // The ticket is outside this manager's current scope. Keep the
                // request untouched in Firestore; tell the UI to hide its stale card.
                revalidatePath('/requests');
                return {
                    success: false,
                    message: 'Permission denied: You can only manage requests for your assigned department and campuses.',
                    removeFromList: true,
                    eventId,
                    requestId: event.requestId || null,
                };
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
            
            // The target campus was captured when the request was created.
            // Legacy requests without this field keep the original ticket campus.
            const targetCampusId = requestMetadata.toCampusId ?? requestMetadata.campusId ?? ticketData.campusId ?? null;
            const campusChanged = targetCampusId !== (ticketData.campusId || null);
            const targetCampusDoc = targetCampusId
                ? await db.collection('campuses').doc(targetCampusId).get()
                : null;
            if (targetCampusId && !targetCampusDoc?.exists)
                return { success: false, message: 'Destination Campus no longer exists.' };
            const targetCampusName = targetCampusDoc?.data()?.name || requestMetadata.toCampusName || ticketData.campusName || null;
            if (requestId && ticketData.pendingTransferRequestId !== requestId)
                return { success: false, message: 'This transfer is no longer the active request.' };

            // Legacy requests may not carry school/division destinations.
            const scope = requestMetadata as typeof requestMetadata & {
                toSchoolId?: string | null;
                toDivisionId?: string | null;
            };
            const targetSchoolId = scope.toSchoolId !== undefined
                ? scope.toSchoolId : (campusChanged ? null : ticketData.schoolId || null);
            const schoolChanged = (targetSchoolId || null) !== (ticketData.schoolId || null);
            const targetDivisionId = scope.toDivisionId !== undefined
                ? scope.toDivisionId : ((campusChanged || schoolChanged) ? null : ticketData.divisionId || null);
            const divisionChanged = (targetDivisionId || null) !== (ticketData.divisionId || null);
            const scopeChanged = campusChanged || schoolChanged || divisionChanged;
            const schoolDoc = targetSchoolId ? await db.collection('schools').doc(targetSchoolId).get() : null;
            const divisionDoc = targetDivisionId ? await db.collection('divisions').doc(targetDivisionId).get() : null;
            if (targetSchoolId && !schoolDoc?.exists) return { success: false, message: 'Destination School no longer exists.' };
            if (targetDivisionId && !divisionDoc?.exists) return { success: false, message: 'Destination Division no longer exists.' };
            const schoolConfigs = targetCampusDoc?.data()?.schoolConfigs || [];
            const schoolConfig = schoolConfigs.find((c: any) => c.schoolId === targetSchoolId);
            if (targetSchoolId && !schoolConfig) return { success: false, message: 'Destination School is not in the selected Campus.' };
            if (targetDivisionId && !(schoolConfig?.divisions || []).some((d: any) => d.divisionId === targetDivisionId))
                return { success: false, message: 'Destination Division is not in the selected School.' };
            const targetSchoolName = schoolDoc?.data()?.name || (!schoolChanged ? ticketData.schoolName : null) || null;
            const targetDivisionName = divisionDoc?.data()?.name || (!divisionChanged ? ticketData.divisionName : null) || null;
            const routeReset = {
                schoolId: targetSchoolId || null, schoolName: targetSchoolName, school: targetSchoolName,
                divisionId: targetDivisionId || null, divisionName: targetDivisionName, division: targetDivisionName,
                ...(scopeChanged ? { gradeId: null, gradeName: null, grade: null,
                    grades: [], allowedGrades: [], routingOptions: [] } : {}),
            };
            const newAssignee = await getRoundRobinAssignee({
                departmentId: newCategoryId,
                campusId: targetCampusId,
                schoolId: targetSchoolId,
                divisionId: targetDivisionId,
                gradeId: scopeChanged ? null : ticketData.gradeId,
                schoolName: targetSchoolName,
                divisionName: targetDivisionName,
                gradeName: scopeChanged ? null : ticketData.gradeName,
                grades: scopeChanged ? [] : ((ticketData as any).allowedGrades || (ticketData as any).grades),
                mailboxEmail: ticketData.mailboxEmail,
                routingOptions: scopeChanged ? [] : (ticketData as any).routingOptions,
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
                campusId: targetCampusId,
                campusName: targetCampusName,
                divisionId: targetDivisionId || null,
                divisionName: targetDivisionName,
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
                campusId: targetCampusId,
                campusName: targetCampusName,
                ...routeReset,
                pendingTransferCampusId: FieldValue.delete(),
                pendingTransferCampusName: FieldValue.delete(),
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
                // The request is decided: the ticket is no longer "waiting for manager approval".
                // Leaving these set blocks later transfers, Local Transfer and queue auto-assignment.
                ...PENDING_TRANSFER_CLEARED,
            });

            batch.set(db.collection('ticket-transfers').doc(transferId), {
                ...transferRecord,
                transferredAtTimestamp: FieldValue.serverTimestamp(),
            });

            await batch.commit();
            await closeTransferRequest(db, requestId, 'approved', actor);

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
            
            const categoryTransfer = event.eventType === 'TICKET_TRANSFER_REQUESTED';
            // A category-transfer request must be decided by the manager of the
            // SOURCE category and SOURCE campus, never the destination scope.
            const ticketCampusId = categoryTransfer
                ? (event.requestMetadata?.fromCampusId ?? ticketData?.campusId)
                : ticketData?.campusId;
            const ticketDeptId = categoryTransfer
                ? (event.requestMetadata?.fromDepartmentId ?? ticketData?.departmentId)
                : ticketData?.departmentId;
            const actorCampuses = [
                ...((actorData.campusIds || []) as string[]),
                ...((actorData as UserProfile & { campusId?: string }).campusId
                    ? [(actorData as UserProfile & { campusId?: string }).campusId!]
                    : []),
            ];
            const actorDeptId = actorData.departmentId;

            const isAuthorized = categoryTransfer
                ? actorData.role === 'Manager' && event.recipient === actor.userId &&
                  actorDeptId === ticketDeptId &&
                  (!ticketCampusId || actorCampuses.includes(ticketCampusId))
                : (!ticketCampusId || actorCampuses.length === 0 || actorCampuses.includes(ticketCampusId)) &&
                  (ticketDeptId && actorDeptId === ticketDeptId);
            
            if (!isAuthorized) {
                // The ticket is outside this manager's current scope. Keep the
                // request untouched in Firestore; tell the UI to hide its stale card.
                revalidatePath('/requests');
                return {
                    success: false,
                    message: 'Permission denied: You can only manage requests for your assigned department and campuses.',
                    removeFromList: true,
                    eventId,
                    requestId: event.requestId || null,
                };
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

        // A rejected category transfer leaves the ticket in its own category's Queue. Release
        // the "waiting for manager approval" hold so it can be assigned and transferred again.
        // Only this request's hold is released, never one created by a newer request.
        if (event.eventType === 'TICKET_TRANSFER_REQUESTED' && requestId) {
            const ticketRef = db.collection('tickets').doc(ticketId);
            await db.runTransaction(async (transaction) => {
                const latest = await transaction.get(ticketRef);
                if (!latest.exists || latest.data()?.pendingTransferRequestId !== requestId) return;
                transaction.update(ticketRef, {
                    ...PENDING_TRANSFER_CLEARED,
                    pendingTransferCampusId: FieldValue.delete(),
                    pendingTransferCampusName: FieldValue.delete(),
                    updatedAt: FieldValue.serverTimestamp(),
                });
            });
            await closeTransferRequest(db, requestId, 'rejected', actor);
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