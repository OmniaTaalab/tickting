'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';

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
        const targetMessage = messages.find((m: any) => m.id === messageId);
        const updatedMessages = messages.filter((m: any) => m.id !== messageId);

        await ticketRef.update({
            messages: updatedMessages,
            updatedAt: FieldValue.serverTimestamp()
        });

        await logSystemEvent({
            eventType: 'TICKET_MESSAGE_DELETED',
            actor: { userId: 'admin', name: 'Admin/Manager' },
            message: `A message (${targetMessage?.isInternal ? 'internal note' : 'reply'}) was deleted from Ticket #${data.ticketNumber || ticketId.substring(0, 4)}.`,
            details: {
                ticketId,
                ticketNumber: data.ticketNumber,
                messageId,
                authorName: targetMessage?.author?.name || 'Unknown'
            }
        });

        revalidatePath(`/tickets/${ticketId}`);
        return { success: true };
    } catch (e: any) {
        console.error("Delete message error:", e);
        return { success: false, message: e.message };
    }
}
