#!/usr/bin/env node
/**
 * Backfill / repair ticket_summaries from tickets.
 *
 * Uses EXACTLY the same mirror function as the mirrorTicketSummary Cloud Function
 * (functions/lib/ticket-summary.js — run `npm run build` in functions/ first), one
 * transaction per ticket, so it is safe to run while the app and the trigger are live
 * and safe to re-run at any time (idempotent; only writes summaries that differ).
 *
 * It NEVER writes to `tickets`.
 *
 * Usage (from functions/):
 *   node scripts/backfill-ticket-summaries.cjs                 # DRY RUN (default): no writes
 *   node scripts/backfill-ticket-summaries.cjs --apply         # write summaries + remove orphans
 *   node scripts/backfill-ticket-summaries.cjs --verify        # verify only (no writes)
 *   node scripts/backfill-ticket-summaries.cjs --enable        # verify, then settings/ticketSummaries.enabled = true
 *   node scripts/backfill-ticket-summaries.cjs --disable       # kill switch: enabled = false (back to full tickets)
 *   node scripts/backfill-ticket-summaries.cjs --fast-load-uids uid1,uid2   # fast load for these users only (staged rollout)
 *   node scripts/backfill-ticket-summaries.cjs --fast-load on   # fast load for everyone
 *   node scripts/backfill-ticket-summaries.cjs --fast-load off  # fast load kill switch (keeps summaries on)
 *
 * Credentials: Application Default Credentials (gcloud auth application-default login).
 */
const admin = require("firebase-admin");
const {
    mirrorTicketSummary,
    buildTicketSummary,
    firestoreValuesEqual,
    summaryContent,
    TICKETS_COLLECTION,
    SUMMARIES_COLLECTION,
} = require("../lib/ticket-summary.js");

const PROJECT_ID = "studio-7708718228-149dc";
const CONCURRENCY = 20;
const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const VERIFY_ONLY = args.has("--verify");
const ENABLE = args.has("--enable");
const DISABLE = args.has("--disable");

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

async function listIds(collectionName) {
    const ids = [];
    let last = null;
    for (;;) {
        let q = db.collection(collectionName).orderBy(admin.firestore.FieldPath.documentId()).select().limit(1000);
        if (last) q = q.startAfter(last);
        const snap = await q.get();
        if (snap.empty) break;
        for (const d of snap.docs) ids.push(d.id);
        last = snap.docs[snap.docs.length - 1].id;
    }
    return ids;
}

async function pool(items, worker) {
    let i = 0;
    const runners = Array.from({ length: CONCURRENCY }, async () => {
        while (i < items.length) {
            const idx = i++;
            await worker(items[idx], idx);
        }
    });
    await Promise.all(runners);
}

async function mirrorAll(dryRun) {
    const ticketIds = await listIds(TICKETS_COLLECTION);
    const summaryIds = await listIds(SUMMARIES_COLLECTION);
    const ticketSet = new Set(ticketIds);
    const orphans = summaryIds.filter(id => !ticketSet.has(id));
    const work = [...ticketIds, ...orphans];
    const counts = { written: 0, deleted: 0, unchanged: 0, absent: 0, errors: 0 };
    console.log(`${dryRun ? "[DRY RUN] " : ""}tickets=${ticketIds.length} summaries=${summaryIds.length} orphans=${orphans.length}`);
    await pool(work, async (id, idx) => {
        try {
            const r = await mirrorTicketSummary(db, id, { dryRun });
            counts[r]++;
        } catch (e) {
            counts.errors++;
            console.error(`  error on ${id}:`, e.message);
        }
        if ((idx + 1) % 1000 === 0) console.log(`  ${idx + 1}/${work.length}`, JSON.stringify(counts));
    });
    console.log(`${dryRun ? "[DRY RUN] would have " : ""}result:`, JSON.stringify(counts));
    return counts;
}

/** Full verification: every ticket has a summary equal to buildTicketSummary(ticket); no orphans. */
async function verify() {
    const ticketIds = await listIds(TICKETS_COLLECTION);
    const summaryIds = await listIds(SUMMARIES_COLLECTION);
    const summarySet = new Set(summaryIds);
    const ticketSet = new Set(ticketIds);
    const missing = ticketIds.filter(id => !summarySet.has(id));
    const orphans = summaryIds.filter(id => !ticketSet.has(id));
    let mismatched = 0;
    const mismatchedIds = [];
    for (let i = 0; i < ticketIds.length; i += 100) {
        const chunk = ticketIds.slice(i, i + 100).filter(id => summarySet.has(id));
        if (!chunk.length) continue;
        const tSnaps = await db.getAll(...chunk.map(id => db.collection(TICKETS_COLLECTION).doc(id)));
        const sSnaps = await db.getAll(...chunk.map(id => db.collection(SUMMARIES_COLLECTION).doc(id)));
        for (let k = 0; k < chunk.length; k++) {
            if (!tSnaps[k].exists || !sSnaps[k].exists) continue; // changed concurrently
            if (!firestoreValuesEqual(summaryContent(sSnaps[k].data()), buildTicketSummary(tSnaps[k].data()))) {
                mismatched++;
                if (mismatchedIds.length < 20) mismatchedIds.push(chunk[k]);
            }
        }
    }
    const ok = missing.length === 0 && orphans.length === 0 && mismatched === 0;
    console.log(`VERIFY tickets=${ticketIds.length} summaries=${summaryIds.length} missing=${missing.length} orphans=${orphans.length} mismatched=${mismatched} => ${ok ? "OK" : "FAILED"}`);
    if (!ok) {
        if (missing.length) console.log("  missing (first 20):", missing.slice(0, 20).join(", "));
        if (orphans.length) console.log("  orphans (first 20):", orphans.slice(0, 20).join(", "));
        if (mismatchedIds.length) console.log("  mismatched (first 20):", mismatchedIds.join(", "));
        console.log("  (a few mismatches can be tickets edited during the check — rerun --verify)");
    }
    return ok;
}

/** Pre-flight for --enable: the mirror trigger is deployed and clients can read summaries. */
async function preflight() {
    const { execSync } = require("child_process");
    let ok = true;
    try {
        const state = execSync(
            `gcloud functions describe mirrorTicketSummary --region us-central1 --project ${PROJECT_ID} --format="value(state)"`,
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim();
        console.log(`PREFLIGHT mirrorTicketSummary state: ${state || "(not found)"}`);
        if (state !== "ACTIVE") ok = false;
    } catch {
        console.log("PREFLIGHT mirrorTicketSummary: NOT DEPLOYED");
        ok = false;
    }
    try {
        // Unauthenticated read, like a browser: must be allowed by the live rules.
        const fs = require("fs");
        const path = require("path");
        const cfg = fs.readFileSync(path.join(__dirname, "..", "..", "src", "firebase", "config.ts"), "utf8");
        const key = (cfg.match(/apiKey:\s*"([^"]+)"/) || [])[1] || "";
        const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ticket_summaries?pageSize=1${key ? `&key=${key}` : ""}`;
        const res = await fetch(url);
        console.log(`PREFLIGHT unauthenticated read of ticket_summaries: HTTP ${res.status}`);
        if (res.status !== 200) ok = false;
    } catch (e) {
        console.log("PREFLIGHT rules check failed:", e.message);
        ok = false;
    }
    return ok;
}

/**
 * Fast-load preflight: PROVE the deployed mirror stamps _summarySyncedAt, otherwise fast-load
 * clients would miss changes. Requires: mirrorTicketSummary ACTIVE and deployed >= 10 minutes
 * ago (old revisions drained), and at least one summary stamped AFTER that deploy time.
 */
async function fastLoadPreflight() {
    const { execSync } = require("child_process");
    let updated;
    try {
        updated = execSync(
            `gcloud functions describe mirrorTicketSummary --region us-central1 --project ${PROJECT_ID} --format="value(state,updateTime)"`,
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
        ).trim().split(/\s+/);
    } catch {
        console.log("FAST PREFLIGHT: mirrorTicketSummary not deployed");
        return false;
    }
    const [state, updateTime] = updated;
    const deployedAt = Date.parse(updateTime);
    const ageMin = (Date.now() - deployedAt) / 60000;
    console.log(`FAST PREFLIGHT mirror state=${state} deployed ${ageMin.toFixed(1)} min ago (${updateTime})`);
    if (state !== "ACTIVE" || !(ageMin >= 10)) {
        console.log("FAST PREFLIGHT: mirror must be ACTIVE and deployed at least 10 minutes ago");
        return false;
    }
    const stamped = await db.collection(SUMMARIES_COLLECTION).where("_summarySyncedAt", ">", admin.firestore.Timestamp.fromMillis(deployedAt)).limit(1).get();
    if (stamped.empty) {
        console.log("FAST PREFLIGHT: no summary stamped after the mirror deploy yet (no ticket changed since, or old mirror still live) - refusing");
        return false;
    }
    console.log(`FAST PREFLIGHT: OK (e.g. ${stamped.docs[0].id} stamped ${stamped.docs[0].get("_summarySyncedAt").toDate().toISOString()})`);
    try {
        const { fetch: f } = globalThis;
        const fs = require("fs");
        const path = require("path");
        const cfg = fs.readFileSync(path.join(__dirname, "..", "..", "src", "firebase", "config.ts"), "utf8");
        const key = (cfg.match(/apiKey:\s*"([^"]+)"/) || [])[1] || "";
        const res = await f(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/ticket_summaries_deleted?pageSize=1&key=${key}`);
        console.log(`FAST PREFLIGHT unauthenticated read of ticket_summaries_deleted: HTTP ${res.status}`);
        if (res.status !== 200) return false;
    } catch (e) {
        console.log("FAST PREFLIGHT rules check failed:", e.message);
        return false;
    }
    return true;
}

async function setFastLoad(fields) {
    await db.collection("settings").doc("ticketSummaries").set(
        { ...fields, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
    );
    console.log("settings/ticketSummaries updated:", JSON.stringify(fields));
}

async function setFlag(enabled) {
    await db.collection("settings").doc("ticketSummaries").set(
        { enabled, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
    );
    console.log(`settings/ticketSummaries.enabled = ${enabled}`);
}

const argv = process.argv.slice(2);
const argAfter = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

(async () => {
    const fastArg = argAfter("--fast-load");
    const uidsArg = argAfter("--fast-load-uids");
    if (fastArg === "off") {
        await setFastLoad({ fastLoad: false, fastLoadUids: [] });
        return;
    }
    if (fastArg === "on" || uidsArg !== undefined) {
        if (!(await fastLoadPreflight())) {
            console.error("NOT enabling fast load.");
            process.exitCode = 1;
            return;
        }
        if (fastArg === "on") await setFastLoad({ fastLoad: true });
        else await setFastLoad({ fastLoadUids: uidsArg.split(",").map(s => s.trim()).filter(Boolean) });
        return;
    }
    if (DISABLE) {
        await setFlag(false);
        return;
    }
    if (VERIFY_ONLY) {
        process.exitCode = (await verify()) ? 0 : 1;
        return;
    }
    if (ENABLE) {
        if (!(await preflight())) {
            console.error("NOT enabling: deploy mirrorTicketSummary and publish the ticket_summaries rules first.");
            process.exitCode = 1;
            return;
        }
        if (!(await verify())) {
            console.error("NOT enabling: verification failed. Run --apply, then --enable again.");
            process.exitCode = 1;
            return;
        }
        await setFlag(true);
        return;
    }
    const counts = await mirrorAll(!APPLY);
    if (APPLY) {
        process.exitCode = counts.errors ? 1 : 0;
        await verify();
    } else {
        console.log("Dry run only. Re-run with --apply to write.");
    }
})().catch(e => {
    console.error(e);
    process.exitCode = 1;
});
