'use server';

import { z } from 'zod';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { autoAssignQueuedTickets } from '@/actions/ticket_assignment';
import type { UserProfile } from '@/lib/types';

const RequestSchema = z.object({
  ticketId: z.string().min(1),
  campusId: z.string().min(1),
  schoolId: z.string().optional().default(''),
  divisionId: z.string().optional().default(''),
  idToken: z.string().min(1),
});
export type LocalTransferActionState = { success: boolean; message?: string };

async function authenticatedUser(idToken: string) {
  if (!adminDb) {
    throw new Error('Firebase Admin is not initialized.');
  }

  const decoded = await getAuth().verifyIdToken(idToken, true);
  const userDoc = await adminDb.collection('users').doc(decoded.uid).get();

  if (!userDoc.exists) {
    throw new Error('User profile not found.');
  }

  const profile = userDoc.data() as UserProfile;

  if (!['Admin', 'Manager', 'Employee'].includes(profile.role)) {
    throw new Error('Unauthorized.');
  }

  return { uid: decoded.uid, profile };
}

function canApproveTarget(profile: UserProfile, departmentId: string, campusId: string): boolean {
  if (profile.role === 'Admin') return true;
  return profile.role === 'Manager' && profile.departmentId === departmentId &&
    Array.isArray(profile.campusIds) && profile.campusIds.includes(campusId);
}

function refresh(ticketId: string) {
  revalidatePath('/requests');
  revalidatePath('/tickets');
  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/dashboard');
}

export async function requestLocalTransferAction(
  _previous: LocalTransferActionState,
  data: FormData
): Promise<LocalTransferActionState> {
  const parsed = RequestSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success) {
    return { success: false, message: 'Please select a Campus.' };
  }
  const { ticketId, campusId, schoolId, divisionId, idToken } = parsed.data;
  try {
    const { uid, profile } = await authenticatedUser(idToken);
    const db = adminDb;
    if (!db) throw new Error('Firebase Admin is not initialized.');

    const ticketRef = db.collection('tickets').doc(ticketId);
    // Optional selections must never be passed as empty Firestore document paths.
    const [ticketDoc, campusDoc, schoolDoc, divisionDoc] = await Promise.all([
      ticketRef.get(),
      db.collection('campuses').doc(campusId).get(),
      schoolId ? db.collection('schools').doc(schoolId).get() : Promise.resolve(null),
      divisionId ? db.collection('divisions').doc(divisionId).get() : Promise.resolve(null),
    ]);
    if (!ticketDoc.exists) throw new Error('Ticket not found.');
    if (!campusDoc.exists) throw new Error('Invalid Campus.');
    if (schoolId && !schoolDoc?.exists) throw new Error('Invalid School.');
    if (divisionId && !divisionDoc?.exists) throw new Error('Invalid Division.');
    if (divisionId && !schoolId) throw new Error('Select a School before choosing a Division.');
    const ticket = ticketDoc.data()!;
    if (profile.role !== 'Admin' && profile.departmentId !== ticket.departmentId)
      throw new Error('You cannot request a transfer for another category.');
    if (profile.role !== 'Admin' && ticket.campusId &&
        !(profile.campusIds || []).includes(ticket.campusId))
      throw new Error('Ticket campus is outside your scope.');
    // Admins may supersede a pending LOCAL transfer. Category-transfer requests
    // use a separate workflow and must not be silently overwritten.
    if (ticket.pendingTransferRequestId)
      throw new Error('This ticket has a pending category transfer request. Resolve that request first.');
    if (ticket.pendingLocalTransferRequestId && profile.role !== 'Admin')
      throw new Error('This ticket already has a pending Local Transfer request.');
    if (['Closed', 'Resolved', 'Duplicate', 'Ignored'].includes(ticket.status))
      throw new Error('This ticket cannot be transferred in its current status.');
    if (ticket.campusId === campusId && (ticket.schoolId || '') === schoolId && (ticket.divisionId || '') === divisionId)
      throw new Error('The requested scope is already selected.');

    const campus = campusDoc.data()!;
    const school = schoolDoc?.data();
    const division = divisionDoc?.data();
    const configs = campus.schoolConfigs;
    const schoolConfig = Array.isArray(configs)
      ? configs.find((c: any) => c.schoolId === schoolId)
      : undefined;

    if (schoolId) {
      const belongsToCampus = Array.isArray(configs) && configs.length
        ? !!schoolConfig
        : school?.campusId === campusId ||
          (Array.isArray(school?.campusIds) && school.campusIds.includes(campusId));
      if (!belongsToCampus) throw new Error('Selected School is not linked to the selected Campus.');
    }

    if (divisionId) {
      // Current campus configuration is the source of truth for division membership.
      const configuredDivisions = schoolConfig?.divisions;
      const belongsToSchool = Array.isArray(configuredDivisions)
        ? configuredDivisions.some((d: any) => d.divisionId === divisionId)
        : division?.schoolId === schoolId ||
          (Array.isArray(division?.schoolIds) && division.schoolIds.includes(schoolId)) ||
          (Array.isArray(school?.divisionIds) && school.divisionIds.includes(divisionId));
      if (!belongsToSchool) throw new Error('Selected Division is not linked to the selected School.');
    }

    const scope = {
      campusId, campusName: String(campus.name || ''),
      schoolId: schoolId || null, schoolName: schoolId ? String(school?.name || '') : null,
      divisionId: divisionId || null, divisionName: divisionId ? String(division?.name || '') : null,
    };
    if (!scope.campusName || (schoolId && !scope.schoolName) || (divisionId && !scope.divisionName))
      throw new Error('One or more choices have no name.');

    // Admins transfer immediately. No approval request, recipient notifications,
    // or pending flag. A prior pending LOCAL request is explicitly closed so
    // managers cannot later approve an obsolete destination.
    if (profile.role === 'Admin') {
      const oldLocalRequestId = ticket.pendingLocalTransferRequestId as string | undefined;
      const oldRequestRef = oldLocalRequestId
        ? db.collection('ticket-local-transfer-requests').doc(oldLocalRequestId)
        : null;
      const oldEvents = oldLocalRequestId
        ? await db.collection('ticket-events').where('requestId', '==', oldLocalRequestId).get()
        : null;

      await db.runTransaction(async tx => {
        const currentDoc = await tx.get(ticketRef);
        const oldRequestDoc = oldRequestRef ? await tx.get(oldRequestRef) : null;
        if (!currentDoc.exists) throw new Error('Ticket no longer exists.');
        const current = currentDoc.data()!;
        if (current.pendingTransferRequestId)
          throw new Error('A category transfer is pending. Resolve it first.');
        if ((current.pendingLocalTransferRequestId || null) !== (oldLocalRequestId || null))
          throw new Error('Pending Local Transfer changed. Refresh and retry.');
        if (current.departmentId !== ticket.departmentId ||
            current.campusId !== ticket.campusId ||
            (current.schoolId || '') !== (ticket.schoolId || '') ||
            (current.divisionId || '') !== (ticket.divisionId || ''))
          throw new Error('Ticket was changed. Refresh and retry.');
        if (['Closed', 'Resolved', 'Duplicate', 'Ignored'].includes(current.status))
          throw new Error('This ticket cannot be transferred in its current status.');
        if (current.campusId === campusId && (current.schoolId || '') === schoolId &&
            (current.divisionId || '') === divisionId)
          throw new Error('The requested scope is already selected.');

        if (oldRequestRef) {
          if (!oldRequestDoc?.exists || oldRequestDoc.data()?.status !== 'pending')
            throw new Error('Pending Local Transfer record changed. Refresh and retry.');
          tx.update(oldRequestRef, {
            status: 'rejected',
            processedBy: { userId: uid, name: profile.name || 'Admin' },
            processedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            cancellationReason: 'Superseded by direct Admin Local Transfer',
          });
          oldEvents?.docs.forEach(event => tx.update(event.ref, {
            status: 'rejected', read: true,
            processedBy: profile.name || 'Admin',
          }));
        }
        tx.update(ticketRef, {
          ...scope,
          gradeId: null, gradeName: null,
          status: 'Queue', assignedTo: null, assignedAt: null,
          pendingLocalTransferRequestId: null,
          pendingLocalTransferScope: null,
          updatedAt: FieldValue.serverTimestamp(),
        });
      });

      // The transfer has already committed; a routing failure must not report
      // that the transfer itself failed.
      let assignmentMessage = 'Ticket remains in Queue until an eligible agent is available.';
      try {
        const assignment = await autoAssignQueuedTickets({ ticketId });
        if (assignment.assignedCount) assignmentMessage = 'Ticket assigned.';
      } catch (error) {
        console.error('Admin Local Transfer auto-assignment failed:', error);
      }
      refresh(ticketId);
      return { success: true, message: `Local Transfer completed by Admin. ${assignmentMessage}` };
    }

    // Manager and Employee: only destination-campus managers in this category
    // can approve. Admins are NOT included as approval recipients.
    const managers = await db.collection('users')
      .where('departmentId', '==', ticket.departmentId).where('role', '==', 'Manager').get();
    const recipients = new Set<string>();
    managers.docs.forEach(d => {
      if (canApproveTarget(d.data() as UserProfile, ticket.departmentId, campusId)) recipients.add(d.id);
    });
    if (!recipients.size) throw new Error('No manager found for the destination Campus and Category.');
    if (recipients.size > 450) throw new Error('Too many approvers.');

    const requestRef = db.collection('ticket-local-transfer-requests').doc();
    const requestId = requestRef.id;
    const metadata = {
      requesterId: uid,
      requesterName: profile.name || 'Staff',
      fromDepartmentId: ticket.departmentId,
      fromDepartmentName: ticket.departmentName || '',
      toDepartmentId: ticket.departmentId,
      toDepartmentName: ticket.departmentName || '',
      campusId,
      localTransferScope: scope,
    };
    await db.runTransaction(async tx => {
      const currentDoc = await tx.get(ticketRef);
      if (!currentDoc.exists) throw new Error('Ticket no longer exists.');
      const current = currentDoc.data()!;
      if (current.pendingTransferRequestId || current.pendingLocalTransferRequestId)
        throw new Error('Another transfer is already pending.');
      if (current.departmentId !== ticket.departmentId || current.campusId !== ticket.campusId ||
          current.schoolId !== ticket.schoolId || current.divisionId !== ticket.divisionId)
        throw new Error('Ticket was changed. Refresh and retry.');
      if (['Closed', 'Resolved', 'Duplicate', 'Ignored'].includes(current.status))
        throw new Error('Ticket is no longer eligible for transfer.');
      tx.set(requestRef, {
        ticketId, requestId, status: 'pending', requestMetadata: metadata,
        requestedScope: scope,
        originalStatus: current.status,
        originalAssignee: current.assignedTo || null,
        originalAssignedAt: current.assignedAt || null,
        requestedBy: { userId: uid, name: profile.name || 'Staff' },
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      recipients.forEach(recipient => {
        tx.set(db.collection('ticket-events').doc(), {
          ticketId, requestId, eventType: 'TICKET_LOCAL_TRANSFER_REQUESTED',
          title: 'Local Transfer Requested',
          message: `${profile.name || 'Staff'} requested Local Transfer to ${[scope.campusName, scope.schoolName, scope.divisionName].filter(Boolean).join(' / ')}.`,
          recipient, timestamp: FieldValue.serverTimestamp(), read: false,
          status: 'pending', requestMetadata: metadata,
        });
      });
      tx.update(ticketRef, {
        status: 'Queue', assignedTo: null, assignedAt: null,
        pendingLocalTransferRequestId: requestId,
        pendingLocalTransferScope: scope,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    refresh(ticketId);
    return { success: true, message: 'Local Transfer request sent for manager approval.' };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Could not request Local Transfer.' };
  }
}

export async function decideLocalTransferAction(
  eventId: string,
  idToken: string,
  decision: 'approved' | 'rejected'
): Promise<LocalTransferActionState> {
  try {
    const { uid, profile } = await authenticatedUser(idToken);
    if (profile.role !== 'Manager') throw new Error('Destination Campus managers only.');
    const db = adminDb;
    if (!db) throw new Error('Firebase Admin is not initialized.');

    const eventDoc = await db.collection('ticket-events').doc(eventId).get();
    if (!eventDoc.exists || eventDoc.data()?.eventType !== 'TICKET_LOCAL_TRANSFER_REQUESTED')
      throw new Error('Local Transfer request not found.');
    if (eventDoc.data()?.recipient !== uid) throw new Error('This request is not addressed to you.');
    const ticketId = eventDoc.data()!.ticketId as string;
    const requestId = eventDoc.data()!.requestId as string;
    if (!requestId) throw new Error('Missing canonical request ID.');
    const ticketRef = db.collection('tickets').doc(ticketId);
    const requestRef = db.collection('ticket-local-transfer-requests').doc(requestId);
    const eventsSnap = await db.collection('ticket-events').where('requestId', '==', requestId).get();
    const currentTicketSnap = await ticketRef.get();
    if (!currentTicketSnap.exists) throw new Error('Ticket not found.');
    await db.runTransaction(async tx => {
      const [ticketDoc, requestDoc] = await Promise.all([tx.get(ticketRef), tx.get(requestRef)]);
      const ticket = ticketDoc.data();
      const request = requestDoc.data();
      if (!ticket || !request || request.status !== 'pending' || ticket.pendingLocalTransferRequestId !== requestId)
        throw new Error('Request already processed or no longer pending.');
      const scope = request.requestedScope;
      if (!scope?.campusId || (scope.divisionId && !scope.schoolId))
        throw new Error('Request has invalid scope.');
      if (profile.role !== 'Manager' || !canApproveTarget(profile, ticket.departmentId, scope.campusId))
        throw new Error('Only a manager of the destination Campus and Category can approve.');
      tx.update(requestRef, {
        status: decision, processedBy: { userId: uid, name: profile.name || 'Manager' },
        updatedAt: FieldValue.serverTimestamp(), processedAt: FieldValue.serverTimestamp(),
      });
      const updated: Record<string, unknown> = {
        pendingLocalTransferRequestId: null, pendingLocalTransferScope: null,
        status: 'Queue', assignedTo: null, assignedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (decision === 'approved') Object.assign(updated, scope, { gradeId: null, gradeName: null });
      // On rejection, original academic scope stays unchanged and ticket returns to Queue.
      tx.update(ticketRef, updated);
      eventsSnap.docs.forEach(d => tx.update(d.ref, {
        status: decision, read: true, processedBy: profile.name || 'Manager',
      }));
    });
    // Once the pending flag has been cleared, regular scope-aware auto assignment may run.
    // If no eligible employee is online / working, the ticket safely remains in Queue.
    const assignment = await autoAssignQueuedTickets({ ticketId });
    refresh(ticketId);
    return {
      success: true,
      message: decision === 'approved'
        ? `Local Transfer approved. ${assignment.assignedCount ? 'Ticket assigned.' : 'Ticket remains in Queue until an eligible agent is available.'}`
        : `Local Transfer rejected. ${assignment.assignedCount ? 'Ticket returned to an agent.' : 'Ticket remains in Queue.'}`,
    };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Could not process Local Transfer.' };
  }
}
