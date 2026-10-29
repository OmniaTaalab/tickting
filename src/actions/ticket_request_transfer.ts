
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

// General Support and Operations are exempt
// from academic and campus routing restrictions.
function isDepartmentOnly(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === 'general support' ||
    normalized === 'operations'
  );
}

function values(...inputs: unknown[]): string[] {
  return inputs.flatMap(input => {
    if (Array.isArray(input)) {
      return input
        .filter((v): v is string => typeof v === 'string')
        .map(v => v.trim())
        .filter(Boolean);
    }

    if (typeof input === 'string' && input.trim()) {
      return [input.trim()];
    }

    return [];
  });
}

// Match a manager against an optional ticket scope.
// IDs take priority. Names are used only when
// the ticket does not contain an ID.
function matchesScope(
  targetId: unknown,
  targetName: unknown,
  managerIds: unknown,
  managerNames: unknown
): boolean {
  const id = typeof targetId === 'string'
    ? targetId.trim()
    : '';

  const name = typeof targetName === 'string'
    ? targetName.trim().toLowerCase()
    : '';

  // Missing scope means no restriction.
  if (!id && !name) return true;

  const ids = values(managerIds);
  const names = values(managerNames)
    .map(v => v.toLowerCase());

  if (id) return ids.includes(id);

  return names.includes(name);
}

function managerMatchesTicket(
  manager: UserProfile,
  ticket: Record<string, any>,
  departmentOnly: boolean
): boolean {
  // Preserve the special routing exemption.
  if (departmentOnly) return true;

  const m = manager as UserProfile & Record<string, any>;

  // Campus is required for regular departments.
  if (!ticket.campusId) return false;

  if (!values(m.campusIds, m.campusId)
      .includes(ticket.campusId)) {
    return false;
  }

  // School, when specified.
  if (!matchesScope(
    ticket.schoolId,
    ticket.schoolName || ticket.school,
    m.schoolIds,
    [m.schoolNames, m.schools, m.schoolName]
  )) return false;

  // Division, when specified.
  if (!matchesScope(
    ticket.divisionId,
    ticket.divisionName || ticket.division,
    m.divisionIds,
    [m.divisionNames, m.divisions, m.divisionName]
  )) return false;

  // Grade, when specified.
  if (!matchesScope(
    ticket.gradeId,
    ticket.gradeName || ticket.grade,
    m.gradeIds,
    [m.gradeNames, m.grades, m.gradeName]
  )) return false;

  return true;
}

export async function requestTicketTransferAction(
  prevState: RequestTransferState,
  formData: FormData
): Promise<RequestTransferState> {
  const db = adminDb;

  if (!db) {
    return {
      success: false,
      message: 'Database configuration error.',
    };
  }

  const validated = RequestTransferSchema.safeParse({
    ticketId: formData.get('ticketId'),
    newCategoryId: formData.get('newCategoryId'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validated.success) {
    return {
      success: false,
      message: 'Please select a valid category.',
    };
  }

  const {
    ticketId,
    newCategoryId,
    actorId,
    actorName,
  } = validated.data;

  try {
    const ticketRef = db.collection('tickets').doc(ticketId);

    // 1. Validate actor and ticket.
    const [actorDoc, ticketDoc, targetCategoryDoc] =
      await Promise.all([
        db.collection('users').doc(actorId).get(),
        ticketRef.get(),
        db.collection('departments')
          .doc(newCategoryId).get(),
      ]);

    if (!actorDoc.exists) {
      return {
        success: false,
        message: 'User not found.',
      };
    }

    if (!ticketDoc.exists) {
      return {
        success: false,
        message: 'Ticket not found.',
      };
    }

    if (!targetCategoryDoc.exists) {
      return {
        success: false,
        message: 'Selected category does not exist.',
      };
    }

    const actorData = actorDoc.data() as UserProfile;
    const ticketData = ticketDoc.data()!;

    const targetCategoryName =
      targetCategoryDoc.data()!.name as string;

    if (!targetCategoryName) {
      return {
        success: false,
        message: 'Invalid category configuration.',
      };
    }

    // Preserve current department authorization.
    if (
      actorData.role !== 'Admin' &&
      ticketData.departmentId &&
      actorData.departmentId !== ticketData.departmentId
    ) {
      return {
        success: false,
        message:
          'Permission denied: Ticket belongs to another department.',
      };
    }

    if (ticketData.departmentId === newCategoryId) {
      return {
        success: false,
        message: 'Ticket already belongs to this category.',
      };
    }

    // 2. Check for existing pending requests.
    const existingRequests = await db
      .collection('ticket-events')
      .where('ticketId', '==', ticketId)
      .where('eventType', '==', 'TICKET_TRANSFER_REQUESTED')
      .where('status', '==', 'pending')
      .limit(1)
      .get();

    if (
      !existingRequests.empty ||
      ticketData.pendingTransferRequestId
    ) {
      return {
        success: false,
        message:
          'A pending transfer request already exists for this ticket.',
      };
    }

    // 3. Find managers of the TARGET category.
    const targetManagersSnapshot = await db
      .collection('users')
      .where('departmentId', '==', newCategoryId)
      .where('role', '==', 'Manager')
      .get();

    const departmentOnly =
      isDepartmentOnly(targetCategoryName);

    const recipientIds = new Set<string>();

    targetManagersSnapshot.docs.forEach(doc => {
      const manager = doc.data() as UserProfile;

      if (
        managerMatchesTicket(
          manager,
          ticketData,
          departmentOnly
        )
      ) {
        recipientIds.add(doc.id);
      }
    });

    // Preserve existing Admin visibility.
    const adminsSnapshot = await db
      .collection('users')
      .where('role', '==', 'Admin')
      .get();

    adminsSnapshot.docs.forEach(doc => {
      recipientIds.add(doc.id);
    });

    if (recipientIds.size === 0) {
      return {
        success: false,
        message:
          'No eligible manager or administrator found for this transfer.',
      };
    }

    // Firestore transaction write limit protection.
    if (recipientIds.size > 490) {
      return {
        success: false,
        message: 'Too many recipients for one request.',
      };
    }

    const requestRef = db
      .collection('ticket-transfer-requests')
      .doc();

    const requestId = requestRef.id;

    // 4. Atomically create request,
    // notification events, and queue update.
    await db.runTransaction(async transaction => {
      const currentTicketDoc =
        await transaction.get(ticketRef);

      if (!currentTicketDoc.exists) {
        throw new Error('Ticket not found.');
      }

      const currentTicket = currentTicketDoc.data()!;

      // Prevent concurrent duplicate requests.
      if (currentTicket.pendingTransferRequestId) {
        throw new Error(
          'A pending transfer request already exists.'
        );
      }

      if (
        currentTicket.departmentId !==
        ticketData.departmentId
      ) {
        throw new Error(
          'Ticket department has changed. Please refresh.'
        );
      }

      const metadata = {
        requesterId: actorId,
        requesterName: actorName,

        fromDepartmentId:
          currentTicket.departmentId || null,
        fromDepartmentName:
          currentTicket.departmentName || null,

        toDepartmentId: newCategoryId,
        toDepartmentName: targetCategoryName,

        fromUserId:
          currentTicket.assignedTo?.userId || null,
        fromUserName:
          currentTicket.assignedTo?.name || 'Unassigned',

        previousAssignee:
          currentTicket.assignedTo || null,

        previousStatus:
          currentTicket.status || null,

        campusId:
          currentTicket.campusId || null,
        campusName:
          currentTicket.campusName || null,

        schoolId:
          currentTicket.schoolId || null,
        schoolName:
          currentTicket.schoolName || null,

        divisionId:
          currentTicket.divisionId || null,
        divisionName:
          currentTicket.divisionName || null,

        gradeId:
          currentTicket.gradeId || null,
        gradeName:
          currentTicket.gradeName || null,
      };

      // Store one canonical request for approval.
      transaction.set(requestRef, {
        ticketId,
        requestId,
        status: 'pending',

        requestedBy: {
          userId: actorId,
          name: actorName,
        },

        requestedCategoryId: newCategoryId,
        requestedCategoryName: targetCategoryName,

        recipientIds: Array.from(recipientIds),
        requestMetadata: metadata,

        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Create existing-style notifications.
      for (const recipientId of recipientIds) {
        const eventRef = db
          .collection('ticket-events')
          .doc();

        transaction.set(eventRef, {
          ticketId,
          eventType: 'TICKET_TRANSFER_REQUESTED',
          title: 'Transfer Requested',

          message:
            `${actorName} requested to move Ticket #` +
            `${currentTicket.ticketNumber || ticketId.substring(0, 4)}` +
            ` to ${targetCategoryName}.`,

          recipient: recipientId,
          read: false,

          timestamp: FieldValue.serverTimestamp(),
          status: 'pending',
          requestId,

          requestMetadata: metadata,
        });
      }

      // Move to Queue immediately.
      // Do NOT change department until approval.
      transaction.update(ticketRef, {
        status: 'Queue',
        assignedTo: null,
        assignedAt: null,

        pendingTransferRequestId: requestId,
        pendingTransferCategoryId: newCategoryId,
        pendingTransferCategoryName: targetCategoryName,

        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    // 5. Audit trail.
    try {
      await logSystemEvent({
        eventType: 'TICKET_TRANSFER_REQUESTED',

        actor: {
          userId: actorId,
          name: actorName,
        },

        message:
          `${actorName} requested to transfer ticket ` +
          `to category "${targetCategoryName}".`,

        details: {
          ticketId,
          requestId,
          targetCategoryId: newCategoryId,
          targetCategoryName,
        },
      });
    } catch (logError) {
      console.error('Transfer request audit error:', logError);
    }

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/tickets');
    revalidatePath('/requests');
    revalidatePath('/dashboard');

    return {
      success: true,
      message:
        `Transfer request sent for approval to ` +
        `${targetCategoryName}. Ticket moved to Queue.`,
    };

  } catch (error: any) {
    console.error('Request Transfer Error:', error);

    return {
      success: false,
      message:
        error?.message ||
        'An unexpected error occurred.',
    };
  }
}
