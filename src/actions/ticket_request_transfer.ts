
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
  campusId: z.string().optional().default(''),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type RequestTransferState = {
  success: boolean;
  message?: string;
};

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

function managerMatchesTicket(
  manager: UserProfile,
  ticket: Record<string, any>,
  _departmentOnly: boolean
): boolean {
  // Approval belongs to the manager of the destination category and campus.
  // School / Division / Grade are not requirements for selecting an approver.
  if (!ticket.campusId) return true; // Legacy tickets without a campus.
  const m = manager as UserProfile & Record<string, any>;
  return values(m.campusIds, m.campusId).includes(ticket.campusId);
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
    campusId: formData.get('campusId') || '',
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
    campusId: selectedCampusId,
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
    // Only the explicit choice overrides the existing campus.
    const targetCampusId = selectedCampusId || ticketData.campusId || '';
    const campusChanged = !!selectedCampusId && selectedCampusId !== (ticketData.campusId || '');
    const targetCampusDoc = targetCampusId
      ? await db.collection('campuses').doc(targetCampusId).get()
      : null;
    if (selectedCampusId && !targetCampusDoc?.exists)
      return { success: false, message: 'Selected Campus does not exist.' };
    const targetCampusName = targetCampusDoc?.data()?.name || (campusChanged ? '' : ticketData.campusName) || null;
    const targetScope = {
      ...ticketData,
      campusId: targetCampusId || null,
      campusName: targetCampusName,
      ...(campusChanged ? {
        schoolId: null, schoolName: null, school: null,
        divisionId: null, divisionName: null, division: null,
        gradeId: null, gradeName: null, grade: null,
      } : {}),
    };

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

    const recipientIds = new Set<string>();

    targetManagersSnapshot.docs.forEach(doc => {
      const manager = doc.data() as UserProfile;

      if (
        managerMatchesTicket(
          manager,
          targetScope,
          false // Approver must match the destination campus, even for General Support/Operations.
        )
      ) {
        recipientIds.add(doc.id);
      }
    });

    if (recipientIds.size === 0) {
      return {
        success: false,
        message:
          'No manager found for the destination Category and Campus.',
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
      if (currentTicket.pendingTransferRequestId || currentTicket.pendingLocalTransferRequestId) {
        throw new Error(
          'A pending transfer request already exists.'
        );
      }

      if (
        currentTicket.departmentId !==
         ticketData.departmentId ||
         (currentTicket.campusId || '') !== (ticketData.campusId || '')
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

        campusId: targetCampusId || null,
        campusName: targetCampusName,
        fromCampusId: currentTicket.campusId || null,
        fromCampusName: currentTicket.campusName || null,
        toCampusId: targetCampusId || null,
        toCampusName: targetCampusName,
        campusChanged,

        schoolId:
          campusChanged ? null : (currentTicket.schoolId || null),
        schoolName:
          campusChanged ? null : (currentTicket.schoolName || null),

        divisionId:
          campusChanged ? null : (currentTicket.divisionId || null),
        divisionName:
          campusChanged ? null : (currentTicket.divisionName || null),

        gradeId:
          campusChanged ? null : (currentTicket.gradeId || null),
        gradeName:
          campusChanged ? null : (currentTicket.gradeName || null),
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
        requestedCampusId: targetCampusId || null,
        requestedCampusName: targetCampusName,

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
            ` to ${targetCategoryName}${targetCampusName ? ` / ${targetCampusName}` : ''}.`,

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
        pendingTransferCampusId: targetCampusId || null,
        pendingTransferCampusName: targetCampusName,

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
          targetCampusId: targetCampusId || null,
          targetCampusName,
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
