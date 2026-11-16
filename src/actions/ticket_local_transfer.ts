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
  schoolId: z.string().min(1),
  divisionId: z.string().min(1),
  idToken: z.string().min(1),
});
export type LocalTransferActionState = { success: boolean; message?: string };
type Choice = { id: string; name: string };


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
  if (!parsed.success) return { success: false, message: 'Choose Campus, School and Division.' };
  const { ticketId, campusId, schoolId, divisionId, idToken } = parsed.data;
  try {
    const { uid, profile } = await authenticatedUser(idToken);
    const db = adminDb;
    if (!db) throw new Error('Firebase Admin is not initialized.');

    const ticketRef = db.collection('tickets').doc(ticketId);
    const [ticketDoc, campusDoc, schoolDoc, divisionDoc] = await Promise.all([
      ticketRef.get(), db.collection('campuses').doc(campusId).get(),
      db.collection('schools').doc(schoolId).get(), db.collection('divisions').doc(divisionId).get(),
    ]);
    if (!ticketDoc.exists) throw new Error('Ticket not found.');
    if (!campusDoc.exists || !schoolDoc.exists || !divisionDoc.exists)
      throw new Error('Invalid Campus / School / Division.');
    const ticket = ticketDoc.data()!;
    if (profile.role !== 'Admin' && profile.departmentId !== ticket.departmentId)
      throw new Error('You cannot request a transfer for another category.');
    if (profile.role !== 'Admin' && ticket.campusId &&
        !(profile.campusIds || []).includes(ticket.campusId))
      throw new Error('Ticket campus is outside your scope.');
    if (ticket.pendingTransferRequestId || ticket.pendingLocalTransferRequestId)
      throw new Error('This ticket already has a pending transfer request.');
    if (['Closed', 'Resolved', 'Duplicate', 'Ignored'].includes(ticket.status))
      throw new Error('This ticket cannot be transferred in its current status.');
    if (ticket.campusId === campusId && ticket.schoolId === schoolId && ticket.divisionId === divisionId)
      throw new Error('The requested scope is already selected.');

    const campus = campusDoc.data()!;
    const school = schoolDoc.data()!;
    const division = divisionDoc.data()!;
    const configs = campus.schoolConfigs;
    const belongsToCampus = Array.isArray(configs) && configs.length
      ? configs.some((c: any) => c.schoolId === schoolId)
      : school.campusId === campusId || (Array.isArray(school.campusIds) && school.campusIds.includes(campusId));
    if (!belongsToCampus) throw new Error('Selected School is not linked to the selected Campus.');

    const belongsToSchool = division.schoolId === schoolId ||
      (Array.isArray(division.schoolIds) && division.schoolIds.includes(schoolId)) ||
      (Array.isArray(school.divisionIds) && school.divisionIds.includes(divisionId));
    if (!belongsToSchool) throw new Error('Selected Division is not linked to the selected School.');

    const scope = {
      campusId, campusName: String(campus.name || ''),
      schoolId, schoolName: String(school.name || ''),
      divisionId, divisionName: String(division.name || ''),
    };
    if (!scope.campusName || !scope.schoolName || !scope.divisionName)
      throw new Error('One or more choices have no name.');

    const managers = await db.collection('users')
      .where('departmentId', '==', ticket.departmentId).where('role', '==', 'Manager').get();
    const admins = await db.collection('users').where('role', '==', 'Admin').get();
    const recipients = new Set<string>();
    managers.docs.forEach(d => {
      if (canApproveTarget(d.data() as UserProfile, ticket.departmentId, campusId)) recipients.add(d.id);
    });
    admins.docs.forEach(d => recipients.add(d.id));
    if (!recipients.size) throw new Error('No eligible manager or admin found.');
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
          message: `${profile.name || 'Staff'} requested Local Transfer to ${scope.campusName} / ${scope.schoolName} / ${scope.divisionName}.`,
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
    if (profile.role !== 'Admin' && profile.role !== 'Manager') throw new Error('Managers only.');
const db = adminDb;

if (!db) {
  throw new Error('Firebase Admin is not initialized.');
}

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
      if (!scope?.campusId || !scope?.schoolId || !scope?.divisionId)
        throw new Error('Request has invalid scope.');
      if (!canApproveTarget(profile, ticket.departmentId, scope.campusId))
        throw new Error('You are not authorized to approve this destination campus.');
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
