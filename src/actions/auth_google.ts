
    'use server';

import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
import type { DecodedIdToken } from 'firebase-admin/auth';

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
 * Verify the Firebase ID token on the server; never trust an email/UID supplied
 * by a browser. This only authorizes an application login. It does NOT prevent
 * Firebase Authentication from creating a Google user during signInWithPopup.
 *
 * IMPORTANT: Enforce the same authorization in Firestore Security Rules and
 * privileged server actions; a client-side login check alone is not security.
 */
export async function verifyGoogleUserAction(params: {
  idToken: string;
}): Promise<VerifyGoogleUserResult> {
  const reject = (
    status: VerifyGoogleUserResult['status'],
    message: string
  ): VerifyGoogleUserResult => ({ success: false, status, message });

  if (!adminDb || !adminAuth) {
    return reject('ERROR', 'Authentication service is temporarily unavailable. Please try again.');
  }
  if (!params?.idToken || typeof params.idToken !== 'string') {
    return reject('ERROR', 'Missing authentication credentials. Please sign in again.');
  }

  try {
    // Verify signature, expiry, issuer/audience and revocation using Firebase Admin.
    const decoded: DecodedIdToken = await adminAuth.verifyIdToken(params.idToken, true);
    const uid = decoded.uid;
    const email = decoded.email?.trim().toLowerCase();
    if (!email || decoded.email_verified !== true) {
      return reject('NOT_REGISTERED', 'A verified Google email is required. Please contact your administrator.');
    }

    // Require the authentication provider to be Google, not merely an email match.
    if (decoded.firebase?.sign_in_provider !== 'google.com') {
      return reject('NOT_REGISTERED', 'Please sign in using your registered Google account.');
    }

    const authUser = await adminAuth.getUser(uid);
    if (authUser.disabled) {
      return reject('INACTIVE', 'Your account is inactive. Please contact your administrator.');
    }

    const users = adminDb.collection('users');
    const byUid = await users.doc(uid).get();
    let profileDoc = byUid.exists ? byUid : undefined;

    // Never accept a UID-linked profile with a different email address.
    if (profileDoc) {
      const profileEmail = String(profileDoc.data()?.email ?? '').trim().toLowerCase();
      if (profileEmail !== email) {
        console.error('[verifyGoogleUserAction] UID/email mismatch:', uid);
        return reject('ERROR', 'Your account has a profile mismatch. Please contact your administrator.');
      }
    } else {
      // Compatibility with older employee documents keyed by an employee ID.
      // Prefer a normalized `emailLower` field for all new/updated profiles.
      const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
      for (const field of ['emailLower', 'email']) {
        const result = await users.where(field, '==', email).limit(2).get();
        result.docs.forEach((doc) => candidates.set(doc.id, doc));
      }
      // Legacy capitalization support: avoid scanning all employees on login.
      // Run a one-time data backfill to populate emailLower for legacy records.
      if (candidates.size > 1) {
        console.error('[verifyGoogleUserAction] Duplicate employee email:', email);
        return reject('ERROR', 'Multiple employee records use this email. Please contact your administrator.');
      }
      profileDoc = candidates.values().next().value;
    }

    if (!profileDoc) {
      return reject('NOT_REGISTERED', 'This Google account is not registered in the system. Please contact your administrator.');
    }

    const userData = profileDoc.data() || {};
    const profileEmail = String(userData.email ?? '').trim().toLowerCase();
    if (profileEmail !== email) {
      return reject('ERROR', 'Your account has a profile mismatch. Please contact your administrator.');
    }
    const status = String(userData.status ?? '').trim().toLowerCase();
    const isInactive =
      userData.isActive === false ||
      userData.disabled === true ||
      userData.isDeactivated === true ||
      ['inactive', 'disabled', 'deactivated'].includes(status);

    if (isInactive) {
      return reject('INACTIVE', 'Your account is inactive. Please contact your administrator.');
    }

    // Do not copy or rewrite profile documents during login: that creates
    // duplicate employees and can break references/permissions.
    return {
      success: true,
      status: 'ALLOWED',
      message: 'Authentication successful.',
      userProfile: {
        id: profileDoc.id, // The existing canonical Firestore employee profile ID
        name: String(userData.name ?? ''),
        email: String(userData.email ?? email),
        role: String(userData.role ?? 'Employee'),
        departmentId: userData.departmentId,
        campusIds: Array.isArray(userData.campusIds) ? userData.campusIds : [],
      },
    };
  } catch (error) {
    console.error('[verifyGoogleUserAction] Verification failed:', error);
    return reject('ERROR', 'Unable to verify your account. Please try again.');
  }
}
