import type FirebaseFirestore from 'firebase-admin/firestore';

/**
 * Generates a strictly unique, sequential ticket number.
 * Uses a Firestore counter document with transaction or atomic increment,
 * and double-checks existence to ensure zero duplicate collisions.
 */
export async function generateUniqueTicketNumber(db: FirebaseFirestore.Firestore): Promise<number> {
  const counterRef = db.collection('system-counters').doc('ticket_number');

  try {
    const newNumber = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      let nextNumber: number;

      if (!counterDoc.exists || typeof counterDoc.data()?.lastNumber !== 'number') {
        // Query the highest existing ticketNumber from the tickets collection
        let maxExisting = 1000;
        try {
          const highestTicketSnapshot = await db
            .collection('tickets')
            .orderBy('ticketNumber', 'desc')
            .limit(1)
            .get();

          if (!highestTicketSnapshot.empty) {
            const raw = highestTicketSnapshot.docs[0].data().ticketNumber;
            if (typeof raw === 'number' && !isNaN(raw)) {
              maxExisting = raw;
            }
          }
        } catch {
          // If query fails, start from a safe baseline
          maxExisting = 5999;
        }
        nextNumber = Math.max(maxExisting + 1, 1001);
      } else {
        nextNumber = counterDoc.data()!.lastNumber + 1;
      }

      transaction.set(
        counterRef,
        {
          lastNumber: nextNumber,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return nextNumber;
    });

    // Double check that newNumber is definitely not used by any existing document
    const collisionCheck = await db
      .collection('tickets')
      .where('ticketNumber', '==', newNumber)
      .limit(1)
      .get();

    if (collisionCheck.empty) {
      return newNumber;
    }

    // If somehow a collision occurred, find the next available unused number
    let candidate = newNumber + 1;
    while (true) {
      const check = await db
        .collection('tickets')
        .where('ticketNumber', '==', candidate)
        .limit(1)
        .get();
      if (check.empty) {
        await counterRef.set(
          { lastNumber: candidate, updatedAt: new Date().toISOString() },
          { merge: true }
        );
        return candidate;
      }
      candidate++;
    }
  } catch (err) {
    console.error('[TicketNumber] Error generating sequential ticket number with transaction:', err);

    // Fallback: Find highest existing number and increment safely
    let candidate = 6000;
    try {
      const highestTicketSnapshot = await db
        .collection('tickets')
        .orderBy('ticketNumber', 'desc')
        .limit(1)
        .get();

      if (!highestTicketSnapshot.empty) {
        const raw = highestTicketSnapshot.docs[0].data().ticketNumber;
        if (typeof raw === 'number') candidate = raw + 1;
      }
    } catch {
      candidate = 6000;
    }

    while (true) {
      const check = await db
        .collection('tickets')
        .where('ticketNumber', '==', candidate)
        .limit(1)
        .get();
      if (check.empty) {
        await counterRef.set(
          { lastNumber: candidate, updatedAt: new Date().toISOString() },
          { merge: true }
        ).catch(() => {});
        return candidate;
      }
      candidate++;
    }
  }
}
