'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

export async function deleteTicketAction(
  ticketId: string, 
  actor: { userId: string; name: string }
) {
  const db = adminDb;
  if (!db) {
    return { success: false, message: 'Database error: Firebase Admin is not configured.' };
  }

  if (!ticketId || !actor?.userId) {
    return { success: false, message: 'Missing required parameters.' };
  }

  try {
    // 1. Verify that the actor is an Administrator
    const userDoc = await db.collection('users').doc(actor.userId).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'Admin') {
      return { success: false, message: 'Unauthorized: Only system administrators can delete tickets.' };
    }

    // 2. Fetch the ticket to capture snapshot data for logging
    const ticketRef = db.collection('tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) {
      return { success: false, message: 'Ticket not found.' };
    }

    const ticketData = ticketDoc.data()!;
    const ticketNumberDisplay = ticketData.ticketNumber ? `T-${ticketData.ticketNumber}` : `T-${ticketId.substring(0, 4)}`;

    // 3. Delete the ticket document
    await ticketRef.delete();

    // 4. Clean up any related notifications / events for this ticket
    try {
      const eventsSnap = await db.collection('ticket-events').where('ticketId', '==', ticketId).get();
      if (!eventsSnap.empty) {
        const batch = db.batch();
        eventsSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (eventErr) {
      console.warn('Could not cleanup ticket events:', eventErr);
    }

    // 5. Log the deletion to system audit logs
    await logSystemEvent({
      eventType: 'TICKET_DELETED',
      actor: {
        userId: actor.userId,
        name: actor.name || 'Admin',
      },
      message: `${actor.name || 'Admin'} deleted ticket #${ticketNumberDisplay} ("${ticketData.title || ticketData.subject || 'No Subject'}").`,
      details: {
        ticketId,
        ticketNumber: ticketData.ticketNumber || null,
        subject: ticketData.title || ticketData.subject || null,
        departmentName: ticketData.departmentName || null,
        divisionName: ticketData.divisionName || null,
        campusName: ticketData.campusName || null,
        parentName: ticketData.parentName || null,
        parentEmail: ticketData.parentEmail || null,
        messagesCount: Array.isArray(ticketData.messages) ? ticketData.messages.length : 0,
      },
    });

    // 6. Revalidate cache
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    revalidatePath('/tasks');
    revalidatePath('/analytics');

    return { 
      success: true, 
      message: `Ticket #${ticketNumberDisplay} was deleted successfully.` 
    };
  } catch (error: any) {
    console.error('Error deleting ticket:', error);
    return { success: false, message: error.message || 'An unexpected error occurred while deleting the ticket.' };
  }
}

export async function bulkDeleteTicketsAction(
  ticketIds: string[],
  actor: { userId: string; name: string }
) {
  const db = adminDb;
  if (!db) {
    return { success: false, message: 'Database error: Firebase Admin is not configured.' };
  }

  if (!ticketIds || ticketIds.length === 0 || !actor?.userId) {
    return { success: false, message: 'Missing required parameters or no tickets selected.' };
  }

  try {
    // 1. Verify that the actor is an Administrator
    const userDoc = await db.collection('users').doc(actor.userId).get();
    if (!userDoc.exists || userDoc.data()?.role !== 'Admin') {
      return { success: false, message: 'Unauthorized: Only system administrators can delete tickets.' };
    }

    // 2. Fetch all tickets using db.getAll (no limit constraints)
    const ticketRefs = ticketIds.map(id => db.collection('tickets').doc(id));
    const ticketSnapshots = await db.getAll(...ticketRefs);

    const deletedSummaries: Array<{ ticketId: string; ticketNumber?: string | number; title?: string }> = [];
    
    // Batch delete tickets in chunks of 400
    const BATCH_SIZE = 400;
    for (let i = 0; i < ticketSnapshots.length; i += BATCH_SIZE) {
      const chunk = ticketSnapshots.slice(i, i + BATCH_SIZE);
      const batch = db.batch();

      chunk.forEach((doc) => {
        if (doc.exists) {
          const data = doc.data() || {};
          deletedSummaries.push({
            ticketId: doc.id,
            ticketNumber: data.ticketNumber || null,
            title: data.title || data.subject || 'No Subject',
          });
          batch.delete(doc.ref);
        }
      });

      await batch.commit();
    }

    // 3. Clean up related ticket-events in safe chunks of 30 for Firestore 'in' query
    const EVENT_QUERY_CHUNK_SIZE = 30;
    for (let i = 0; i < ticketIds.length; i += EVENT_QUERY_CHUNK_SIZE) {
      const chunk = ticketIds.slice(i, i + EVENT_QUERY_CHUNK_SIZE);
      try {
        const eventsSnap = await db.collection('ticket-events').where('ticketId', 'in', chunk).get();
        if (!eventsSnap.empty) {
          const eventBatch = db.batch();
          eventsSnap.docs.forEach((d) => eventBatch.delete(d.ref));
          await eventBatch.commit();
        }
      } catch (eventErr) {
        console.warn('Could not cleanup ticket events for chunk:', eventErr);
      }
    }

    // 4. Log bulk deletion to system audit logs
    await logSystemEvent({
      eventType: 'TICKETS_BULK_DELETED',
      actor: {
        userId: actor.userId,
        name: actor.name || 'Admin',
      },
      message: `${actor.name || 'Admin'} bulk deleted ${deletedSummaries.length} ticket(s).`,
      details: {
        ticketIds,
        deletedCount: deletedSummaries.length,
        ticketsSummary: deletedSummaries.slice(0, 50),
      },
    });

    // 5. Revalidate cache
    revalidatePath('/tickets');
    revalidatePath('/dashboard');
    revalidatePath('/tasks');
    revalidatePath('/analytics');

    return {
      success: true,
      deletedCount: deletedSummaries.length,
      message: `Successfully deleted ${deletedSummaries.length} ticket(s).`,
    };
  } catch (error: any) {
    console.error('Error bulk deleting tickets:', error);
    return { success: false, message: error.message || 'An unexpected error occurred while deleting tickets.' };
  }
}
