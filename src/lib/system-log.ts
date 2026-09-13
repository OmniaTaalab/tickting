
'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

interface SystemLogPayload {
    eventType: string;
    actor: {
        userId: string;
        name: string;
    };
    message: string;
    details?: Record<string, any>;
}

export async function logSystemEvent(payload: SystemLogPayload) {
    const db = adminDb;
    if (!db) {
        console.error("System Log Error: Firebase Admin not configured.");
        return;
    }

    try {
        const logEntry = {
            ...payload,
            timestamp: FieldValue.serverTimestamp(),
        };
        await db.collection('system-logs').add(logEntry);
    } catch (error) {
        console.error("Failed to write to system log:", error);
    }
}
