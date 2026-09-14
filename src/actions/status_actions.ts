'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { UserStatus } from '@/lib/types';
import { format } from 'date-fns';

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

  try {
    await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      if (!userDoc.exists) return;

      const userData = userDoc.data()!;
      const currentStatus = userData.status || 'Busy';
      const departmentId = userData.departmentId || null;

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

    return { success: true };
  } catch (error: any) {
    console.error("Status toggle failed:", error);
    return { success: false, message: error.message };
  }
}