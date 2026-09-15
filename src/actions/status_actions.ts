'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { UserStatus } from '@/lib/types';
import { format } from 'date-fns';
import { autoAssignQueuedTickets } from './ticket_assignment';
import { logSystemEvent } from '@/lib/system-log';

/**
 * Toggles user status between 'Available' and 'Busy' and manages work sessions atomically.
 */
export async function toggleUserStatusAction(userId: string, targetStatus: UserStatus) {
  const db = adminDb;
  if (!db) {
    return { success: false, message: "Firebase Admin not configured" };
  }

  const userRef = db.collection('users').doc(userId);
  const now = new Date();
  const dateKey = format(now, 'yyyy-MM-dd');
  let userDepartmentId: string | undefined = undefined;
  let changedUserName: string = 'Staff';

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) return;

      const userData = userDoc.data()!;
      changedUserName = userData.name || 'Staff';
      const currentStatus = userData.status || 'Busy';
      const departmentId = userData.departmentId || null;
      userDepartmentId = departmentId || undefined;

      // Duplicate prevention
      if (currentStatus === targetStatus) return;

      if (targetStatus === 'Busy') {
        // Available -> Busy: End current session
        const activeSessionId = userData.activeSessionId;
        
        if (activeSessionId) {
          const sessionRef = db.collection('work-sessions').doc(activeSessionId);
          const sessionDoc = await transaction.get(sessionRef);

          if (sessionDoc.exists) {
            const sessionData = sessionDoc.data()!;
            const startedAt = sessionData.startedAt.toDate();
            const durationInMinutes = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 60000));

            transaction.update(sessionRef, {
              endedAt: FieldValue.serverTimestamp(),
              durationInMinutes,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }
        }

        transaction.update(userRef, {
          status: 'Busy',
          lastStatusChangedAt: FieldValue.serverTimestamp(),
          activeSessionId: FieldValue.delete(),
          currentSessionStartedAt: FieldValue.delete(),
        });
      } else {
        // Busy -> Available: Start new session
        const sessionRef = db.collection('work-sessions').doc();
        transaction.set(sessionRef, {
          userId,
          userName: userData.name,
          departmentId,
          startedAt: FieldValue.serverTimestamp(),
          dateKey,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });

        transaction.update(userRef, {
          status: 'Available',
          currentSessionStartedAt: FieldValue.serverTimestamp(),
          lastStatusChangedAt: FieldValue.serverTimestamp(),
          activeSessionId: sessionRef.id,
        });
      }
    });

    await logSystemEvent({
      eventType: 'USER_STATUS_CHANGED',
      actor: { userId, name: changedUserName },
      message: `${changedUserName} changed presence status to "${targetStatus}".`,
      details: { userId, status: targetStatus, departmentId: userDepartmentId },
    });

    // When an agent becomes Available, automatically trigger round-robin assignment for queued tickets
    if (targetStatus === 'Available') {
      try {
        await autoAssignQueuedTickets({ departmentId: userDepartmentId });
      } catch (autoAssignErr) {
        console.warn("Background auto-assignment on status change:", autoAssignErr);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error("Status toggle failed:", error);
    return { success: false, message: error.message };
  }
}
