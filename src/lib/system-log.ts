
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

function sanitizeForFirestore(val: any): any {
    if (val === undefined) return null;
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(sanitizeForFirestore);
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
        result[k] = v === undefined ? null : sanitizeForFirestore(v);
    }
    return result;
}

export async function logSystemEvent(payload: SystemLogPayload) {
    const db = adminDb;
    if (!db) {
        console.error("System Log Error: Firebase Admin not configured.");
        return;
    }

    try {
        const sanitizedDetails = payload.details ? sanitizeForFirestore(payload.details) : {};
        const logEntry = {
            eventType: payload.eventType || 'GENERAL_EVENT',
            actor: {
                userId: payload.actor?.userId || 'system',
                name: payload.actor?.name || 'System',
            },
            message: payload.message || '',
            details: sanitizedDetails,
            timestamp: FieldValue.serverTimestamp(),
        };
        await db.collection('system-logs').add(logEntry);
    } catch (error) {
        console.error("Failed to write to system log:", error);
    }
}
