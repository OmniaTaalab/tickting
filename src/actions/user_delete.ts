
'use server';

import { z } from 'zod';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';
import { FieldValue } from 'firebase-admin/firestore';
import type { Ticket, UserProfile } from '@/lib/types';

const DeleteUserSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  authId: z.string().optional(),
  userName: z.string().min(1, "User name is required"),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type DeleteUserState = {
  errors?: {
    form?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function deleteUserAction(
  prevState: DeleteUserState,
  formData: FormData
): Promise<DeleteUserState> {
  
  if (!adminAuth || !adminDb) {
    const errorMessage = "Firebase Admin SDK is not configured.";
    return {
        errors: { form: [errorMessage] },
        message: 'Server configuration error.',
        success: false,
    };
  }

  const validatedFields = DeleteUserSchema.safeParse({
    userId: formData.get('userId'),
    authId: formData.get('authId'),
    userName: formData.get('userName'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validatedFields.success) {
    return {
      errors: { form: ['Invalid user data provided.'] },
      message: 'Validation failed.',
      success: false,
    };
  }

  const { userId, authId, userName, actorId, actorName } = validatedFields.data;

  try {
    // 1. Determine the UID for Firebase Auth
    const uidToDelete = authId && authId.trim() !== '' ? authId : userId;

    // 2. Query all open/active tickets assigned to this employee
    const ticketsSnapshot = await adminDb.collection('tickets')
      .where('assignedTo.userId', '==', userId)
      .get();

    const terminalStatuses = ['Resolved', 'Closed', 'Duplicate'];
    const openTicketDocs = ticketsSnapshot.docs.filter(doc => {
      const data = doc.data() as Ticket;
      return !terminalStatuses.includes(data.status);
    });

    // 3. Fetch all other users to find available replacement agents
    const usersSnapshot = await adminDb.collection('users').get();
    const otherUsers = usersSnapshot.docs
      .filter(doc => doc.id !== userId)
      .map(doc => ({ id: doc.id, ...(doc.data() as UserProfile) }));

    let reassignedCount = 0;
    let queuedCount = 0;
    const reassignmentLogs: Array<{ ticketId: string; ticketNumber?: number | string; toUserName: string; toUserId: string }> = [];

    // Track round-robin index per candidate pool key so tickets are evenly distributed
    const poolPointers: Record<string, number> = {};

    for (const ticketDoc of openTicketDocs) {
      const ticket = ticketDoc.data() as Ticket;
      const deptId = ticket.departmentId;
      const campusId = ticket.campusId;

      // Tier 1: Employees/Managers in the same category
      const deptStaff = otherUsers.filter(u => u.departmentId === deptId && (u.role === 'Employee' || u.role === 'Manager'));

      // Filter by campus coverage if campus is specified
      const campusMatchingDeptStaff = deptStaff.filter(u => {
        if (!campusId || campusId === 'all' || campusId === 'N/A') return true;
        return u.campusIds && u.campusIds.includes(campusId);
      });

      // Prefer available staff (status !== 'Busy')
      const availableCampusDeptStaff = campusMatchingDeptStaff.filter(u => u.status !== 'Busy');
      const availableDeptStaff = deptStaff.filter(u => u.status !== 'Busy');

      // Global fallbacks if category has no active staff
      const globalAvailableStaff = otherUsers.filter(u => u.status !== 'Busy' && (u.role === 'Employee' || u.role === 'Manager'));
      const globalStaff = otherUsers.filter(u => u.role === 'Employee' || u.role === 'Manager');

      let candidatePool: UserProfile[] = [];
      let poolKey = 'fallback';

      if (availableCampusDeptStaff.length > 0) {
        candidatePool = availableCampusDeptStaff;
        poolKey = `dept_${deptId}_campus_${campusId}_avail`;
      } else if (campusMatchingDeptStaff.length > 0) {
        candidatePool = campusMatchingDeptStaff;
        poolKey = `dept_${deptId}_campus_${campusId}_all`;
      } else if (availableDeptStaff.length > 0) {
        candidatePool = availableDeptStaff;
        poolKey = `dept_${deptId}_avail`;
      } else if (deptStaff.length > 0) {
        candidatePool = deptStaff;
        poolKey = `dept_${deptId}_all`;
      } else if (globalAvailableStaff.length > 0) {
        candidatePool = globalAvailableStaff;
        poolKey = 'global_avail';
      } else if (globalStaff.length > 0) {
        candidatePool = globalStaff;
        poolKey = 'global_staff';
      } else if (otherUsers.length > 0) {
        candidatePool = otherUsers;
        poolKey = 'all_remaining';
      }

      if (candidatePool.length > 0) {
        // Pick next assignee via fair round-robin distribution
        const currentIndex = poolPointers[poolKey] || 0;
        const chosenAssignee = candidatePool[currentIndex % candidatePool.length];
        poolPointers[poolKey] = (currentIndex + 1) % candidatePool.length;

        const newAssigneePayload = {
          userId: chosenAssignee.id,
          name: chosenAssignee.name,
          email: chosenAssignee.email || '',
          avatarUrl: chosenAssignee.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(chosenAssignee.name)}`,
        };

        const currentMessages = Array.isArray(ticket.messages) ? ticket.messages : [];
        const systemAuditMessage = {
          id: String(Date.now() + Math.floor(Math.random() * 1000)),
          author: {
            userId: 'system',
            name: 'System Reassignment',
            avatarUrl: 'https://api.dicebear.com/9.x/bottts/svg?seed=SystemReassign',
          },
          text: `Ticket automatically reassigned to ${chosenAssignee.name} because previous assignee (${userName}) was removed from the system.`,
          createdAt: new Date().toISOString(),
          isInternal: true,
        };

        await ticketDoc.ref.update({
          assignedTo: newAssigneePayload,
          status: ticket.status === 'Queue' ? 'Open' : (ticket.status || 'Open'),
          assignedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          messages: [...currentMessages, systemAuditMessage],
        });

        // Send in-app notification to the newly assigned agent
        await adminDb.collection('ticket-events').add({
          ticketId: ticketDoc.id,
          eventType: 'TICKET_STATUS_CHANGED',
          title: 'Ticket Reassigned to You',
          message: `Ticket #${ticket.ticketNumber || ticketDoc.id} ("${(ticket.subject || ticket.title || '').substring(0, 35)}...") was automatically reassigned to you after staff member deletion.`,
          recipient: chosenAssignee.id,
          read: false,
          timestamp: FieldValue.serverTimestamp(),
        });

        reassignedCount++;
        reassignmentLogs.push({
          ticketId: ticketDoc.id,
          ticketNumber: ticket.ticketNumber,
          toUserName: chosenAssignee.name,
          toUserId: chosenAssignee.id,
        });
      } else {
        // No other users in system: move ticket to Queue
        await ticketDoc.ref.update({
          assignedTo: FieldValue.delete(),
          assignedAt: FieldValue.delete(),
          status: 'Queue',
          updatedAt: FieldValue.serverTimestamp(),
        });
        queuedCount++;
      }
    }

    // 4. Remove responsible user reference from departments if applicable
    const responsibleDeptsSnap = await adminDb.collection('departments')
      .where('responsibleUserId', '==', userId)
      .get();

    for (const dDoc of responsibleDeptsSnap.docs) {
      await dDoc.ref.update({
        responsibleUserId: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    // 5. Delete the user from Firebase Auth to revoke access immediately
    try {
      await adminAuth.deleteUser(uidToDelete);
    } catch (authError: any) {
      if (authError.code === 'auth/user-not-found') {
        console.warn(`User ${uidToDelete} not found in Firebase Auth, proceeding with Firestore deletion.`);
      } else {
        console.error('Error deleting from Firebase Auth:', authError);
      }
    }

    // 6. Delete the user from Firestore
    await adminDb.collection('users').doc(userId).delete();

    // 7. Log the system event with reassignments summary
    await logSystemEvent({
      eventType: 'USER_DELETED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} deleted user ${userName} and revoked their login access.${reassignedCount > 0 ? ` Reassigned ${reassignedCount} open ticket(s) to available staff.` : ''}`,
      details: {
        deletedUserId: userId,
        deletedUserName: userName,
        deletedAuthId: uidToDelete,
        reassignedTicketsCount: reassignedCount,
        queuedTicketsCount: queuedCount,
        reassignments: reassignmentLogs,
      }
    });
    
    revalidatePath('/users');
    revalidatePath('/settings');
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    revalidatePath('/tasks');
    
    let resultMessage = `Successfully deleted ${userName} and revoked system access.`;
    if (reassignedCount > 0) {
      resultMessage += ` ${reassignedCount} open ticket${reassignedCount > 1 ? 's were' : ' was'} automatically reassigned to available staff.`;
    }
    if (queuedCount > 0) {
      resultMessage += ` ${queuedCount} ticket${queuedCount > 1 ? 's were' : ' was'} moved to Queue.`;
    }

    return {
      success: true,
      message: resultMessage,
    };

  } catch (error: any) {
    console.error('Error in deleteUserAction:', error);
    return {
      errors: { form: [error.message || 'An unexpected error occurred during deletion.'] },
      message: 'Failed to delete user completely.',
      success: false,
    };
  }
}

