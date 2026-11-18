'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import type { TicketStatus, UserProfile } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { logSystemEvent } from '@/lib/system-log';

type ActionState = { success: boolean; message?: string };

const VALID_STATUSES: TicketStatus[] = [
  'Open', 'In Progress', 'Resolved', 'Closed', 'Queue',
  'Waiting', 'Duplicate', 'Ignored',
];
const FINISHED_STATUSES: TicketStatus[] = ['Resolved', 'Closed', 'Duplicate', 'Ignored'];
const ACTIVE_STATUSES: TicketStatus[] = ['Open', 'In Progress', 'Queue', 'Waiting'];

// Existing academic-scope exemptions: neither category requires campus/division matching.
const EXEMPT_DEPARTMENTS = new Set(['generalsupport', 'operations']);
const normalize = (value: unknown) => String(value || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

const stringIds = (...items: unknown[]): string[] => items.flatMap(item =>
  Array.isArray(item) ? item : [item]
).filter((item): item is string => typeof item === 'string' && !!item.trim())
  .map(item => item.trim());

const campusIdsFor = (profile: UserProfile) => {
  const p = profile as UserProfile & { campusId?: string };
  return stringIds(p.campusIds, p.campusId);
};

const divisionIdsFor = (profile: UserProfile) => {
  const p = profile as UserProfile & {
    divisionIds?: string[];
    divisionId?: string;
    allowedDivisions?: string[];
  };
  return stringIds(p.divisionIds, p.divisionId, p.allowedDivisions);
};

export async function bulkUpdateTicketsAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const db = adminDb;
  if (!db) return { success: false, message: 'Firebase Admin not configured.' };

  // Never trust a role or userId sent from the browser.
  const idToken = formData.get('idToken');
  if (typeof idToken !== 'string' || !idToken) {
    return { success: false, message: 'Please sign in again.' };
  }

  let actor: UserProfile & { id: string };
  try {
    const decoded = await getAuth().verifyIdToken(idToken, true);
    const actorDoc = await db.collection('users').doc(decoded.uid).get();
    if (!actorDoc.exists) return { success: false, message: 'User profile not found.' };
    actor = { ...(actorDoc.data() as UserProfile), id: actorDoc.id };
    if (actor.role !== 'Admin' && actor.role !== 'Manager') {
      return { success: false, message: 'Only admins and managers can bulk update tickets.' };
    }
  } catch (error) {
    console.error('Bulk update authentication failed:', error);
    return { success: false, message: 'Invalid or expired authentication. Please sign in again.' };
  }

  const ticketIds = [...new Set(
    formData.getAll('ticketIds').filter((value): value is string =>
      typeof value === 'string' && value.trim().length > 0
    ),
  )];
  const statusValue = formData.get('status');
  const status = typeof statusValue === 'string' && statusValue.length > 0
    ? statusValue as TicketStatus : null;
  const assigneeValue = formData.get('assigneeId');
  const assigneeId = typeof assigneeValue === 'string' && assigneeValue.length > 0
    ? assigneeValue : null;

  if (ticketIds.length === 0) return { success: false, message: 'No tickets selected.' };
  if (status && !VALID_STATUSES.includes(status)) return { success: false, message: 'Invalid ticket status.' };
  if (!status && !assigneeId) return { success: false, message: 'No update operation specified.' };
  if (status && assigneeId) {
    return { success: false, message: 'Change the status or assignee in separate operations.' };
  }

  const updatesPayload: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
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
        if (!userDoc.exists) return { success: false, message: 'Assignee not found.' };
        newAssignee = { id: userDoc.id, ...userDoc.data() } as UserProfile;
        // For managers, only employees from their own department can be selected.
        if (actor.role === 'Manager' &&
          (newAssignee.role !== 'Employee' || newAssignee.departmentId !== actor.departmentId)) {
          return { success: false, message: 'Selected assignee is outside your department.' };
        }
        updatesPayload.assignedTo = {
          userId: userDoc.id,
          name: newAssignee.name,
          email: newAssignee.email || '',
          avatarUrl: newAssignee.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(newAssignee.name)}`,
        };
        updatesPayload.assignedAt = FieldValue.serverTimestamp();
      } catch (e) {
        console.error('Error fetching assignee:', e);
        return { success: false, message: 'Failed to fetch assignee data.' };
      }
    }
  }

  try {
    const ticketRefs = ticketIds.map(id => db.collection('tickets').doc(id));
    const BATCH_SIZE = 400;
    const tickets: FirebaseFirestore.DocumentSnapshot[] = [];
    // Validate the entire selection BEFORE making any updates, so a mixed-scope
    // selection cannot result in a partially authorized bulk operation.
    for (let i = 0; i < ticketRefs.length; i += BATCH_SIZE) {
      tickets.push(...await db.getAll(...ticketRefs.slice(i, i + BATCH_SIZE)));
    }

    const deptIds = [...new Set(tickets.filter(t => t.exists)
      .map(t => t.data()?.departmentId).filter((id): id is string => typeof id === 'string' && !!id))];
    const deptNameById = new Map<string, string>();
    if (actor.role === 'Manager') {
      const deptSnaps = await Promise.all(deptIds.map(id => db.collection('departments').doc(id).get()));
      deptSnaps.forEach(snap => {
        if (snap.exists) deptNameById.set(snap.id, String(snap.data()?.name || ''));
      });
    }

    for (const ticketDoc of tickets) {
      if (!ticketDoc.exists) continue;
      if (actor.role !== 'Manager') continue;
      const ticket = ticketDoc.data()!;
      if (!actor.departmentId || ticket.departmentId !== actor.departmentId) {
        return { success: false, message: 'One or more selected tickets are outside your department.' };
      }

      const deptName = deptNameById.get(ticket.departmentId) || ticket.departmentName;
      const exempt = EXEMPT_DEPARTMENTS.has(normalize(deptName));
      if (exempt) continue;

      const managerCampuses = campusIdsFor(actor);
      const managerDivisions = divisionIdsFor(actor);
      if (!ticket.campusId || !managerCampuses.includes(ticket.campusId) ||
          !ticket.divisionId || !managerDivisions.includes(ticket.divisionId)) {
        return { success: false, message: 'One or more selected tickets are outside your Campus/Division scope.' };
      }
      if (newAssignee && (
        !campusIdsFor(newAssignee).includes(ticket.campusId) ||
        !divisionIdsFor(newAssignee).includes(ticket.divisionId)
      )) {
        return { success: false, message: 'Selected employee does not cover the Campus/Division of every selected ticket.' };
      }
    }

    let updatedCount = 0;
    const updatedTicketIds: string[] = [];
    for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
      const batch = db.batch();
      let chunkUpdates = 0;
      for (const ticketDoc of tickets.slice(i, i + BATCH_SIZE)) {
        if (!ticketDoc.exists) continue;
        const ticketData = ticketDoc.data() || {};
        const currentStatus = (ticketData.status || 'Open') as TicketStatus;
        const finalUpdates = { ...updatesPayload };
        if (assigneeId && assigneeId !== 'unassigned' && currentStatus === 'Queue') {
          finalUpdates.status = 'Open';
        }
        const targetStatus = (finalUpdates.status || currentStatus) as TicketStatus;
        if (FINISHED_STATUSES.includes(currentStatus) && ACTIVE_STATUSES.includes(targetStatus)) {
          finalUpdates.reopenedCount = (ticketData.reopenedCount || 0) + 1;
          finalUpdates.lastReopenedAt = FieldValue.serverTimestamp();
        }
        batch.update(ticketDoc.ref, finalUpdates);
        chunkUpdates++;
        updatedTicketIds.push(ticketDoc.id);
      }
      if (chunkUpdates > 0) {
        await batch.commit();
        updatedCount += chunkUpdates;
      }
    }

    if (updatedCount === 0) return { success: false, message: 'None of the selected tickets were found.' };

    try {
      await logSystemEvent({
        eventType: 'TICKET_BULK_UPDATE',
        actor: { userId: actor.id, name: actor.name || 'Admin/Manager' },
        message: `Bulk updated ${updatedCount} ticket(s)${status ? ` (Status: ${status})` : ''}${newAssignee ? ` (Assigned to: ${newAssignee.name})` : ''}.`,
        details: {
          ticketIds: updatedTicketIds,
          ticketCount: updatedCount,
          status: status || (assigneeId === 'unassigned' ? 'Queue' : null),
          assignedTo: newAssignee?.name || (assigneeId === 'unassigned' ? 'Unassigned' : null),
        },
      });
    } catch (error) {
      console.error('Bulk update audit logging failed:', error);
    }

    if (newAssignee) {
      try {
        for (let i = 0; i < updatedTicketIds.length; i += BATCH_SIZE) {
          const chunkIds = updatedTicketIds.slice(i, i + BATCH_SIZE);
          const notifBatch = db.batch();
          for (const tid of chunkIds) {
            const notifRef = db.collection('ticket-events').doc();
            notifBatch.set(notifRef, {
              ticketId: tid,
              eventType: 'TICKET_STATUS_CHANGED',
              title: 'New Ticket Assigned',
              message: 'Ticket was assigned to you via bulk update.',
              recipient: newAssignee.id,
              read: false,
              timestamp: FieldValue.serverTimestamp(),
            });
          }
          await notifBatch.commit();
        }
      } catch (error) {
        console.error('Bulk update notifications failed:', error);
      }
    }

    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    revalidatePath('/tasks');
    revalidatePath('/analytics');
    return { success: true, message: `Successfully updated ${updatedCount} ticket${updatedCount === 1 ? '' : 's'}.` };
  } catch (error: any) {
    console.error('Bulk update failed:', error);
    return { success: false, message: error?.message || 'An unexpected error occurred during bulk update.' };
  }
}
