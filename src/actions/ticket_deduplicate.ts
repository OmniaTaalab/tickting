'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { generateUniqueTicketNumber } from '@/lib/ticket-number';

type DeduplicateResult = { success: boolean; fixedCount: number };

/**
 * Per server instance. Every open tickets page that notices a duplicate number calls this
 * action at the same moment, and each run reads every ticket in the collection. Callers
 * that arrive while a run is in progress share it, and a run that just finished
 * successfully is not repeated for a minute (the repair it would do has just been done).
 */
const DEDUPLICATE_COOLDOWN_MS = 60_000;
let deduplicateInFlight: Promise<DeduplicateResult> | null = null;
let lastDeduplicateSuccessAt = 0;

export async function fixDuplicateTicketNumbersAction(): Promise<DeduplicateResult> {
  if (deduplicateInFlight) return deduplicateInFlight;
  if (Date.now() - lastDeduplicateSuccessAt < DEDUPLICATE_COOLDOWN_MS) {
    return { success: true, fixedCount: 0 };
  }
  const run = runFixDuplicateTicketNumbers()
    .then(result => {
      if (result.success) lastDeduplicateSuccessAt = Date.now();
      return result;
    })
    .finally(() => {
      if (deduplicateInFlight === run) deduplicateInFlight = null;
    });
  deduplicateInFlight = run;
  return run;
}

async function runFixDuplicateTicketNumbers(): Promise<DeduplicateResult> {
  const db = adminDb;
  if (!db) return { success: false, fixedCount: 0 };

  try {
    // PERF: only ticketNumber and createdAt are used below; don't download every ticket's
    // full messages/attachments. A projection returns the same documents in the same order.
    const ticketsSnapshot = await db.collection('tickets').select('ticketNumber', 'createdAt').get();
    if (ticketsSnapshot.empty) {
      return { success: true, fixedCount: 0 };
    }

    // Map tickets with createdAt to preserve the oldest ticket's ID
    const docs = ticketsSnapshot.docs.map(doc => {
      const data = doc.data();
      const createdTime = data.createdAt?.toDate ? data.createdAt.toDate().getTime() : 
        (data.createdAt ? new Date(data.createdAt).getTime() : 0);
      const rawNum = data.ticketNumber;
      const num = typeof rawNum === 'number' ? rawNum : parseInt(rawNum, 10);
      return {
        docId: doc.id,
        ticketNumber: isNaN(num) ? 0 : num,
        createdAt: createdTime,
      };
    });

    // Sort by createdAt ascending: older tickets keep their number!
    docs.sort((a, b) => a.createdAt - b.createdAt);

    const registeredNumbers = new Set<number>();
    const duplicatesToFix: Array<{ docId: string; oldNumber: number }> = [];

    for (const item of docs) {
      if (!item.ticketNumber || registeredNumbers.has(item.ticketNumber)) {
        duplicatesToFix.push({ docId: item.docId, oldNumber: item.ticketNumber });
      } else {
        registeredNumbers.add(item.ticketNumber);
      }
    }

    if (duplicatesToFix.length === 0) {
      return { success: true, fixedCount: 0 };
    }

    console.log(`[Deduplicate] Found ${duplicatesToFix.length} duplicate tickets to fix.`);

    const batch = db.batch();
    for (const dup of duplicatesToFix) {
      const newUniqueNumber = await generateUniqueTicketNumber(db);
      registeredNumbers.add(newUniqueNumber);

      const docRef = db.collection('tickets').doc(dup.docId);
      batch.update(docRef, { 
        ticketNumber: newUniqueNumber,
        originalDuplicatedNumber: dup.oldNumber || null 
      });
      console.log(`[Deduplicate] Reassigned ticket ${dup.docId} from #${dup.oldNumber} to #${newUniqueNumber}`);
    }

    await batch.commit();

    revalidatePath('/tickets');
    revalidatePath('/tasks');
    revalidatePath('/dashboard');
    revalidatePath('/track-history');

    return { success: true, fixedCount: duplicatesToFix.length };
  } catch (error) {
    console.error('[Deduplicate] Failed to fix duplicate ticket numbers:', error);
    return { success: false, fixedCount: 0 };
  }
}
