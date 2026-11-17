/**
 * Sequential ticket numbers for tickets created by the email sync.
 *
 * Same counter document and same algorithm as the web app
 * (src/lib/ticket-number.ts -> system-counters/ticket_number), so tickets created from
 * email and tickets created in the app share one sequence and never collide.
 *
 * Before this, email tickets were given a random 4-digit number. With tens of thousands
 * of tickets every such number is already taken, so the app had to renumber each new
 * email ticket a few minutes later (a scan of the whole tickets collection every time),
 * after notifications had already quoted the old number.
 */
import type * as FirebaseFirestore from "firebase-admin/firestore";

const COUNTER_COLLECTION = "system-counters";
const COUNTER_DOC = "ticket_number";

async function highestExistingTicketNumber(db: FirebaseFirestore.Firestore): Promise<number | null> {
    const snap = await db.collection("tickets").orderBy("ticketNumber", "desc").limit(1).get();
    if (snap.empty) return null;
    const raw = snap.docs[0].data().ticketNumber;
    return typeof raw === "number" && !isNaN(raw) ? raw : null;
}

async function isTicketNumberFree(db: FirebaseFirestore.Firestore, candidate: number): Promise<boolean> {
    const check = await db.collection("tickets").where("ticketNumber", "==", candidate).limit(1).get();
    return check.empty;
}

/**
 * Next unused sequential ticket number. Throws only if Firestore itself is unavailable;
 * the caller falls back to its previous behaviour in that case.
 */
export async function generateUniqueTicketNumber(db: FirebaseFirestore.Firestore): Promise<number> {
    const counterRef = db.collection(COUNTER_COLLECTION).doc(COUNTER_DOC);

    const newNumber = await db.runTransaction(async (transaction) => {
        const counterDoc = await transaction.get(counterRef);
        let nextNumber: number;

        if (!counterDoc.exists || typeof counterDoc.data()?.lastNumber !== "number") {
            // No counter yet: continue after the highest existing ticket number.
            let maxExisting = 1000;
            try {
                maxExisting = (await highestExistingTicketNumber(db)) ?? 1000;
            } catch {
                maxExisting = 5999;
            }
            nextNumber = Math.max(maxExisting + 1, 1001);
        } else {
            nextNumber = (counterDoc.data()!.lastNumber as number) + 1;
        }

        transaction.set(
            counterRef,
            { lastNumber: nextNumber, updatedAt: new Date().toISOString() },
            { merge: true }
        );
        return nextNumber;
    });

    // Double check the number is not used by an existing ticket.
    if (await isTicketNumberFree(db, newNumber)) return newNumber;

    // Collision (e.g. an old ticket above the counter): move to the next free number.
    let candidate = newNumber + 1;
    for (;;) {
        if (await isTicketNumberFree(db, candidate)) {
            await counterRef.set(
                { lastNumber: candidate, updatedAt: new Date().toISOString() },
                { merge: true }
            );
            return candidate;
        }
        candidate++;
    }
}
