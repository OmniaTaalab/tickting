
import admin from 'firebase-admin';
import 'dotenv/config';

let adminAuth: admin.auth.Auth | null = null;
let adminStorage: admin.storage.Storage | null = null;
let adminDb: admin.firestore.Firestore | null = null;
let adminMessaging: admin.messaging.Messaging | null = null;

const privateKey = process.env.FIREBASE_PRIVATE_KEY
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

const serviceAccount: admin.ServiceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID!,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
  privateKey: privateKey!,
};

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`
    });
  } catch (error: any) {
    console.error('Firebase admin initialization error:', error.message);
  }
}

adminAuth = admin.auth();
adminDb = admin.firestore();
adminStorage = admin.storage();

export { adminAuth, adminDb, adminStorage };
