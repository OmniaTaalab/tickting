#!/usr/bin/env node
/**
 * One-time cleanup: release the "waiting for manager approval to transfer" hold on tickets
 * whose transfer request was ALREADY decided.
 *
 * Before the fix in src/actions/request_actions.ts, approving or rejecting a category
 * transfer left pendingTransferRequestId / pendingTransferCategoryId /
 * pendingTransferCategoryName on the ticket. Such a ticket can no longer be transferred,
 * locally transferred or auto-assigned from the Queue.
 *
 *   node functions/scripts/clear-stale-transfer-holds.cjs --database staging            # dry run, TEST database
 *   node functions/scripts/clear-stale-transfer-holds.cjs --database staging --apply    # write, TEST database
 *   node functions/scripts/clear-stale-transfer-holds.cjs --production                  # dry run, PRODUCTION
 *   node functions/scripts/clear-stale-transfer-holds.cjs --production --apply          # write, PRODUCTION
 *
 * Guarantees
 *   - Only the three hold fields are removed. Status, assignee, category, messages and
 *     updatedAt are not touched; nothing is deleted.
 *   - A ticket whose request is still pending (a manager has not decided) is left alone.
 *   - Each ticket is re-read inside a transaction and skipped if its hold changed meanwhile.
 */
const path = require("path");
const admin = require(path.join(__dirname, "..", "node_modules", "firebase-admin"));

const APPLY = process.argv.includes("--apply");
const PRODUCTION = process.argv.includes("--production");
const dbArgIndex = process.argv.indexOf("--database");
const DATABASE_ID = PRODUCTION ? "(default)" : dbArgIndex !== -1 ? process.argv[dbArgIndex + 1] : "staging";
if (!DATABASE_ID || DATABASE_ID.startsWith("--")) {
    console.error("Usage: --database <id> | --production  [--apply]");
    process.exit(1);
}
if (DATABASE_ID === "(default)" && !PRODUCTION) {
    console.error('Refusing to target the "(default)" (production) database without --production.');
    process.exit(1);
}
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "studio-7708718228-149dc";

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
const { getFirestore, FieldValue } = require(path.join(__dirname, "..", "node_modules", "firebase-admin", "lib", "firestore"));
const db = getFirestore(admin.app(), DATABASE_ID);
console.log(`Target: project ${PROJECT_ID}, Firestore database "${DATABASE_ID}"${PRODUCTION ? "  *** PRODUCTION ***" : ""}${APPLY ? "  (APPLY)" : "  (dry run)"}\n`);

(async () => {
    const snap = await db.collection("tickets").where("pendingTransferRequestId", ">", "").get();
    console.log(`Tickets carrying a transfer hold: ${snap.size}\n`);
    let cleared = 0, kept = 0, skipped = 0;

    for (const doc of snap.docs) {
        const t = doc.data();
        const requestId = t.pendingTransferRequestId;
        const label = `#${t.ticketNumber || doc.id.slice(0, 6)} [${t.status}] ${t.departmentName || "-"}`;

        const events = await db.collection("ticket-events").where("requestId", "==", requestId).get();
        const statuses = events.docs.map((e) => e.data().status || "pending");
        const stillPending = statuses.includes("pending");
        const alreadyMoved = Boolean(t.pendingTransferCategoryId) && t.departmentId === t.pendingTransferCategoryId;
        const decision = statuses.includes("approved") || alreadyMoved ? "approved" : statuses.includes("rejected") ? "rejected" : null;

        // Undecided request (or a request with no notification events at all): leave it for the manager.
        if (!alreadyMoved && (stillPending || !decision)) {
            kept++;
            console.log(`  KEEP   ${label} -> waiting for a decision on transfer to "${t.pendingTransferCategoryName || t.pendingTransferCategoryId}"`);
            continue;
        }

        console.log(`  CLEAR  ${label} -> request ${decision} (assigned to ${t.assignedTo?.name || "nobody"})`);
        if (!APPLY) { cleared++; continue; }

        const done = await db.runTransaction(async (tx) => {
            const latest = await tx.get(doc.ref);
            if (!latest.exists || latest.data().pendingTransferRequestId !== requestId) return false;
            tx.update(doc.ref, {
                pendingTransferRequestId: FieldValue.delete(),
                pendingTransferCategoryId: FieldValue.delete(),
                pendingTransferCategoryName: FieldValue.delete(),
            });
            return true;
        });
        if (!done) { skipped++; console.log(`         skipped: the ticket changed while cleaning`); continue; }
        cleared++;

        const requestRef = db.collection("ticket-transfer-requests").doc(requestId);
        const request = await requestRef.get();
        if (request.exists && request.data().status === "pending") {
            await requestRef.update({ status: decision, updatedAt: FieldValue.serverTimestamp(), closedBy: "clear-stale-transfer-holds" });
        }
    }

    console.log(`\n${APPLY ? "Cleared" : "Would clear"}: ${cleared}   left waiting for a manager: ${kept}${skipped ? `   skipped: ${skipped}` : ""}`);
    if (!APPLY) console.log("Dry run only. Re-run with --apply to write.");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
