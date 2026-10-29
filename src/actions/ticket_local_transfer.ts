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
  schoolId: z.string().min(1),
  divisionId: z.string().min(1),
  gradeId: z.string().min(1),
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

function canManage(profile: UserProfile, ticket: FirebaseFirestore.DocumentData): boolean {
  if (profile.role === 'Admin') return true;
  if (profile.role !== 'Manager' || profile.departmentId !== ticket.departmentId) return false;
  return !!ticket.campusId && Array.isArray(profile.campusIds) && profile.campusIds.includes(ticket.campusId);
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
  if (!parsed.success) return { success: false, message: 'Choose School, Division and Grade.' };
  const { ticketId, schoolId, divisionId, gradeId, idToken } = parsed.data;
  try {
    const { uid, profile } = await authenticatedUser(idToken);
   const db = adminDb;

if (!db) {
  throw new Error('Firebase Admin is not initialized.');
}

const ticketRef = db.collection('tickets').doc(ticketId);
    const [ticketDoc, schoolDoc, divisionDoc, gradeDoc] = await Promise.all([
      ticketRef.get(), db.collection('schools').doc(schoolId).get(),
      db.collection('divisions').doc(divisionId).get(), db.collection('grades').doc(gradeId).get(),
    ]);
    if (!ticketDoc.exists) throw new Error('Ticket not found.');
    if (!schoolDoc.exists || !divisionDoc.exists || !gradeDoc.exists) throw new Error('Invalid School / Division / Grade.');
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
    if (ticket.schoolId === schoolId && ticket.divisionId === divisionId && ticket.gradeId === gradeId)
      throw new Error('The requested scope is already selected.');

    // If the current campus explicitly configures schools and grades, honor that configuration.
    if (ticket.campusId) {
      const campusDoc = await db.collection('campuses').doc(ticket.campusId).get();
      if (!campusDoc.exists) throw new Error('Ticket campus no longer exists.');
      const configs = campusDoc.data()?.schoolConfigs;
      if (Array.isArray(configs) && configs.length) {
        const selected = configs.find((c: any) => c.schoolId === schoolId);
        if (!selected || !Array.isArray(selected.gradeIds) || !selected.gradeIds.includes(gradeId))
          throw new Error('Selected school/grade is not available in the ticket campus.');
      }
    }
    const scope: { schoolId: string; schoolName: string; divisionId: string; divisionName: string; gradeId: string; gradeName: string } = {
      schoolId, schoolName: String(schoolDoc.data()?.name || ''),
      divisionId, divisionName: String(divisionDoc.data()?.name || ''),
      gradeId, gradeName: String(gradeDoc.data()?.name || ''),
    };
    if (!scope.schoolName || !scope.divisionName || !scope.gradeName)
      throw new Error('One or more choices have no name.');
    // Division is intentionally NOT restricted by school.
    const managers = await db.collection('users')
      .where('departmentId', '==', ticket.departmentId).where('role', '==', 'Manager').get();
    const admins = await db.collection('users').where('role', '==', 'Admin').get();
    const recipients = new Set<string>();
    managers.docs.forEach(d => {
      if (canManage(d.data() as UserProfile, ticket)) recipients.add(d.id);
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
      campusId: ticket.campusId || null,
      localTransferScope: scope,
    };
    await db.runTransaction(async tx => {
      const currentDoc = await tx.get(ticketRef);
      if (!currentDoc.exists) throw new Error('Ticket no longer exists.');
      const current = currentDoc.data()!;
      if (current.pendingTransferRequestId || current.pendingLocalTransferRequestId)
        throw new Error('Another transfer is already pending.');
      if (current.departmentId !== ticket.departmentId || current.campusId !== ticket.campusId)
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
          message: `${profile.name || 'Staff'} requested Local Transfer to ${scope.schoolName} / ${scope.divisionName} / ${scope.gradeName}.`,
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
    if (!currentTicketSnap.exists || !canManage(profile, currentTicketSnap.data()!))
      throw new Error('You cannot approve requests for this ticket category and campus.');
    await db.runTransaction(async tx => {
      const [ticketDoc, requestDoc] = await Promise.all([tx.get(ticketRef), tx.get(requestRef)]);
      const ticket = ticketDoc.data();
      const request = requestDoc.data();
      if (!ticket || !request || request.status !== 'pending' || ticket.pendingLocalTransferRequestId !== requestId)
        throw new Error('Request already processed or no longer pending.');
      if (!canManage(profile, ticket)) throw new Error('No longer authorized.');
      const scope = request.requestedScope;
      if (!scope?.schoolId || !scope?.divisionId || !scope?.gradeId)
        throw new Error('Request has invalid scope.');
      tx.update(requestRef, {
        status: decision, processedBy: { userId: uid, name: profile.name || 'Manager' },
        updatedAt: FieldValue.serverTimestamp(), processedAt: FieldValue.serverTimestamp(),
      });
      const updated: Record<string, unknown> = {
        pendingLocalTransferRequestId: null, pendingLocalTransferScope: null,
        status: 'Queue', assignedTo: null, assignedAt: null,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (decision === 'approved') Object.assign(updated, scope);
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
