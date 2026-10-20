'use server';

import { OAuth2Client } from 'google-auth-library';
import { adminDb, adminAuth } from '@/lib/firebaseAdmin';

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;

type Result = {
  success: boolean;
  status: 'ALLOWED' | 'NOT_REGISTERED' | 'INACTIVE' | 'ERROR';
  message: string;
  customToken?: string;
  userProfile?: { id: string; name: string; email: string; role: string; departmentId?: string; campusIds?: string[] };
};
const deny = (status: Result['status'], message: string): Result => ({ success: false, status, message });
const normalize = (email: unknown) => typeof email === 'string' ? email.trim().toLowerCase() : '';

export async function verifyGoogleUserAction({ googleIdToken }: { googleIdToken: string }): Promise<Result> {
  if (!adminDb || !adminAuth || !CLIENT_ID) return deny('ERROR', 'Authentication is not configured. Contact your administrator.');
  if (!googleIdToken || typeof googleIdToken !== 'string') return deny('ERROR', 'Google sign-in failed. Try again.');
  try {
    const ticket = await new OAuth2Client(CLIENT_ID).verifyIdToken({ idToken: googleIdToken, audience: CLIENT_ID });
    const claims = ticket.getPayload();
    const email = normalize(claims?.email);
    if (!claims || !email || claims.email_verified !== true || !claims.sub) {
      return deny('NOT_REGISTERED', 'This Google account is not authorized.');
    }

    const users = adminDb.collection('users');
    // emailLower is preferred; fall back to legacy exact email and bounded legacy scans.
    const candidates = new Map<string, FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot>();
    for (const field of ['emailLower', 'email']) {
      for (const value of [email, claims.email!]) {
        const snapshot = await users.where(field, '==', value).limit(5).get();
        snapshot.docs.forEach(doc => candidates.set(doc.id, doc));
      }
    }
    if (candidates.size === 0) {
      // Compatibility with existing records with mixed-case email and no emailLower.
      const legacy = await users.get();
      legacy.docs.filter(d => normalize(d.data().email) === email).forEach(d => candidates.set(d.id, d));
    }
    const records = Array.from(candidates.values()).filter(d => normalize(d.data()?.email) === email);
    if (records.length === 0) return deny('NOT_REGISTERED', 'This Google account is not registered in the system. Please contact your administrator.');
    if (records.length > 1) return deny('ERROR', 'Multiple employee records match this email. Contact your administrator.');

    const profile = records[0];
    const user = profile.data()!;
    const state = String(user.status || '').toLowerCase();
    if (user.isActive === false || user.disabled === true || user.isDeactivated === true || ['inactive', 'disabled', 'deactivated'].includes(state)) {
      return deny('INACTIVE', 'Your account is inactive. Please contact your administrator.');
    }

    const existingAuthUser = await adminAuth.getUserByEmail(email).catch((e: any) => {
      if (e?.code === 'auth/user-not-found') return null;
      throw e;
    });
    const uid = existingAuthUser?.uid || profile.id;
    if (existingAuthUser?.disabled) return deny('INACTIVE', 'Your account is inactive. Please contact your administrator.');
    // Preserve Firestore document/UID mapping expected by application hooks and security rules.
    // If the old flow linked a different UID, require an explicit migration instead of duplicating records.
    if (uid !== profile.id) {
      return deny('ERROR', 'This employee needs an account linking review. Please contact your administrator.');
    }
    const authAtUid = await adminAuth.getUser(uid).catch((e: any) => {
      if (e?.code === 'auth/user-not-found') return null;
      throw e;
    });
    if (authAtUid?.email && normalize(authAtUid.email) !== email) {
      return deny('ERROR', 'The employee UID is linked to a different account. Contact your administrator.');
    }
    // Custom tokens are issued ONLY after verified Google identity + approved Firestore employee.
    const customToken = await adminAuth.createCustomToken(uid);
    return {
      success: true,
      status: 'ALLOWED',
      message: 'Authentication successful.',
      customToken,
      userProfile: { id: uid, name: user.name || '', email, role: user.role || 'Employee', departmentId: user.departmentId, campusIds: user.campusIds || [] },
    };
  } catch (error) {
    console.error('[verifyGoogleUserAction] Verification failed:', error);
    return deny('ERROR', 'Unable to verify Google account right now. Please try again.');
  }
}
