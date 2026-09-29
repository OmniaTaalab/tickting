'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { generateUniqueTicketNumber } from '@/lib/ticket-number';

export async function fixDuplicateTicketNumbersAction(): Promise<{ success: boolean; fixedCount: number }> {
  const db = adminDb;
  if (!db) return { success: false, fixedCount: 0 };

  try {
    const ticketsSnapshot = await db.collection('tickets').get();
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
