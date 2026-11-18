#!/usr/bin/env node
/**
 * Merge two grades that are the same grade entered twice (same name, two documents in `grades`).
 *
 * Everything that points at the grade to remove is pointed at the grade to keep, then the
 * removed grade's document is deleted — in ONE Firestore transaction, so either all of it
 * happens or none of it.
 *
 *   node functions/scripts/merge-duplicate-grade.cjs --production --keep <gradeId> --remove <gradeId>            # dry run
 *   node functions/scripts/merge-duplicate-grade.cjs --production --keep <gradeId> --remove <gradeId> --apply    # write
 *   node functions/scripts/merge-duplicate-grade.cjs --production --restore <backup file> [--apply]              # undo
 *   (use --database staging instead of --production for the test database)
 *
 * What is changed
 *   - campuses/{id}.schoolConfigs: in each school's grade list and each division's grade list,
 *     the removed id is replaced by the kept id (dropped where the kept id is already there).
 *     Order and every other field are left as they are.
 *   - users/{id}.gradeIds: same replacement.
 *   - grades/{removed}: deleted.
 *   - one system-logs entry, so the change shows up in the action log.
 *
 * What it refuses to do
 *   - Run if the two grades do not have the same name (pass --allow-different-names to override).
 *   - Run if a ticket, a transfer record or a pending request still refers to the grade being
 *     removed: those keep history, so keep THAT grade and remove the other one instead.
 *
 * Before writing, the previous values of every document it touches are saved to a backup file
 * next to this script (*.local, ignored by git). --restore puts them back, document by
 * document, and only where the document still has exactly the value this script wrote.
 */
const path = require("path");
const fs = require("fs");
const admin = require(path.join(__dirname, "..", "node_modules", "firebase-admin"));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PRODUCTION = args.includes("--production");
const valueOf = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
const DATABASE_ID = PRODUCTION ? "(default)" : valueOf("--database") || "staging";
const KEEP = valueOf("--keep");
const REMOVE = valueOf("--remove");
const RESTORE = valueOf("--restore");
const usage = "Usage: --database <id> | --production   --keep <gradeId> --remove <gradeId> [--apply]   |   --restore <backup file> [--apply]";
if (!DATABASE_ID || DATABASE_ID.startsWith("--")) { console.error(usage); process.exit(1); }
if (DATABASE_ID === "(default)" && !PRODUCTION) { console.error('Refusing to target the "(default)" (production) database without --production.'); process.exit(1); }
if (!RESTORE && (!KEEP || !REMOVE || KEEP.startsWith("--") || REMOVE.startsWith("--") || KEEP === REMOVE)) { console.error(usage); process.exit(1); }

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "studio-7708718228-149dc";
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
const { getFirestore, FieldValue } = require(path.join(__dirname, "..", "node_modules", "firebase-admin", "lib", "firestore"));
const db = getFirestore(admin.app(), DATABASE_ID);
console.log(`Target: project ${PROJECT_ID}, Firestore database "${DATABASE_ID}"${PRODUCTION ? "  *** PRODUCTION ***" : ""}${APPLY ? "  (APPLY)" : "  (dry run)"}\n`);

const norm = (v) => String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const count = async (q) => (await q.count().get()).data().count;

/** The id list with `remove` turned into `keep`; null when the list does not contain `remove`. */
function mergedIds(ids, keep, remove) {
    if (!Array.isArray(ids) || !ids.includes(remove)) return null;
    let hasKeep = ids.includes(keep);
    const out = [];
    for (const id of ids) {
        if (id !== remove) { out.push(id); continue; }
        if (!hasKeep) { out.push(keep); hasKeep = true; } // takes the removed grade's place
    }
    return out;
}

/** schoolConfigs with the replacement applied; null when nothing in it changes. */
function mergedSchoolConfigs(configs, keep, remove) {
    if (!Array.isArray(configs)) return null;
    let changed = false;
    const next = configs.map((cfg) => {
        if (!cfg || typeof cfg !== "object") return cfg;
        const out = { ...cfg };
        const g = mergedIds(cfg.gradeIds, keep, remove);
        if (g) { out.gradeIds = g; changed = true; }
        if (Array.isArray(cfg.divisions)) {
            out.divisions = cfg.divisions.map((div) => {
                const dg = div && typeof div === "object" ? mergedIds(div.gradeIds, keep, remove) : null;
                if (!dg) return div;
                changed = true;
                return { ...div, gradeIds: dg };
            });
        }
        return out;
    });
    return changed ? next : null;
}

async function restore() {
    const file = path.resolve(RESTORE);
    const backup = JSON.parse(fs.readFileSync(file, "utf8"));
    if (backup.database !== DATABASE_ID) { console.error(`This backup is for database "${backup.database}", not "${DATABASE_ID}".`); process.exit(1); }
    console.log(`Restoring from ${file}\n  grade ${backup.remove} ("${backup.removedGrade.data.name}") merged into ${backup.keep} on ${backup.at}\n`);
    const result = await db.runTransaction(async (tx) => {
        const gradeRef = db.collection("grades").doc(backup.remove);
        const refs = [gradeRef, ...backup.campuses.map((c) => db.collection("campuses").doc(c.id)), ...backup.users.map((u) => db.collection("users").doc(u.id))];
        const snaps = await tx.getAll(...refs);
        const byPath = new Map(snaps.map((s) => [s.ref.path, s]));
        const out = { grade: "", campuses: 0, users: 0, skipped: [] };
        if (byPath.get(gradeRef.path).exists) out.grade = "already exists (left as it is)";
        else { out.grade = "recreated"; if (APPLY) tx.set(gradeRef, backup.removedGrade.data); }
        for (const c of backup.campuses) {
            const snap = byPath.get(`campuses/${c.id}`);
            if (!snap.exists || !same(snap.data().schoolConfigs, c.after)) { out.skipped.push(`campus ${c.name} (changed since the merge)`); continue; }
            out.campuses++; if (APPLY) tx.update(snap.ref, { schoolConfigs: c.before });
        }
        for (const u of backup.users) {
            const snap = byPath.get(`users/${u.id}`);
            if (!snap.exists || !same(snap.data().gradeIds, u.after)) { out.skipped.push(`user ${u.id} (changed since the merge)`); continue; }
            out.users++; if (APPLY) tx.update(snap.ref, { gradeIds: u.before });
        }
        return out;
    });
    console.log(`${APPLY ? "Restored" : "Would restore"}: grade ${result.grade}; ${result.campuses} campus(es); ${result.users} user(s).`);
    if (result.skipped.length) console.log("Left alone:\n  " + result.skipped.join("\n  "));
    if (!APPLY) console.log("\nDry run: nothing written. Add --apply to write.");
}

async function merge() {
    const gradesCol = db.collection("grades");
    const [keepSnap, removeSnap] = await Promise.all([gradesCol.doc(KEEP).get(), gradesCol.doc(REMOVE).get()]);
    if (!keepSnap.exists) { console.error(`grades/${KEEP} (the one to keep) does not exist.`); process.exit(1); }
    if (!removeSnap.exists) { console.error(`grades/${REMOVE} (the one to remove) does not exist — already merged?`); process.exit(1); }
    console.log(`Keep    grades/${KEEP}  name ${JSON.stringify(keepSnap.data().name)}`);
    console.log(`Remove  grades/${REMOVE}  name ${JSON.stringify(removeSnap.data().name)}\n`);
    if (norm(keepSnap.data().name) !== norm(removeSnap.data().name) && !args.includes("--allow-different-names")) {
        console.error("The two grades have different names. Refusing (pass --allow-different-names if this is really intended).");
        process.exit(1);
    }

    // Anything that keeps history must not be left pointing at a grade that no longer exists.
    const blockers = [];
    const tickets = await count(db.collection("tickets").where("gradeId", "==", REMOVE));
    if (tickets) blockers.push(`${tickets} ticket(s) have gradeId = the grade to remove`);
    const summaries = await count(db.collection("ticket_summaries").where("gradeId", "==", REMOVE));
    if (summaries) blockers.push(`${summaries} ticket summary document(s) have gradeId = the grade to remove`);
    for (const name of ["ticket-transfers", "ticket-transfer-requests", "ticket-local-transfer-requests", "ticket-events", "mailboxes", "divisions", "schools", "departments", "subjects"]) {
        const hits = (await db.collection(name).get()).docs.filter((d) => JSON.stringify(d.data()).includes(REMOVE)).length;
        if (hits) blockers.push(`${hits} document(s) in ${name} mention the grade to remove`);
    }
    if (blockers.length) {
        console.error("Refusing: the grade to remove is still referred to by records this script does not rewrite:\n  " + blockers.join("\n  ") + "\nKeep that grade and remove the other one instead.");
        process.exit(1);
    }
    console.log("No ticket, transfer, request, event or mailbox refers to the grade to remove.\n");

    const names = {};
    for (const c of ["schools", "divisions", "grades"]) names[c] = new Map((await db.collection(c).get()).docs.map((d) => [d.id, String(d.data().name).trim()]));
    const label = (ids) => (ids || []).map((g) => (g === KEEP ? "[KEEP]" : g === REMOVE ? "[REMOVE]" : names.grades.get(g) || g)).join(" ");

    const plan = await db.runTransaction(async (tx) => {
        const [k, r] = await tx.getAll(gradesCol.doc(KEEP), gradesCol.doc(REMOVE));
        if (!k.exists || !r.exists) throw new Error("one of the two grades disappeared while preparing");
        const campusSnaps = (await tx.get(db.collection("campuses"))).docs;
        const userSnaps = (await tx.get(db.collection("users").where("gradeIds", "array-contains", REMOVE))).docs;
        const out = { removedGrade: { id: r.id, data: r.data() }, campuses: [], users: [], lines: [] };

        for (const snap of campusSnaps) {
            const data = snap.data();
            const next = mergedSchoolConfigs(data.schoolConfigs, KEEP, REMOVE);
            const elsewhere = JSON.stringify({ ...data, schoolConfigs: undefined }).includes(REMOVE);
            if (elsewhere) throw new Error(`campus ${snap.id} mentions the grade to remove outside schoolConfigs; not handled`);
            if (!next) continue;
            out.campuses.push({ id: snap.id, name: String(data.name).trim(), before: data.schoolConfigs, after: next });
            data.schoolConfigs.forEach((cfg, i) => {
                const school = names.schools.get(cfg.schoolId) || cfg.schoolId;
                if (!same(cfg.gradeIds, next[i].gradeIds)) out.lines.push(`  ${String(data.name).trim()} / ${school} / school list:\n      before: ${label(cfg.gradeIds)}\n      after : ${label(next[i].gradeIds)}`);
                (cfg.divisions || []).forEach((div, j) => {
                    if (!same(div.gradeIds, next[i].divisions[j].gradeIds)) out.lines.push(`  ${String(data.name).trim()} / ${school} / ${names.divisions.get(div.divisionId) || div.divisionId}:\n      before: ${label(div.gradeIds)}\n      after : ${label(next[i].divisions[j].gradeIds)}`);
                });
            });
            if (APPLY) tx.update(snap.ref, { schoolConfigs: next });
        }
        for (const snap of userSnaps) {
            const before = snap.data().gradeIds;
            const after = mergedIds(before, KEEP, REMOVE);
            if (!after) continue;
            out.users.push({ id: snap.id, before, after, hadKeep: before.includes(KEEP) });
            if (APPLY) tx.update(snap.ref, { gradeIds: after });
        }
        if (APPLY) {
            tx.delete(gradesCol.doc(REMOVE));
            tx.set(db.collection("system-logs").doc(), {
                eventType: "GRADE_MERGED",
                actor: { userId: "maintenance-script", name: "Maintenance script" },
                message: `Duplicate grade "${r.data().name}" (${REMOVE}) merged into ${KEEP} and deleted.`,
                details: { keptGradeId: KEEP, removedGradeId: REMOVE, gradeName: r.data().name, campuses: out.campuses.map((c) => c.name), users: out.users.length },
                timestamp: FieldValue.serverTimestamp(),
            });
            // Written inside the transaction callback so the file always matches what is committed;
            // if the commit fails the file is simply a record of an attempt that changed nothing.
            const file = path.join(__dirname, `merge-grade-${REMOVE}-into-${KEEP}-${DATABASE_ID.replace(/[^a-z0-9]/gi, "")}-${Date.now()}.json.local`);
            fs.writeFileSync(file, JSON.stringify({ database: DATABASE_ID, at: new Date().toISOString(), keep: KEEP, remove: REMOVE, removedGrade: out.removedGrade, campuses: out.campuses, users: out.users.map(({ id, before, after }) => ({ id, before, after })) }, null, 1));
            out.backupFile = file;
        }
        return out;
    });

    console.log(`Campus grade lists that change (${plan.campuses.length} campus document(s)):`);
    console.log(plan.lines.join("\n") || "  none");
    console.log(`\nUsers whose gradeIds change: ${plan.users.length}` + (plan.users.length ? `  (${plan.users.filter((u) => u.hadKeep).length} already have the kept grade: the removed one is dropped; ${plan.users.filter((u) => !u.hadKeep).length} get it in place of the removed one)` : ""));
    console.log(`Grade document deleted: grades/${REMOVE}`);

    if (!APPLY) { console.log("\nDry run: nothing written. Add --apply to write."); return; }

    console.log(`\nWritten. Backup of the previous values: ${plan.backupFile}`);
    // Verify from fresh reads.
    const left = [];
    if ((await gradesCol.doc(REMOVE).get()).exists) left.push("the removed grade document still exists");
    if (!(await gradesCol.doc(KEEP).get()).exists) left.push("the kept grade document is missing");
    for (const d of (await db.collection("campuses").get()).docs) if (JSON.stringify(d.data()).includes(REMOVE)) left.push(`campus ${d.id} still mentions it`);
    const usersLeft = await count(db.collection("users").where("gradeIds", "array-contains", REMOVE));
    if (usersLeft) left.push(`${usersLeft} user(s) still have it`);
    const sameName = (await gradesCol.get()).docs.filter((d) => norm(d.data().name) === norm(plan.removedGrade.data.name)).length;
    console.log(left.length ? "VERIFY FAILED:\n  " + left.join("\n  ") : `Verified: no campus or user refers to ${REMOVE}; it is deleted; grades named "${plan.removedGrade.data.name}" now: ${sameName}.`);
    if (left.length) process.exit(1);
}

(RESTORE ? restore() : merge()).catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
});
