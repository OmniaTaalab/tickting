'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';

/**
 * Removes a specific message from a ticket's message array.
 */
export async function deleteTicketMessageAction(ticketId: string, messageId: string) {
    const db = adminDb;
    if (!db) return { success: false, message: 'Database error' };

    try {
        const ticketRef = db.collection('tickets').doc(ticketId);
        const ticketDoc = await ticketRef.get();
        if (!ticketDoc.exists) return { success: false, message: 'Ticket not found' };

        const data = ticketDoc.data()!;
        const messages = data.messages || [];
        const updatedMessages = messages.filter((m: any) => m.id !== messageId);

        await ticketRef.update({
            messages: updatedMessages,
            updatedAt: FieldValue.serverTimestamp()
        });

        revalidatePath(`/tickets/${ticketId}`);
        return { success: true };
    } catch (e: any) {
        console.error("Delete message error:", e);
        return { success: false, message: e.message };
    }
}
