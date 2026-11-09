#!/usr/bin/env node
/**
 * One-time seed: Settings > Email Configurations from the previous hard-coded list,
 * and the division layer of the campus structure, mapped onto the LIVE data.
 *
 *   node functions/scripts/seed-mailboxes.cjs --database staging            # dry run against the TEST database
 *   node functions/scripts/seed-mailboxes.cjs --database staging --apply    # write to the TEST database
 *   node functions/scripts/seed-mailboxes.cjs --production --apply          # write to the (default) PRODUCTION database
 *   --create-missing-taxonomy   also create schools / divisions / grades the legacy routes
 *                               name but the target database lacks (useful on the test database)
 *
 * The default target is the "staging" database. Writing to "(default)" requires the
 * explicit --production flag so the live system is never touched by accident.
 *
 * Guarantees
 *   - No existing document is deleted and no existing id changes.
 *   - Every grade already listed on a school stays on that school. Grades are only
 *     ADDED to divisions; legacy "Year N" grades are mapped onto the division that
 *     holds "Grade N" in the same school, Foundation Stage / Nursery onto Early Years.
 *   - Director-style queues (explicit staff list) inherit the schools and divisions
 *     already present on their campus; they never add schools to a campus.
 *   - Categories are linked to the campuses their mailboxes use (empty = all campuses).
 */
const path = require("path");
const fs = require("fs");
const admin = require(path.join(__dirname, "..", "node_modules", "firebase-admin"));

const APPLY = process.argv.includes("--apply");
const PRODUCTION = process.argv.includes("--production");
const CREATE_MISSING = process.argv.includes("--create-missing-taxonomy");
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
const LEGACY = JSON.parse(fs.readFileSync(path.join(__dirname, "legacy-mailboxes.json"), "utf8"));

admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
const { getFirestore } = require(path.join(__dirname, "..", "node_modules", "firebase-admin", "lib", "firestore"));
const db = getFirestore(admin.app(), DATABASE_ID);
console.log(`Target: project ${PROJECT_ID}, Firestore database "${DATABASE_ID}"${PRODUCTION ? "  *** PRODUCTION ***" : ""}${APPLY ? "  (APPLY)" : "  (dry run)"}\n`);

const norm = (v) =>
    String(v || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/pre[\s-]*school/g, "preschool")
        .replace(/foundation\s*stage\s*(\d+)/g, "foundationstage$1")
        .replace(/grade\s*(\d+)/g, "grade$1")
        .replace(/kg\s*(\d+)/g, "kg$1")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

const mailboxDocId = (email) => email.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

async function byName(collection) {
    const snap = await db.collection(collection).get();
    const map = new Map(); // normalized name -> [ids]
    const names = new Map(); // id -> name
    for (const d of snap.docs) {
        const name = String(d.data().name || "").trim();
        if (!name) continue;
        names.set(d.id, name);
        const key = norm(name);
        map.set(key, [...(map.get(key) || []), d.id]);
    }
    return { map, names };
}

async function createMissingTaxonomy() {
    // Names the legacy routes use, per collection.
    const wanted = { schools: new Set(), divisions: new Set(), grades: new Set() };
    for (const mb of LEGACY) {
        for (const r of mb.routes || []) {
            wanted.schools.add(String(r.school).trim());
            wanted.divisions.add(String(r.division).trim());
            r.grades.forEach((g) => wanted.grades.add(String(g).trim()));
        }
    }
    const created = [];
    const batch = db.batch();
    for (const [collection, names] of Object.entries(wanted)) {
        const existing = await byName(collection);
        for (const name of names) {
            if (existing.map.has(norm(name))) continue;
            created.push(`${collection}: "${name}"`);
            if (APPLY) {
                const ref = db.collection(collection).doc();
                batch.set(ref, collection === "divisions" ? { name, color: "#3B82F6" } : { name });
            }
        }
    }
    if (created.length) {
        console.log(`${APPLY ? "Creating" : "Would create"} ${created.length} missing taxonomy record(s):`);
        created.forEach((c) => console.log("  + " + c));
        if (APPLY) await batch.commit();
        console.log("");
    }
}

(async () => {
    if (CREATE_MISSING) await createMissingTaxonomy();
    const [departments, schools, divisions, grades, campusSnap, existingMailboxes] = await Promise.all([
        byName("departments"),
        byName("schools"),
        byName("divisions"),
        byName("grades"),
        db.collection("campuses").get(),
        db.collection("mailboxes").get(),
    ]);
    const campuses = new Map(campusSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
    const existingByEmail = new Map(existingMailboxes.docs.map((d) => [String(d.data().email || "").toLowerCase(), d.id]));

    const problems = new Set();
    const lookup = (cat, name, label) => {
        let ids = cat.map.get(norm(name)) || [];
        if (!ids.length) {
            // Prefix fallback, e.g. legacy "Operations" -> live "Operations (Buses)".
            const key = norm(name);
            ids = [...cat.map.entries()].filter(([k]) => k.startsWith(key + " ")).flatMap(([, v]) => v);
        }
        if (!ids.length) problems.add(`${label} "${name}" has no Settings record`);
        return ids;
    };

    // Pass 1: specific mailboxes build the division layer. tree: campusId -> schoolId -> divisionId -> Set(gradeIds)
    const tree = new Map();
    const addToTree = (campusId, schoolId, divisionId, gradeIds) => {
        const bySchool = tree.get(campusId) || new Map();
        const byDiv = bySchool.get(schoolId) || new Map();
        const set = byDiv.get(divisionId) || new Set();
        gradeIds.forEach((g) => set.add(g));
        byDiv.set(divisionId, set);
        bySchool.set(schoolId, byDiv);
        tree.set(campusId, bySchool);
    };

    const prepared = [];
    for (const mb of LEGACY) {
        const email = String(mb.email).trim().toLowerCase();
        const departmentId = lookup(departments, mb.department, "Category")[0];
        if (!departmentId) continue;
        const routes = Array.isArray(mb.routes) ? mb.routes : [];
        const campus = mb.campusId ? campuses.get(mb.campusId) : null;
        if (mb.campusId && !campus) problems.add(`Mailbox ${email}: campus ${mb.campusId} not found`);
        const scope = !mb.campusId ? "department" : routes.length ? "academic" : "campus";
        const assignTo = uniq((mb.assignTo || []).map((e) => String(e).toLowerCase()));
        const routeSchools = uniq(routes.map((r) => norm(r.school)));
        const director = assignTo.length > 0 || routeSchools.length >= 5;

        const schoolIds = [];
        const divisionIds = [];
        for (const r of routes) {
            const sId = lookup(schools, r.school, "School")[0];
            const dId = lookup(divisions, r.division, "Division")[0];
            if (!sId || !dId || !campus) continue;
            if (!director) {
                const gIds = uniq(r.grades.flatMap((g) => lookup(grades, g, "Grade")));
                addToTree(campus.id, sId, dId, gIds);
                schoolIds.push(sId);
            }
            divisionIds.push(dId);
        }
        prepared.push({ mb, email, departmentId, campus, scope, assignTo, director, schoolIds: uniq(schoolIds), divisionIds: uniq(divisionIds) });
    }

    // Campus trees merged into the live schoolConfigs (never dropping anything).
    const campusWrites = [];
    const unassignedReport = [];
    for (const campus of campuses.values()) {
        const bySchool = tree.get(campus.id) || new Map();
        const configs = Array.isArray(campus.schoolConfigs) ? JSON.parse(JSON.stringify(campus.schoolConfigs)) : [];
        let changed = false;
        for (const [schoolId, byDiv] of bySchool) {
            let cfg = configs.find((c) => c.schoolId === schoolId);
            if (!cfg) {
                cfg = { schoolId, gradeIds: [], divisions: [] };
                configs.push(cfg);
                changed = true;
            }
            cfg.divisions = Array.isArray(cfg.divisions) ? cfg.divisions : [];
            for (const [divisionId, gradeSet] of byDiv) {
                let div = cfg.divisions.find((d) => d.divisionId === divisionId);
                if (!div) {
                    div = { divisionId, gradeIds: [] };
                    cfg.divisions.push(div);
                }
                const before = div.gradeIds.length;
                div.gradeIds = uniq([...(div.gradeIds || []), ...gradeSet]);
                if (div.gradeIds.length !== before) changed = true;
            }
        }
        // Map legacy grades of each school onto divisions: Year N -> division holding Grade N,
        // Foundation Stage / Nursery -> Early Years. Unmapped grades stay on the school.
        for (const cfg of configs) {
            if (!Array.isArray(cfg.divisions) || !cfg.divisions.length) continue;
            const claimed = new Set(cfg.divisions.flatMap((d) => d.gradeIds));
            const gradeName = (id) => norm(grades.names.get(id) || "");
            const divisionWithGrade = (n) =>
                cfg.divisions.find((d) => d.gradeIds.some((g) => gradeName(g) === `grade${n}`));
            const earlyYears = cfg.divisions.find((d) => norm(divisions.names.get(d.divisionId)) === "early years");
            for (const gId of cfg.gradeIds || []) {
                if (claimed.has(gId)) continue;
                const name = gradeName(gId);
                let target = null;
                const year = name.match(/^year\s*(\d+)$/);
                if (year) target = divisionWithGrade(Math.min(Number(year[1]), 12));
                else if (/^(foundationstage\d|nursery|preschool|kg\d)$/.test(name)) target = earlyYears || null;
                else if (/^grade(\d+)$/.test(name)) target = divisionWithGrade(name.replace("grade", ""));
                if (target) {
                    target.gradeIds = uniq([...target.gradeIds, gId]);
                    claimed.add(gId);
                    changed = true;
                } else {
                    unassignedReport.push(`${campus.name} / ${schools.names.get(cfg.schoolId) || cfg.schoolId}: ${grades.names.get(gId) || gId}`);
                }
            }
            const before = (cfg.gradeIds || []).length;
            cfg.gradeIds = uniq([...(cfg.gradeIds || []), ...cfg.divisions.flatMap((d) => d.gradeIds)]);
            if (cfg.gradeIds.length !== before) changed = true;
        }
        if (changed) campusWrites.push({ id: campus.id, name: campus.name, schoolConfigs: configs });
        campus.mergedConfigs = configs;
    }

    // Pass 2: director-style queues inherit the schools/divisions present on their campus.
    const deptCampuses = new Map();
    const mailboxWrites = [];
    for (const p of prepared) {
        let { schoolIds, divisionIds } = p;
        if (p.director && p.campus) {
            const configs = p.campus.mergedConfigs || [];
            schoolIds = uniq(configs.map((c) => c.schoolId));
            const campusDivisions = uniq(configs.flatMap((c) => (c.divisions || []).map((d) => d.divisionId)));
            // Single-division director queue (e.g. "Director's Office") keeps that label;
            // "all divisions" queues cover every division present on the campus.
            divisionIds = p.divisionIds.length === 1 ? p.divisionIds : campusDivisions;
        }
        if (p.campus) {
            const set = deptCampuses.get(p.departmentId) || new Set();
            set.add(p.campus.id);
            deptCampuses.set(p.departmentId, set);
        }
        const id = existingByEmail.get(p.email) || mailboxDocId(p.email);
        mailboxWrites.push({
            id,
            isNew: !existingByEmail.has(p.email),
            data: {
                email: p.email,
                displayName: p.mb.displayName || null,
                departmentId: p.departmentId,
                departmentName: departments.names.get(p.departmentId),
                scope: p.scope,
                campusId: p.campus ? p.campus.id : null,
                campusName: p.campus ? p.campus.name : null,
                schoolIds,
                divisionIds,
                assignTo: p.assignTo,
                enabled: p.mb.enabled !== false,
                notes: "Seeded from the previous code configuration.",
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                ...(existingByEmail.has(p.email) ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp(), lastSyncStatus: "never" }),
            },
        });
    }

    const deptWrites = [...deptCampuses].map(([departmentId, set]) => ({ id: departmentId, name: departments.names.get(departmentId), campusIds: [...set] }));

    // ---- report ----
    console.log(`Mailboxes to upsert: ${mailboxWrites.length}`);
    for (const w of mailboxWrites) {
        console.log(
            `  ${w.data.email.padEnd(46)} ${w.data.scope.padEnd(10)} ${String(w.data.departmentName).padEnd(18)} ` +
                `${(w.data.campusName || "-").padEnd(26)} schools=${w.data.schoolIds.length} divisions=${w.data.divisionIds.length}` +
                (w.data.assignTo.length ? ` assignTo=${w.data.assignTo.length}` : "") +
                (w.data.enabled ? "" : " DISABLED") +
                (w.isNew ? "  (new)" : "  (update)")
        );
    }
    console.log(`\nCampus trees to update: ${campusWrites.length}`);
    for (const c of campusWrites) {
        for (const cfg of c.schoolConfigs) {
            const claimed = new Set((cfg.divisions || []).flatMap((d) => d.gradeIds));
            const unassigned = (cfg.gradeIds || []).filter((g) => !claimed.has(g)).length;
            console.log(
                `  ${c.name} / ${(schools.names.get(cfg.schoolId) || cfg.schoolId).trim()}: ` +
                    (cfg.divisions || []).map((d) => `${divisions.names.get(d.divisionId) || d.divisionId} (${d.gradeIds.map((g) => grades.names.get(g) || g).join(", ")})`).join(" | ") +
                    (unassigned ? `  [${unassigned} grade(s) not in any division]` : "")
            );
        }
    }
    if (unassignedReport.length) {
        console.log(`\nGrades kept on the school but not mapped to a division (${unassignedReport.length}):`);
        unassignedReport.forEach((u) => console.log("  - " + u));
    }
    console.log(`\nCategories to link to campuses: ${deptWrites.length}`);
    for (const d of deptWrites) console.log(`  ${d.name}: ${d.campusIds.map((id) => campuses.get(id)?.name || id).join(", ")}`);
    if (problems.size) {
        console.log(`\nProblems (${problems.size}):`);
        [...problems].forEach((p) => console.log("  - " + p));
        if (CREATE_MISSING && !APPLY) console.log("  (school/division/grade records above are created first when run with --apply)");
        else if (!CREATE_MISSING) console.log("  (add --create-missing-taxonomy to create missing schools/divisions/grades, or add them in Settings)");
    }

    if (!APPLY) {
        console.log("\nDry run. Re-run with --apply to write.");
        return;
    }

    const batch = db.batch();
    for (const w of mailboxWrites) batch.set(db.collection("mailboxes").doc(w.id), w.data, { merge: true });
    for (const c of campusWrites) batch.update(db.collection("campuses").doc(c.id), { schoolConfigs: c.schoolConfigs });
    for (const d of deptWrites) batch.update(db.collection("departments").doc(d.id), { campusIds: d.campusIds });
    await batch.commit();
    console.log(`\nAPPLIED to database "${DATABASE_ID}": ${mailboxWrites.length} mailboxes, ${campusWrites.length} campuses, ${deptWrites.length} categories.`);
})().catch((e) => {
    console.error("SEED FAILED:", e.message);
    process.exit(1);
});
