#!/usr/bin/env node
/**
 * Show or change the live switches in settings/ticketSummaries.
 *
 *   pagedTickets        true: every user's tickets list comes from the server one page at a
 *                             time (/api/tickets/view), and Previous / Next on a ticket come
 *                             from /api/tickets/nav. Nobody downloads a list of tickets.
 *                             Admins' and managers' sidebar counters also come from the
 *                             server copy (refreshed once a minute) instead of a listener.
 *                       false/missing: only the users in pagedTicketsUids get that.
 *   queueFromSummaries  true: the Queue auto-assign pass takes the queued tickets from the
 *                             server's in-memory copy instead of re-reading every queued
 *                             ticket from Firestore on every pass.
 *
 * Both take effect within seconds in every open browser / within 30 s on every server, with
 * no deploy, and can be turned off the same way. Nothing else in the document is touched.
 *
 *   node functions/scripts/set-ticket-switches.cjs --production                              # show current values
 *   node functions/scripts/set-ticket-switches.cjs --production --paged on                   # dry run
 *   node functions/scripts/set-ticket-switches.cjs --production --paged on --apply           # write
 *   node functions/scripts/set-ticket-switches.cjs --production --queue on --apply
 *   node functions/scripts/set-ticket-switches.cjs --production --paged off --queue off --apply   # back to before
 *   node functions/scripts/set-ticket-switches.cjs --production --add-paged-uid <uid> --apply     # try it on one more user first
 *   (use --database staging instead of --production for the test database)
 */
const path = require("path");
const admin = require(path.join(__dirname, "..", "node_modules", "firebase-admin"));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PRODUCTION = args.includes("--production");
const valueOf = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
const DATABASE_ID = PRODUCTION ? "(default)" : valueOf("--database") || "staging";
if (!DATABASE_ID || DATABASE_ID.startsWith("--")) {
    console.error("Usage: --database <id> | --production  [--paged on|off] [--queue on|off] [--add-paged-uid <uid>] [--remove-paged-uid <uid>] [--apply]");
    process.exit(1);
}
if (DATABASE_ID === "(default)" && !PRODUCTION) {
    console.error('Refusing to target the "(default)" (production) database without --production.');
    process.exit(1);
}
const onOff = (name) => {
    const v = valueOf(name);
    if (v === undefined) return undefined;
    if (v === "on") return true;
    if (v === "off") return false;
    console.error(`${name} must be "on" or "off"`);
    process.exit(1);
};
const paged = onOff("--paged");
const queue = onOff("--queue");
const addUid = valueOf("--add-paged-uid");
const removeUid = valueOf("--remove-paged-uid");
for (const [name, v] of [["--add-paged-uid", addUid], ["--remove-paged-uid", removeUid]]) {
    if (args.includes(name) && (!v || v.startsWith("--"))) { console.error(`${name} needs a user id`); process.exit(1); }
}

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "studio-7708718228-149dc";
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
const { getFirestore, FieldValue } = require(path.join(__dirname, "..", "node_modules", "firebase-admin", "lib", "firestore"));
const db = getFirestore(admin.app(), DATABASE_ID);
console.log(`Target: project ${PROJECT_ID}, Firestore database "${DATABASE_ID}"${PRODUCTION ? "  *** PRODUCTION ***" : ""}${APPLY ? "  (APPLY)" : "  (dry run)"}\n`);

const show = (label, d) => {
    console.log(label);
    console.log(`  enabled             ${d ? d.enabled === true : "(document missing)"}`);
    if (!d) return;
    console.log(`  pagedTickets        ${d.pagedTickets === true}   (+ ${Array.isArray(d.pagedTicketsUids) ? d.pagedTicketsUids.length : 0} user id(s) in pagedTicketsUids)`);
    console.log(`  queueFromSummaries  ${d.queueFromSummaries === true}`);
    console.log(`  fastLoad            ${d.fastLoad === true}   (+ ${Array.isArray(d.fastLoadUids) ? d.fastLoadUids.length : 0} user id(s) in fastLoadUids)`);
};

(async () => {
    const ref = db.collection("settings").doc("ticketSummaries");
    const before = (await ref.get()).data();
    show("Current:", before);

    const update = {};
    if (paged !== undefined) update.pagedTickets = paged;
    if (queue !== undefined) update.queueFromSummaries = queue;
    if (addUid) update.pagedTicketsUids = FieldValue.arrayUnion(addUid);
    if (removeUid) update.pagedTicketsUids = FieldValue.arrayRemove(removeUid);
    if (addUid && removeUid) { console.error("\nUse --add-paged-uid and --remove-paged-uid in separate runs."); process.exit(1); }
    if (Object.keys(update).length === 0) {
        console.log("\nNothing to change (no --paged / --queue / --add-paged-uid / --remove-paged-uid given).");
        return;
    }
    if (!before) {
        console.error("\nsettings/ticketSummaries does not exist; refusing to create it from this script.");
        process.exit(1);
    }
    if (before.enabled !== true && (paged === true || queue === true)) {
        console.error('\n"enabled" is not true: the switches would have no effect. Turn the summaries on first.');
        process.exit(1);
    }

    console.log("\nChange:");
    if (paged !== undefined) console.log(`  pagedTickets        ${before.pagedTickets === true} -> ${paged}`);
    if (queue !== undefined) console.log(`  queueFromSummaries  ${before.queueFromSummaries === true} -> ${queue}`);
    if (addUid) console.log(`  pagedTicketsUids    + ${addUid}`);
    if (removeUid) console.log(`  pagedTicketsUids    - ${removeUid}`);

    if (!APPLY) {
        console.log("\nDry run: nothing written. Add --apply to write.");
        return;
    }
    await ref.update({ ...update, updatedAt: FieldValue.serverTimestamp() });
    console.log("\nWritten.\n");
    show("Now:", (await ref.get()).data());
})().catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
});
