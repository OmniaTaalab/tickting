import admin from 'firebase-admin';
import 'dotenv/config';

let adminAuth: admin.auth.Auth | null = null;
let adminStorage: admin.storage.Storage | null = null;
let adminDb: admin.firestore.Firestore | null = null;

function normalizePrivateKey(key: string | undefined): string | null {
  if (!key) return null;

  let formatted = key.trim();

  // Remove wrapping quotes
  if (
    (formatted.startsWith('"') && formatted.endsWith('"')) ||
    (formatted.startsWith("'") && formatted.endsWith("'"))
  ) {
    formatted = formatted.slice(1, -1).trim();
  }

  // Convert escaped newlines to real newlines
  formatted = formatted
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '');

  // Support base64 encoded private keys
  if (!formatted.includes('-----BEGIN') && formatted.length > 100) {
    try {
      const decoded = Buffer.from(formatted, 'base64').toString('utf8');

      if (decoded.includes('-----BEGIN')) {
        formatted = decoded.trim();
      }
    } catch {
      // Ignore base64 decoding error
    }
  }

  const validPrivateKey =
    formatted.includes('-----BEGIN PRIVATE KEY-----') &&
    formatted.includes('-----END PRIVATE KEY-----');

  const validRsaKey =
    formatted.includes('-----BEGIN RSA PRIVATE KEY-----') &&
    formatted.includes('-----END RSA PRIVATE KEY-----');

  if (!validPrivateKey && !validRsaKey) {
    return null;
  }

  return formatted;
}

function initializeFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(
    process.env.FIREBASE_PRIVATE_KEY
  );

  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ||
    (projectId ? `${projectId}.firebasestorage.app` : undefined);

  /*
   * IMPORTANT:
   * Do NOT fall back to Google AI Studio's default credentials.
   *
   * All three values must belong to the same Firebase project.
   */
 if (!projectId || !clientEmail || !privateKey) {
  throw new Error(
    `Firebase Admin config error:
    PROJECT_ID=${projectId ? 'OK' : 'MISSING'},
    CLIENT_EMAIL=${clientEmail ? 'OK' : 'MISSING'},
    PRIVATE_KEY=${privateKey ? 'OK' : 'MISSING OR INVALID'}`
  );
}

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),

      projectId,

      ...(storageBucket
        ? { storageBucket }
        : {}),
    });

    console.log(
      `[FirebaseAdmin] Initialized successfully for project: ${projectId}`
    );

    console.log(
      `[FirebaseAdmin] Service account: ${clientEmail}`
    );
  } catch (error: any) {
    console.error(
      '[FirebaseAdmin] Initialization failed:',
      error?.message || error
    );
  }
}

initializeFirebaseAdmin();

if (admin.apps.length > 0) {
  try {
    adminAuth = admin.auth();
    adminDb = admin.firestore();
    adminStorage = admin.storage();
  } catch (error: any) {
    console.error(
      '[FirebaseAdmin] Could not initialize Firebase services:',
      error?.message || error
    );
  }
}

export {
  adminAuth,
  adminDb,
  adminStorage,
};

