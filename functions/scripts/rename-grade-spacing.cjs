#!/usr/bin/env node
/**
 * Write grade names with a space between the word and the number:
 *   "Grade1" -> "Grade 1" ... "Grade12" -> "Grade 12",  "Year1" -> "Year 1" ... "year13" -> "Year 13".
 * Every other grade (KG1, DP1, FP1, Foundation Stage 1, Nursery, Pre school ...) is left as it is.
 *
 *   node functions/scripts/rename-grade-spacing.cjs --production                        # dry run, Grade N only
 *   node functions/scripts/rename-grade-spacing.cjs --production --apply                # write,   Grade N only
 *   node functions/scripts/rename-grade-spacing.cjs --production --with-year            # dry run, Grade N and Year N
 *   node functions/scripts/rename-grade-spacing.cjs --production --with-year --apply    # write,   Grade N and Year N
 *   node functions/scripts/rename-grade-spacing.cjs --production --restore <backup file> [--apply]   # undo
 *   (use --database staging instead of --production for the test database)
 *
 * Only `grades/{id}.name` changes. Campuses, users and tickets refer to grades by id, and the
 * names that tickets carry from the day they were created ("Grade1", "Year3") stay as they are:
 * matching compares names with the space removed, and the ticket page adds the space when it
 * shows them (src/lib/grade-name.ts).
 *
 * ORDER MATTERS FOR "Year N"
 *   "Grade N" can be renamed at any time: every released version already treats "Grade1" and
 *   "Grade 1" as the same grade.
 *   "Year N" must be renamed only AFTER the release that teaches the matching code the same
 *   thing for years (normalizeScope in src/actions/ticket_assignment.ts and normalizeRoutingText
 *   in functions/src/index.ts: the `year\s*(\d+)` rule) is live in BOTH the web app and the
 *   functions. Renamed earlier, tickets that carry "Year3" stop matching the grade called
 *   "Year 3": auto-assignment and email routing for the British schools stop finding staff.
 *   That is why years need --with-year, and why --with-year --apply refuses to run until the
 *   rule is on the deployed branch.
 *
 * Before writing, the previous names are saved to a backup file next to this script (*.local,
 * ignored by git). --restore puts them back, grade by grade, and only where the grade still
 * has exactly the name this script wrote.
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const admin = require(path.join(__dirname, "..", "node_modules", "firebase-admin"));

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const PRODUCTION = args.includes("--production");
const WITH_YEAR = args.includes("--with-year");
const valueOf = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : undefined; };
const DATABASE_ID = PRODUCTION ? "(default)" : valueOf("--database") || "staging";
const RESTORE = valueOf("--restore");
const usage = "Usage: --database <id> | --production   [--with-year] [--apply]   |   --restore <backup file> [--apply]";
if (!DATABASE_ID || DATABASE_ID.startsWith("--")) { console.error(usage); process.exit(1); }
if (DATABASE_ID === "(default)" && !PRODUCTION) { console.error('Refusing to target the "(default)" (production) database without --production.'); process.exit(1); }
if (args.includes("--restore") && (!RESTORE || RESTORE.startsWith("--"))) { console.error(usage); process.exit(1); }

const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || "studio-7708718228-149dc";
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
const { getFirestore, FieldValue } = require(path.join(__dirname, "..", "node_modules", "firebase-admin", "lib", "firestore"));
const db = getFirestore(admin.app(), DATABASE_ID);
console.log(`Target: project ${PROJECT_ID}, Firestore database "${DATABASE_ID}"${PRODUCTION ? "  *** PRODUCTION ***" : ""}${APPLY ? "  (APPLY)" : "  (dry run)"}\n`);

/** The same rule the ticket page uses to show a stored name (src/lib/grade-name.ts). */
function spacedName(name, withYear) {
    const text = typeof name === "string" ? name.trim() : "";
    const match = /^(grade|year)\s*(\d+)$/i.exec(text);
    if (!match) return null;
    const word = match[1].toLowerCase();
    if (word === "year" && !withYear) return null;
    return `${word[0].toUpperCase()}${word.slice(1)} ${match[2]}`;
}
const key = (v) => String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, "");
const byNumber = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

/** True when the release that treats "Year3" and "Year 3" as one grade is on the deployed branch. */
function yearRuleOnDeployedBranch() {
    const branch = DATABASE_ID === "(default)" ? "origin/production" : "origin/main";
    const repo = path.join(__dirname, "..", "..");
    const missing = [];
    for (const file of ["src/actions/ticket_assignment.ts", "functions/src/index.ts"]) {
        try {
            const text = execSync(`git show ${branch}:${file}`, { cwd: repo, maxBuffer: 1 << 26, stdio: ["ignore", "pipe", "ignore"] }).toString();
            if (!/year\\s\*\(\\d\+\)/.test(text)) missing.push(file);
        } catch (e) {
            missing.push(`${file} (could not read ${branch}; run "git fetch origin" first)`);
        }
    }
    return { branch, missing };
}

async function restore() {
    const file = path.resolve(RESTORE);
    const backup = JSON.parse(fs.readFileSync(file, "utf8"));
    if (backup.database !== DATABASE_ID) { console.error(`This backup is for database "${backup.database}", not "${DATABASE_ID}".`); process.exit(1); }
    console.log(`Restoring from ${file}\n  ${backup.grades.length} grade name(s) changed on ${backup.at}\n`);
    const result = await db.runTransaction(async (tx) => {
        const snaps = await tx.getAll(...backup.grades.map((g) => db.collection("grades").doc(g.id)));
        const out = { restored: [], skipped: [] };
        snaps.forEach((snap, i) => {
            const g = backup.grades[i];
            if (!snap.exists) { out.skipped.push(`${g.id} ("${g.after}"): the grade no longer exists`); return; }
            if (snap.data().name !== g.after) { out.skipped.push(`${g.id}: is now "${snap.data().name}", not "${g.after}" (changed since)`); return; }
            out.restored.push(`"${g.after}" -> "${g.before}"`);
            if (APPLY) tx.update(snap.ref, { name: g.before });
        });
        if (APPLY && out.restored.length) {
            tx.set(db.collection("system-logs").doc(), {
                eventType: "GRADES_RENAMED",
                actor: { userId: "maintenance-script", name: "Maintenance script" },
                message: `${out.restored.length} grade name(s) put back to their previous spelling.`,
                details: { restoredFrom: path.basename(file), names: out.restored },
                timestamp: FieldValue.serverTimestamp(),
            });
        }
        return out;
    });
    console.log(`${APPLY ? "Restored" : "Would restore"} ${result.restored.length} grade name(s):\n  ${result.restored.join("\n  ") || "none"}`);
    if (result.skipped.length) console.log("Left alone:\n  " + result.skipped.join("\n  "));
    if (!APPLY) console.log("\nDry run: nothing written. Add --apply to write.");
}

async function rename() {
    if (WITH_YEAR) {
        const { branch, missing } = yearRuleOnDeployedBranch();
        if (missing.length) {
            const text = `The code that treats "Year3" and "Year 3" as the same grade is not on ${branch} yet:\n  ${missing.join("\n  ")}`;
            if (APPLY) { console.error(`Refusing to rename the Year grades. ${text}\nPush it, wait for the web deploy, deploy the functions, then run this again.`); process.exit(1); }
            console.log(`NOTE: ${text}\n      --with-year --apply will refuse until it is.\n`);
        } else {
            console.log(`The year rule is on ${branch}. Before --apply, make sure the web deploy of that push has finished AND the functions are deployed (cd functions && npm run deploy).\n`);
        }
    }

    const plan = await db.runTransaction(async (tx) => {
        const snaps = (await tx.get(db.collection("grades"))).docs;
        const out = { total: snaps.length, changes: [], untouched: [], skippedYears: [], problems: [], duplicates: [] };
        const sameName = new Map(); // name without spaces / case -> [grades]
        for (const snap of snaps) {
            const before = snap.data().name;
            const after = spacedName(before, WITH_YEAR);
            if (after && after !== before) {
                // Adding a space must never turn a grade into a different name for the matching code.
                if (key(after) !== key(before)) out.problems.push(`"${before}" -> "${after}" is more than a spacing change`);
                out.changes.push({ id: snap.id, before, after, ref: snap.ref });
            } else if (!after && spacedName(before, true) && spacedName(before, true) !== before) out.skippedYears.push(before);
            else out.untouched.push(before);
            sameName.set(key(before), [...(sameName.get(key(before)) || []), `${JSON.stringify(before)} (${snap.id})`]);
        }
        // Not caused by this script (the spacing change keeps every name's identity): reported only.
        for (const [, list] of sameName) if (list.length > 1) out.duplicates.push(list.join(" and "));
        if (out.problems.length) return out;
        if (APPLY && out.changes.length) {
            for (const c of out.changes) tx.update(c.ref, { name: c.after });
            tx.set(db.collection("system-logs").doc(), {
                eventType: "GRADES_RENAMED",
                actor: { userId: "maintenance-script", name: "Maintenance script" },
                message: `${out.changes.length} grade name(s) rewritten with a space between the word and the number.`,
                details: { names: out.changes.map((c) => `"${c.before}" -> "${c.after}"`) },
                timestamp: FieldValue.serverTimestamp(),
            });
            // Written inside the transaction callback so the file always matches what is committed;
            // if the commit fails the file is simply a record of an attempt that changed nothing.
            const file = path.join(__dirname, `rename-grade-spacing-${DATABASE_ID.replace(/[^a-z0-9]/gi, "")}-${Date.now()}.json.local`);
            fs.writeFileSync(file, JSON.stringify({ database: DATABASE_ID, at: new Date().toISOString(), withYear: WITH_YEAR, grades: out.changes.map(({ id, before, after }) => ({ id, before, after })) }, null, 1));
            out.backupFile = file;
        }
        return out;
    });

    console.log(`Grades: ${plan.total}`);
    console.log(`\n${APPLY && !plan.problems.length ? "Renamed" : "Would rename"} (${plan.changes.length}):`);
    console.log("  " + (plan.changes.slice().sort((a, b) => byNumber(a.after, b.after)).map((c) => `${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`).join("\n  ") || "none - already written with a space"));
    if (plan.skippedYears.length) console.log(`\nYear grades left for later (add --with-year once the code is live) (${plan.skippedYears.length}):\n  ${plan.skippedYears.sort(byNumber).join("  ")}`);
    console.log(`\nLeft as they are (${plan.untouched.length}):\n  ${plan.untouched.sort(byNumber).join("  ")}`);

    if (plan.duplicates.length) console.log(`\nNOTE: the same grade is entered more than once (already so, not changed by this script; merge-duplicate-grade.cjs merges them):\n  ${plan.duplicates.join("\n  ")}`);

    if (plan.problems.length) { console.error("\nRefusing, nothing written:\n  " + plan.problems.join("\n  ")); process.exit(1); }
    if (!APPLY) { console.log("\nDry run: nothing written. Add --apply to write."); return; }
    if (!plan.changes.length) { console.log("\nNothing to write."); return; }

    console.log(`\nWritten. Backup of the previous names: ${plan.backupFile}`);
    // Verify from fresh reads.
    const fresh = new Map((await db.collection("grades").get()).docs.map((d) => [d.id, d.data().name]));
    const wrong = plan.changes.filter((c) => fresh.get(c.id) !== c.after).map((c) => `${c.id}: expected "${c.after}", found "${fresh.get(c.id)}"`);
    const names = [...fresh.values()];
    if (wrong.length || fresh.size !== plan.total) {
        console.error("VERIFY FAILED:\n  " + [...wrong, fresh.size !== plan.total ? `grade count changed: ${plan.total} -> ${fresh.size}` : ""].filter(Boolean).join("\n  "));
        process.exit(1);
    }
    console.log(`Verified: ${fresh.size} grades, every renamed grade has its new name. Names now:\n  ${names.sort(byNumber).join("  ")}`);
}

(RESTORE ? restore() : rename()).catch((e) => {
    console.error("FAILED:", e.message);
    process.exit(1);
});
