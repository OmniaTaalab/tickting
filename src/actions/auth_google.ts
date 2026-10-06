'use server';

import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { UserProfile } from '@/lib/types';

export interface VerifyGoogleUserResult {
  success: boolean;
  status: 'ALLOWED' | 'NOT_REGISTERED' | 'INACTIVE' | 'ERROR';
  message: string;
  userProfile?: {
    id: string;
    name: string;
    email: string;
    role: string;
    departmentId?: string;
    campusIds?: string[];
  };
}

/**
 * Validates a Google-authenticated user against existing system/employee records in Firestore.
 * Ensures:
 * 1. The email must already exist in Firestore `users`.
 * 2. Does NOT create a new employee profile if unapproved.
 * 3. Checks if the account is deactivated or inactive.
 * 4. Links the Google UID if necessary without creating duplicates.
 */
export async function verifyGoogleUserAction(params: {
  email: string;
  googleUid: string;
}): Promise<VerifyGoogleUserResult> {
  const db = adminDb;
  const auth = adminAuth;

  if (!db) {
    return {
      success: false,
      status: 'ERROR',
      message: 'Database connection is temporarily unavailable. Please try again.',
    };
  }

  const rawEmail = (params.email || '').trim();
  const normalizedEmail = rawEmail.toLowerCase();
  const googleUid = (params.googleUid || '').trim();

  if (!rawEmail || !googleUid) {
    return {
      success: false,
      status: 'NOT_REGISTERED',
      message: 'This Google account is not registered in the system. Please contact your administrator.',
    };
  }

  try {
    // 1. Check if user document exists with exact googleUid
    let userDoc = await db.collection('users').doc(googleUid).get();
    let userData: any = null;
    let existingDocId = googleUid;

    if (userDoc.exists) {
      userData = userDoc.data();
      existingDocId = userDoc.id;
    } else {
      // 2. Query by email
      const queryByEmail = await db
        .collection('users')
        .where('email', '==', rawEmail)
        .limit(1)
        .get();

      if (!queryByEmail.empty) {
        userDoc = queryByEmail.docs[0];
        userData = userDoc.data();
        existingDocId = userDoc.id;
      } else {
        // Try query by lowercased email
        const queryByLowerEmail = await db
          .collection('users')
          .where('email', '==', normalizedEmail)
          .limit(1)
          .get();

        if (!queryByLowerEmail.empty) {
          userDoc = queryByLowerEmail.docs[0];
          userData = userDoc.data();
          existingDocId = userDoc.id;
        } else {
          // Fallback: scan all users to match case-insensitively
          const allUsersSnapshot = await db.collection('users').get();
          const matched = allUsersSnapshot.docs.find((d) => {
            const docEmail = (d.data()?.email || '').trim().toLowerCase();
            return docEmail === normalizedEmail;
          });

          if (matched) {
            userDoc = matched;
            userData = matched.data();
            existingDocId = matched.id;
          }
        }
      }
    }

    // If user does not exist in the system
    if (!userData) {
      return {
        success: false,
        status: 'NOT_REGISTERED',
        message: 'This Google account is not registered in the system. Please contact your administrator.',
      };
    }

    // 3. Check if user is inactive / deactivated
    const isInactive =
      userData.isActive === false ||
      userData.disabled === true ||
      userData.isDeactivated === true ||
      userData.status === 'Inactive' ||
      userData.status === 'Disabled';

    if (isInactive) {
      return {
        success: false,
        status: 'INACTIVE',
        message: 'Your account is inactive. Please contact your administrator.',
      };
    }

    // Check Firebase Auth disabled state if auth SDK is available
    if (auth) {
      try {
        const authUser = await auth.getUser(googleUid).catch(() => null);
        if (authUser?.disabled) {
          return {
            success: false,
            status: 'INACTIVE',
            message: 'Your account is inactive. Please contact your administrator.',
          };
        }
      } catch {
        // Ignore auth user lookup failure
      }
    }

    // 4. If existingDocId is different from googleUid, ensure seamless linkage without duplicates
    if (existingDocId !== googleUid) {
      // Check if doc(googleUid) already exists
      const targetDoc = await db.collection('users').doc(googleUid).get();
      if (!targetDoc.exists) {
        // Copy existing profile to googleUid so all client hooks & firestore rules work seamlessly
        await db.collection('users').doc(googleUid).set({
          ...userData,
          id: googleUid,
          authId: googleUid,
          linkedFromUserId: existingDocId,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Mark the old document as linked so it is not shown as a duplicate employee
        await db.collection('users').doc(existingDocId).update({
          authId: googleUid,
          isLinkedTo: googleUid,
          updatedAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    }

    return {
      success: true,
      status: 'ALLOWED',
      message: 'Authentication successful.',
      userProfile: {
        id: googleUid,
        name: userData.name || '',
        email: userData.email || rawEmail,
        role: userData.role || 'Employee',
        departmentId: userData.departmentId,
        campusIds: userData.campusIds || [],
      },
    };
  } catch (error: any) {
    console.error('[verifyGoogleUserAction] Error verifying user:', error);
    return {
      success: false,
      status: 'ERROR',
      message: 'An unexpected error occurred while verifying your account. Please try again.',
    };
  }
}
