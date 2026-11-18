

'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import type { UserProfile, Ticket } from '@/lib/types';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { getTicketSummarySnapshot } from '@/lib/server/ticket-summary-cache';
import { compareDocIds } from '@/lib/ticket-scope';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';
import { isWithinWorkingHours } from '@/lib/working-hours-utils';
export type AssigneeProfile = Pick<UserProfile, 'id' | 'name' | 'avatarUrl' | 'email'>;

export interface QueuedTicketAssignment {
  ticketId: string;
  ticketNumber?: number | string;
  subject: string;
  assigneeId: string;
  assigneeName: string;
  departmentId: string;
  departmentName?: string;
  campusId?: string | null;
  campusName?: string | null;
}

export interface AutoAssignResult {
  success: boolean;
  assignedCount: number;
  totalQueued: number;
  assignments: QueuedTicketAssignment[];
  skippedTickets: Array<{
    ticketId: string;
    ticketNumber?: number | string;
    subject?: string;
    reason: string;
  }>;
  message: string;
}

/**
 * Email tickets store schoolName/divisionName/grades instead of IDs.
 * A taxonomy index translates those names to Firestore IDs when possible.
 * Never treat an empty employee scope as "all".
 * Verify collection/field names against your Firestore schema before deployment.
 */
const DEPARTMENT_ONLY_IDS = new Set([
  'PjGUdEp51xWc0fBKEooa', // General Support
  '4K7BgUVmGi52sqKJNpB1', // Operations
]);

type ScopeRecord = Record<string, unknown>;
type ScopeTicket = {
  departmentId?: string | null;
  campusId?: string | null;
  schoolId?: string | null;
  schoolName?: string | null;
  school?: string | null;
  divisionId?: string | null;
  divisionName?: string | null;
  division?: string | null;
  gradeId?: string | null;
  gradeName?: string | null;
  grade?: string | null;
  grades?: string[];
  allowedGrades?: string[];
  routingOptions?: Array<{ school?: string; division?: string; grades?: string[] }>;
  mailboxEmail?: string | null;
};
type ScopeAgent = {
  email?: string;
  /** Lower-cased mailbox addresses; when present the agent only serves those mailboxes. */
  mailboxEmails?: string[];
  campusIds?: string[];
  campusId?: string;
  schoolIds?: string[];
  schoolNames?: string[];
  schools?: string[];
  schoolName?: string;
  divisionIds?: string[];
  divisionNames?: string[];
  divisions?: string[];
  divisionName?: string;
  gradeIds?: string[];
  gradeNames?: string[];
  grades?: string[];
  gradeName?: string;
};
type MailboxRule = { scope: string; assignTo: string[]; departmentId: string | null };
type Taxonomy = {
  schools: Map<string, string[]>;
  divisions: Map<string, string[]>;
  grades: Map<string, string[]>;
  /** Settings > Email Configurations, keyed by lower-cased address. */
  mailboxes: Map<string, MailboxRule>;
};

const normalizeScope = (v: unknown): string => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/grade\s*(\d+)/g, 'grade$1').replace(/kg\s*(\d+)/g, 'kg$1').replace(/year\s*(\d+)/g, 'year$1')
  .replace(/[^a-z0-9]+/g, ' ').trim();
const textValues = (...values: unknown[]): string[] => {
  const result: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'string' && value.trim()) result.push(value.trim());
  };
  values.forEach(visit);
  return result;
};

async function loadTaxonomy(db: FirebaseFirestore.Firestore): Promise<Taxonomy> {
  const build = async (collectionName: string): Promise<Map<string, string[]>> => {
    const map = new Map<string, string[]>();
    const snap = await db.collection(collectionName).get();
    for (const doc of snap.docs) {
      const data = doc.data() as ScopeRecord;
      for (const text of textValues(data.name, data.nameEn, data.label, data.title, data.code, data.displayName)) {
        const key = normalizeScope(text);
        const ids = map.get(key) || [];
        if (!ids.includes(doc.id)) ids.push(doc.id);
        map.set(key, ids);
      }
    }
    return map;
  };
  const [schools, divisions, grades, mailboxSnap] = await Promise.all([
    build('schools'), build('divisions'), build('grades'), db.collection('mailboxes').get()
  ]);
  const mailboxes = new Map<string, MailboxRule>();
  for (const doc of mailboxSnap.docs) {
    const data = doc.data() as { email?: string; scope?: string; assignTo?: string[]; departmentId?: string };
    if (!data.email) continue;
    mailboxes.set(String(data.email).trim().toLowerCase(), {
      scope: data.scope || 'department',
      assignTo: Array.isArray(data.assignTo) ? data.assignTo.map(e => String(e).trim().toLowerCase()) : [],
      departmentId: typeof data.departmentId === 'string' && data.departmentId.trim() ? data.departmentId.trim() : null,
    });
  }
  return { schools, divisions, grades, mailboxes };
}

/**
 * Central scope guard shared by immediate and queued auto-assignment.
 * Missing or contradictory ticket attributes must NEVER widen access.
 */
function agentCoversTicket(agent: ScopeAgent, ticket: ScopeTicket, taxonomy: Taxonomy): boolean {
  const coarse = coarseScopeDecision(agent, ticket, taxonomy);
  return coarse !== null ? coarse : detailedScopeMatch(agent, ticket, taxonomy);
}

/**
 * First half of agentCoversTicket: everything that can be decided from the ticket's
 * category, campus and mailbox alone. Returns the final answer, or null when the ticket's
 * school / division / grade detail (detailedScopeMatch) has to decide.
 * It must not read ticket.grades, ticket.allowedGrades or ticket.routingOptions: the Queue
 * scan relies on that to skip downloading those large fields (see QUEUE_DETAIL_FIELDS).
 */
function coarseScopeDecision(agent: ScopeAgent, ticket: ScopeTicket, taxonomy: Taxonomy): boolean | null {
  const ticketMailbox = String(ticket.mailboxEmail || '').trim().toLowerCase();
  const mailboxRule = ticketMailbox ? taxonomy.mailboxes.get(ticketMailbox) : undefined;

  // A ticket keeps its original mailbox address for life, but once it is transferred to
  // another category that mailbox no longer describes the queue it sits in. The mailbox's
  // own rules (who serves it, its staff list) apply only while the ticket is still in the
  // mailbox's category. A mailbox without a stored category is treated as owning the ticket.
  const mailboxOwnsTicket = Boolean(mailboxRule) && (
    !mailboxRule!.departmentId || !ticket.departmentId || mailboxRule!.departmentId === ticket.departmentId
  );

  // Staff attached to specific mailboxes (Settings > Employees > "by mailbox") only
  // receive tickets from those mailboxes. Tickets without a mailbox (forms, phone,
  // walk-in), tickets transferred in from another category's mailbox and tickets of a
  // mailbox that is no longer configured follow the normal scope rules instead;
  // otherwise nobody in the receiving category could ever be assigned to them.
  const agentMailboxes = textValues(agent.mailboxEmails).map(e => e.toLowerCase());
  if (agentMailboxes.length && ticketMailbox && mailboxOwnsTicket && !agentMailboxes.includes(ticketMailbox)) return false;

  // General Support and Operations have no campus or academic routing restrictions.
  // Their department is checked by the caller's Firestore query / scope guard.
  if (ticket.departmentId && DEPARTMENT_ONLY_IDS.has(ticket.departmentId)) return true;
  // Category-wide mailbox (no campus): anyone in the category. The one exception is "by
  // mailbox" staff receiving a ticket transferred in WITH a campus: they are campus teams,
  // so the campus is enforced below instead of handing it to another campus's team.
  if (mailboxRule?.scope === 'department' &&
      (mailboxOwnsTicket || !ticket.campusId || !agentMailboxes.length)) return true;

  const agentCampuses = textValues(agent.campusIds, agent.campusId);
  if (!ticket.campusId || !agentCampuses.includes(ticket.campusId)) return false;

  // Transferred in (or mailbox no longer configured): "by mailbox" staff who serve a
  // category-wide or campus-level queue of THIS category (Admissions, Collection...) carry
  // no school/division/grade scope, so the campus (checked above) is what qualifies them.
  // Staff of academic queues continue to the strict school/division/grade matching below.
  if (ticketMailbox && !mailboxOwnsTicket && agentMailboxes.length) {
    const servesCampusLevelQueue = agentMailboxes.some(address => {
      const own = taxonomy.mailboxes.get(address);
      return Boolean(own) && (own!.scope === 'department' || own!.scope === 'campus') &&
        (!own!.departmentId || !ticket.departmentId || own!.departmentId === ticket.departmentId);
    });
    if (servesCampusLevelQueue) return true;
  }

  // Director-style mailbox: only the listed staff, campus already checked above.
  // The staff list belongs to the mailbox's own category, so it is ignored after a transfer.
  if (mailboxOwnsTicket && mailboxRule?.assignTo.length) {
    const agentEmail = String(agent.email || '').trim().toLowerCase();
    return Boolean(agentEmail) && mailboxRule.assignTo.includes(agentEmail);
  }
  // Campus-only mailbox (Admissions / Collection): no school, division or grade needed.
  if (mailboxRule?.scope === 'campus') return true;

  return null;
}

/**
 * Second half of agentCoversTicket: strict school / division / grade matching. Only valid
 * after coarseScopeDecision returned null (category, mailbox and campus already checked).
 */
function detailedScopeMatch(agent: ScopeAgent, ticket: ScopeTicket, taxonomy: Taxonomy): boolean {
  const matches = (
    ids: unknown, names: unknown, targetId: unknown, targetName: unknown,
    catalog: Map<string, string[]>
  ): boolean => {
    const agentIds = textValues(ids);
    const agentNames = textValues(names).map(normalizeScope);
    const id = typeof targetId === 'string' ? targetId.trim() : '';
    const name = normalizeScope(targetName);
    if (!id && !name) return false;

    // When both are provided, reject a contradictory or unknown name.
    // For an ID alone, use the exact ID (no broad name fallback).
    if (id && name) {
      const knownIds = catalog.get(name) || [];
      if (!knownIds.includes(id)) return false;
    }
    if (id) return agentIds.includes(id);
    const matchingIds = catalog.get(name) || [];
    return matchingIds.some(candidate => agentIds.includes(candidate)) || agentNames.includes(name);
  };

  const routes = Array.isArray(ticket.routingOptions) ? ticket.routingOptions : [];
  const requestedSchool = ticket.schoolName || ticket.school;
  const requestedDivision = ticket.divisionName || ticket.division;
  const requestedGrade = ticket.gradeName || ticket.grade;

  // Campus-only tickets have no school, division, grade or mailbox-specific route.
  // They can be assigned to any available, active Employee in the matching
  // department (checked by callers) and campus (checked above).
  // Keep strict scope matching whenever the ticket specifies ANY finer scope.
  const isCampusOnlyTicket =
    routes.length === 0 &&
    !textValues(ticket.schoolId, requestedSchool).length &&
    !textValues(ticket.divisionId, requestedDivision).length &&
    !textValues(ticket.gradeId, requestedGrade, ticket.grades, ticket.allowedGrades).length;
  if (isCampusOnlyTicket) return true;

  const candidates = routes.filter(route =>
    (!requestedSchool || normalizeScope(route.school) === normalizeScope(requestedSchool)) &&
    (!requestedDivision || normalizeScope(route.division) === normalizeScope(requestedDivision)) &&
    (!requestedGrade || textValues(route.grades).some(g => normalizeScope(g) === normalizeScope(requestedGrade)))
  );
  const route = candidates.length === 1 ? candidates[0] : null;
  if (routes.length > 0 && !route) return false;

  const school = requestedSchool || route?.school;
  const division = requestedDivision || route?.division;
  if (!matches(agent.schoolIds, [agent.schoolNames, agent.schools, agent.schoolName], ticket.schoolId, school, taxonomy.schools)) return false;
  if (!matches(agent.divisionIds, [agent.divisionNames, agent.divisions, agent.divisionName], ticket.divisionId, division, taxonomy.divisions)) return false;

  // For a configured mailbox route the selected grade must belong to it.
  if (route && ticket.gradeId) {
    const permittedIds = textValues(route.grades).flatMap(g => taxonomy.grades.get(normalizeScope(g)) || []);
    if (!permittedIds.includes(ticket.gradeId)) return false;
  }
  if (ticket.gradeId) {
    return matches(agent.gradeIds, [agent.gradeNames, agent.grades, agent.gradeName], ticket.gradeId, requestedGrade, taxonomy.grades);
  }

  const permittedGrades = requestedGrade
    ? [requestedGrade]
    : route ? textValues(route.grades) : textValues(ticket.grades);
  if (permittedGrades.length === 0) return false;
  // A specific mailbox route restricts even any supplied grades list.
  if (route && permittedGrades.some(g => !textValues(route.grades).some(rg => normalizeScope(rg) === normalizeScope(g)))) return false;
  return permittedGrades.some(grade => matches(
    agent.gradeIds, [agent.gradeNames, agent.grades, agent.gradeName], null, grade, taxonomy.grades
  ));
}


/** Validate a chosen employee against the same scope rules, regardless of online status. */
export async function employeeCoversTicketScope(
  employeeId: string,
  ticket: ScopeTicket & { departmentId?: string | null }
): Promise<boolean> {
  const db = adminDb;

  if (!db || !ticket.departmentId) return false;

  const snap = await db.collection('users').doc(employeeId).get();

  if (!snap.exists) return false;

  const data = snap.data() as UserProfile;

  // Check employee role
  if (data.role !== 'Employee') return false;

  // Check department
  if (data.departmentId !== ticket.departmentId) return false;

  // Check availability
  if (data.status !== 'Available') return false;

  // Check ticket scope
  const taxonomy = await loadTaxonomy(db);

  return agentCoversTicket(
    data as ScopeAgent,
    ticket,
    taxonomy
  );
}

/**
 * Returns the next available, logged-in staff member (Employees) in a department 
 * who covers the specific campus, school, division, and grade of the ticket.
 * Uses round-robin sequencing.
 */
export async function getRoundRobinAssignee(
    departmentIdOrTicket: string | {
        departmentId: string;
        campusId?: string | null;
        schoolId?: string | null;
        divisionId?: string | null;
        gradeId?: string | null;
        schoolName?: string | null;
        divisionName?: string | null;
        gradeName?: string | null;
        grades?: string[];
        allowedGrades?: string[];
        mailboxEmail?: string | null;
        routingOptions?: ScopeTicket['routingOptions'];
    },
    campusId?: string | null,
    schoolId?: string | null,
    divisionId?: string | null,
    gradeId?: string | null
): Promise<AssigneeProfile | null> {
    const db = adminDb;
    if (!db) {
        console.warn('getRoundRobinAssignee: Firestore Admin not initialized.');
        return null;
    }

    let departmentId = '';
    let ticketContext: ScopeTicket = {};

    if (typeof departmentIdOrTicket === 'object' && departmentIdOrTicket !== null) {
        departmentId = departmentIdOrTicket.departmentId;
        ticketContext = {
            departmentId,
            campusId: departmentIdOrTicket.campusId,
            schoolId: departmentIdOrTicket.schoolId,
            divisionId: departmentIdOrTicket.divisionId,
            gradeId: departmentIdOrTicket.gradeId,
            schoolName: departmentIdOrTicket.schoolName,
            divisionName: departmentIdOrTicket.divisionName,
            gradeName: departmentIdOrTicket.gradeName,
            grades: departmentIdOrTicket.grades,
            allowedGrades: departmentIdOrTicket.allowedGrades,
            mailboxEmail: departmentIdOrTicket.mailboxEmail,
            routingOptions: departmentIdOrTicket.routingOptions,
        };
    } else {
        departmentId = departmentIdOrTicket;
        ticketContext = { departmentId, campusId, schoolId, divisionId, gradeId };
    }

    const deptRef = db.collection('departments').doc(departmentId);
    let assignee: AssigneeProfile | null = null;

    try {
        // PERF: these two reads are independent; run them concurrently (both stay inside
        // this try, so any failure still lands in the same catch and returns null).
        const [holidaysSnap, taxonomy] = await Promise.all([
            db.collection('official_holidays').where('isActive', '==', true).get(),
            loadTaxonomy(db),
        ]);
        const activeHolidays = holidaysSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

        await db.runTransaction(async (transaction) => {
            const deptDoc = await transaction.get(deptRef);
            if (!deptDoc.exists) {
                throw new Error(`Department with ID ${departmentId} not found.`);
            }
            const department = deptDoc.data() as any;

            const isNowWorking = isWithinWorkingHours(department.workingHours, new Date(), activeHolidays);

            if (!isNowWorking) {
                console.log(
                    `Outside working hours (or official holiday) for department ${departmentId}. Assignment skipped.`
                );
                return;
            }

            // Get staff members with 'Employee' role in this department
            const usersSnapshot = await transaction.get(
                db.collection('users')
                    .where('departmentId', '==', departmentId)
                    .where('role', '==', 'Employee')
            );

            if (usersSnapshot.empty) return;

            // Filter staff by available & logged-in status AND covering ticket attributes (campus, school, division, grade)
            const availableEmployees = usersSnapshot.docs
                .map((doc) => {
                    const data = doc.data() as UserProfile;
                    return {
                        id: doc.id,
                        name: data.name,
                        email: data.email,
                        avatarUrl: data.avatarUrl,
                        status: data.status || 'Offline',
                        campusIds: data.campusIds || [],
                        campusId: (data as any).campusId,
                        schoolIds: data.schoolIds || [],
                        schoolNames: (data as any).schoolNames,
                        schools: (data as any).schools,
                        schoolName: (data as any).schoolName,
                        divisionIds: data.divisionIds || [],
                        divisionNames: (data as any).divisionNames,
                        divisions: (data as any).divisions,
                        divisionName: (data as any).divisionName,
                        gradeIds: data.gradeIds || [],
                        gradeNames: (data as any).gradeNames,
                        grades: (data as any).grades,
                        gradeName: (data as any).gradeName,
                        mailboxEmails: (data as any).mailboxEmails || [],
                        activeSessionId: data.activeSessionId,
                    };
                })
                .filter(emp => emp.status === 'Available' && !!emp.activeSessionId)
                .filter(emp => agentCoversTicket(emp, ticketContext, taxonomy))
                .sort((a, b) => a.id.localeCompare(b.id));

            if (availableEmployees.length === 0) return;

            let lastAssignedId = department.lastAssignedUserId;
            let nextIndex = 0;

            if (lastAssignedId) {
                const prevIndex = availableEmployees.findIndex(emp => emp.id === lastAssignedId);
                if (prevIndex !== -1) {
                    nextIndex = (prevIndex + 1) % availableEmployees.length;
                } else {
                    let lastIndex = department.lastAssignedUserIndex ?? -1;
                    nextIndex = ((lastIndex + 1) % availableEmployees.length + availableEmployees.length) % availableEmployees.length;
                }
            } else {
                let lastIndex = department.lastAssignedUserIndex ?? -1;
                nextIndex = ((lastIndex + 1) % availableEmployees.length + availableEmployees.length) % availableEmployees.length;
            }

            const candidate = availableEmployees[nextIndex];

            assignee = {
                id: candidate.id,
                name: candidate.name,
                email: candidate.email,
                avatarUrl: candidate.avatarUrl,
            };

            // Update the department's last assigned user pointer
            transaction.update(deptRef, {
                lastAssignedUserIndex: nextIndex,
                lastAssignedUserId: candidate.id,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return assignee;
    } catch (error) {
        console.error(`Round-robin assignment failed:`, error);
        return null;
    }
}

// ---- Queue scan: what is read, and what is remembered between passes -----------------------
// Small fields read for every queued ticket on every pass.
// !! If the Queue loop or coarseScopeDecision reads a new ticket field, add it here. !!
const QUEUE_LIGHT_FIELDS = [
  'createdAt', 'departmentId', 'ticketNumber', 'subject', 'campusId', 'campusName',
  'pendingTransferRequestId', 'pendingLocalTransferRequestId',
  'schoolId', 'schoolName', 'school', 'divisionId', 'divisionName', 'division',
  'gradeId', 'gradeName', 'grade', 'mailboxEmail',
];
// Large fields, read only by detailedScopeMatch. !! Add any new field it reads here. !!
const QUEUE_DETAIL_FIELDS = ['grades', 'allowedGrades', 'routingOptions'];
const QUEUE_DETAIL_CHUNK = 250;
const QUEUE_DETAIL_PARALLEL = 4;
const MAX_SKIPPED_RETURNED = 100;

type QueuedTicket = {
  id: string;
  /** Firestore update time of the document the data was read from. */
  version: string;
  data: FirebaseFirestore.DocumentData;
  /** true once QUEUE_DETAIL_FIELDS are present in data (when the ticket has them). */
  hasDetail: boolean;
  /** The ticket left the Queue between the scan and the detail read. */
  gone?: boolean;
};

const snapshotVersion = (snap: FirebaseFirestore.DocumentSnapshot): string =>
  snap.updateTime ? `${snap.updateTime.seconds}.${snap.updateTime.nanoseconds}` : '';

/**
 * Per server instance: the large scope fields of queued tickets, keyed by ticket id and
 * valid only for the stored version. It is a pure read cache: losing it (new instance,
 * restart) only means the fields are read again. Identical values (the same mailbox routes
 * on thousands of tickets) share one object; nothing mutates them.
 */
const queueDetailCache = new Map<string, { version: string; departmentId: string; detail: Record<string, unknown>; loadedAt: number }>();
const internedDetailValues = new Map<string, unknown>();
function internDetailValue(value: unknown): unknown {
  const key = JSON.stringify(value);
  if (key === undefined) return value;
  if (internedDetailValues.has(key)) return internedDetailValues.get(key);
  if (internedDetailValues.size >= 5000) internedDetailValues.clear();
  internedDetailValues.set(key, value);
  return value;
}

// ---- Queue scan from the in-memory ticket_summaries snapshot (optional) ----------------------
/**
 * settings/ticketSummaries { enabled: true, queueFromSummaries: true } — live switch.
 *
 * Off (default): every pass reads the small fields of EVERY queued ticket from Firestore
 * (one document read per queued ticket, per pass; with thousands of tickets waiting for staff
 * who are offline that is millions of reads a day).
 * On: the pass takes the queued tickets from this instance's in-memory copy of
 * ticket_summaries (src/lib/server/ticket-summary-cache.ts — the copy the paged tickets list
 * uses, kept current by reading only the summaries that changed). The mirror copies the
 * fields the pass reads verbatim (verified on every queued production ticket). Nothing else
 * changes: the large fields are still read from `tickets`, and the assignment transaction
 * still re-reads the real ticket, agent and category and re-checks everything before writing.
 * A ticket that entered the Queue a moment ago may not be in the copy yet; the next pass
 * (at most 30 s later) takes it.
 *
 * The switch is re-read at most every 30 s per instance. Any error => the direct read.
 */
const QUEUE_FLAG_TTL_MS = 30_000;
let queueFlagCache: { at: number; on: boolean } | null = null;
async function queueFromSummariesEnabled(db: FirebaseFirestore.Firestore): Promise<boolean> {
  const now = Date.now();
  if (queueFlagCache && now - queueFlagCache.at < QUEUE_FLAG_TTL_MS) return queueFlagCache.on;
  let on = false;
  try {
    const flags = (await db.collection('settings').doc('ticketSummaries').get()).data();
    on = flags?.enabled === true && flags?.queueFromSummaries === true;
  } catch {
    on = false;
  }
  queueFlagCache = { at: now, on };
  return on;
}

/** Versions taken from a summary; never equal to a ticket's own update time. */
const SUMMARY_VERSION_PREFIX = 's:';
/**
 * A summary's version changes whenever a field the mirror copies changes. routingOptions is
 * copied in a condensed form, and no code changes it after a ticket is created; should it
 * ever be edited by hand without changing the summary, the large fields are read again after
 * this long anyway.
 */
const SUMMARY_DETAIL_MAX_AGE_MS = 60 * 60 * 1000;
/** The copy must be at least this recent when a pass starts (it then catches up first). */
const SUMMARY_MAX_STALENESS_MS = 1_500;

async function loadQueueFromSummaries(
  db: FirebaseFirestore.Firestore,
  departmentId: string | undefined
): Promise<QueuedTicket[]> {
  const { docs } = await getTicketSummarySnapshot(db, Timestamp.fromMillis(Date.now() - SUMMARY_MAX_STALENESS_MS));
  const ids: string[] = [];
  docs.forEach((entry, id) => {
    const summary = entry.data;
    if (summary.status === 'Queue' && (!departmentId || summary.departmentId === departmentId)) ids.push(id);
  });
  // The order a Firestore query returns its documents in; the created-date sort below is
  // stable, so tickets created at the same instant keep exactly the order they had before.
  ids.sort(compareDocIds);
  return ids.map(id => {
    const summary = docs.get(id)!.data;
    // Only the fields the direct scan selects — present keys only, as a projection returns them.
    const data: FirebaseFirestore.DocumentData = {};
    for (const field of QUEUE_LIGHT_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(summary, field)) data[field] = summary[field];
    }
    const synced = summary._summarySyncedAt;
    const stamp = synced && typeof synced.seconds === 'number' && typeof synced.nanoseconds === 'number'
      ? `${synced.seconds}.${synced.nanoseconds}`
      : 'unstamped';
    return { id, version: SUMMARY_VERSION_PREFIX + stamp, data, hasDetail: false };
  });
}

/**
 * Per server instance: at most ONE Queue pass runs at a time for the same request
 * (same category / same ticket), plus at most one waiting to start.
 *
 * Every Available user's tickets page asks for a pass every 30 s, and a status change or a
 * transfer decision asks for one too. They used to run side by side on the same CPU, each
 * reading the whole Queue, which is how single passes reached 20-30 s. A caller that arrives
 * while a pass is running does NOT join it (that pass may have read the agents before the
 * caller's own change, e.g. before they became Available): it shares the next pass, which
 * starts only after the running one ends, so it always sees the caller's state.
 */
const autoAssignRunning = new Map<string, Promise<void>>();
const autoAssignWaiting = new Map<string, Promise<AutoAssignResult>>();

/**
 * Automatically assigns queued tickets (status === 'Queue') to available, logged-in agents
 * using fair round-robin distribution per department and campus/school/division/grade coverage.
 */
export async function autoAssignQueuedTickets(options?: {
  departmentId?: string;
  ticketId?: string;
}): Promise<AutoAssignResult> {
  const key = JSON.stringify([options?.departmentId ?? null, options?.ticketId ?? null]);

  const waiting = autoAssignWaiting.get(key);
  if (waiting) return waiting;

  const start = (): Promise<AutoAssignResult> => {
    autoAssignWaiting.delete(key);
    const run = runAutoAssignQueuedTickets(options);
    const settled: Promise<void> = run.then(() => undefined, () => undefined).finally(() => {
      if (autoAssignRunning.get(key) === settled) autoAssignRunning.delete(key);
    });
    autoAssignRunning.set(key, settled);
    return run;
  };

  const running = autoAssignRunning.get(key);
  if (!running) return start();

  const next = running.then(start);
  autoAssignWaiting.set(key, next);
  return next;
}

async function runAutoAssignQueuedTickets(options?: {
  departmentId?: string;
  ticketId?: string;
}): Promise<AutoAssignResult> {
  const db = adminDb;
  if (!db) {
    return {
      success: false,
      assignedCount: 0,
      totalQueued: 0,
      assignments: [],
      skippedTickets: [],
      message: 'Firestore Admin not initialized',
    };
  }

  try {
    // 1. Fetch tickets with status 'Queue'
    // PERF: the Queue can hold thousands of tickets nobody can take yet, and each carries a
    // copy of its mailbox routes (routingOptions, up to ~15 KB). Downloading all of that on
    // every pass took 6-30 s. So:
    //   - one ticket asked for  -> read that one document;
    //   - otherwise             -> read only the small fields, then load the large scope
    //     fields just for tickets an available agent might cover, once per ticket version
    //     (queueDetailCache). The assignment transaction below still re-reads the FULL ticket
    //     and re-checks everything before writing, exactly as before.
    let queued: QueuedTicket[];
    // true: `queued` came from the ticket_summaries copy (see loadQueueFromSummaries).
    let fromSummaries = false;
    if (options?.ticketId) {
      const snap = await db.collection('tickets').doc(options.ticketId).get();
      const data = snap.data();
      const isQueued = Boolean(data) && data!.status === 'Queue' &&
        (!options.departmentId || data!.departmentId === options.departmentId);
      queued = isQueued ? [{ id: snap.id, version: snapshotVersion(snap), data: data!, hasDetail: true }] : [];
    } else {
      let viaSummaries: QueuedTicket[] | null = null;
      if (await queueFromSummariesEnabled(db)) {
        try {
          viaSummaries = await loadQueueFromSummaries(db, options?.departmentId);
        } catch (summaryError: any) {
          console.warn('[auto-assign] ticket_summaries copy unavailable, reading the Queue directly:', summaryError?.message || summaryError);
        }
      }
      if (viaSummaries) {
        queued = viaSummaries;
        fromSummaries = true;
      } else {
        let queryRef = db.collection('tickets').where('status', '==', 'Queue');
        if (options?.departmentId) {
          queryRef = queryRef.where('departmentId', '==', options.departmentId);
        }
        // A projection never filters documents (docs missing these fields are still returned).
        const queuedSnap = await queryRef.select(...QUEUE_LIGHT_FIELDS).get();
        queued = queuedSnap.docs.map(d => ({ id: d.id, version: snapshotVersion(d), data: d.data(), hasDetail: false }));
      }
    }

    if (queued.length === 0) {
      return {
        success: true,
        assignedCount: 0,
        totalQueued: 0,
        assignments: [],
        skippedTickets: [],
        message: 'No queued tickets found.',
      };
    }

    // Sort by createdAt ascending (FIFO: oldest queued tickets get assigned first)
    // PERF: compute each sort key once instead of decoding both docs on every comparison.
    // Same key expression and stable sort => identical order. Guarded so keys are only
    // computed when the original comparator would have run.
    if (queued.length > 1) {
      const createdMsById = new Map<string, number>();
      for (const q of queued) {
        const data = q.data;
        createdMsById.set(q.id, data.createdAt?.toDate ? data.createdAt.toDate().getTime() : (new Date(data.createdAt || 0).getTime() || 0));
      }
      queued.sort((a, b) => createdMsById.get(a.id)! - createdMsById.get(b.id)!);
    }

    const totalQueued = queued.length;
    const assignments: QueuedTicketAssignment[] = [];
    const skippedTickets: Array<{ ticketId: string; ticketNumber?: number | string; subject?: string; reason: string }> = [];

    // PERF: holidays and taxonomy are independent reads that both previously ran before the
    // loop (and before any write); load them concurrently. Any failure still reaches the
    // same outer catch before any assignment is made.
    const [holidaysSnap, taxonomy] = await Promise.all([
      db.collection('official_holidays').where('isActive', '==', true).get(),
      loadTaxonomy(db),
    ]);
    const activeHolidays = holidaysSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

    // Cache departments and available agents
  const deptCache = new Map<string, {
  deptRef: FirebaseFirestore.DocumentReference;
  name: string;
  workingHours?: any;
  lastAssignedUserId?: string;
  lastAssignedUserIndex?: number;
   availableAgents: Array<ScopeAgent & { id: string; name: string; email?: string; avatarUrl?: string; status: string; activeSessionId?: string }>;
}>();

    async function getDeptInfo(deptId: string) {
      if (deptCache.has(deptId)) return deptCache.get(deptId)!;

      const deptRef = db!.collection('departments').doc(deptId);
      const deptDoc = await deptRef.get();
      const deptData = deptDoc.exists ? deptDoc.data() : null;
      const deptName = deptData?.name || 'General';

      // Get employees in this department
      const usersSnap = await db!.collection('users')
        .where('departmentId', '==', deptId)
        .where('role', '==', 'Employee')
        .get();

      // Filter for available & logged-in agents
      const availableAgents = usersSnap.docs
        .map(doc => {
          const data = doc.data() as UserProfile;
          return {
            id: doc.id,
            name: data.name,
            email: data.email,
            avatarUrl: data.avatarUrl,
            status: data.status || 'Offline',
            campusIds: data.campusIds || [],
            campusId: (data as any).campusId,
            schoolIds: data.schoolIds || [],
            schoolNames: (data as any).schoolNames,
            schools: (data as any).schools,
            schoolName: (data as any).schoolName,
            divisionIds: data.divisionIds || [],
            divisionNames: (data as any).divisionNames,
            divisions: (data as any).divisions,
            divisionName: (data as any).divisionName,
            gradeIds: data.gradeIds || [],
            gradeNames: (data as any).gradeNames,
            grades: (data as any).grades,
            gradeName: (data as any).gradeName,
            mailboxEmails: (data as any).mailboxEmails || [],
            activeSessionId: data.activeSessionId,
          };
        })
        .filter(emp => emp.status === 'Available' && !!emp.activeSessionId)
        .sort((a, b) => a.id.localeCompare(b.id));

      const entry = {
        deptRef,
        name: deptName,
        workingHours: deptData?.workingHours,
        lastAssignedUserId: deptData?.lastAssignedUserId,
        lastAssignedUserIndex: deptData?.lastAssignedUserIndex ?? -1,
        availableAgents,
      };
      deptCache.set(deptId, entry);
      return entry;
    }

    // Load the large scope fields (grades, allowedGrades, routingOptions) only where the
    // decision needs them: the ticket is not on hold, its category is inside working hours
    // with someone available, and at least one of those agents passes the category /
    // mailbox / campus checks. Tickets already loaded at their current version come from
    // queueDetailCache (a ticket's version changes on every write to it, so a cached copy
    // is never stale).
    if (!options?.ticketId) {
      const liveIds = new Set(queued.map(q => q.id));
      for (const [id, entry] of queueDetailCache) {
        if (!liveIds.has(id) && (!options?.departmentId || entry.departmentId === options.departmentId)) {
          queueDetailCache.delete(id);
        }
      }

      const passStartedAt = new Date();
      const toLoad: QueuedTicket[] = [];
      for (const q of queued) {
        const deptId = q.data.departmentId;
        if (!deptId || q.data.pendingLocalTransferRequestId || q.data.pendingTransferRequestId) continue;
        const deptInfo = await getDeptInfo(deptId);
        if (deptInfo.availableAgents.length === 0) continue;
        if (!isWithinWorkingHours(deptInfo.workingHours, passStartedAt, activeHolidays)) continue;

        const cached = queueDetailCache.get(q.id);
        if (cached && cached.version === q.version &&
            (!fromSummaries || Date.now() - cached.loadedAt < SUMMARY_DETAIL_MAX_AGE_MS)) {
          Object.assign(q.data, cached.detail);
          q.hasDetail = true;
          continue;
        }
        if (deptInfo.availableAgents.some(emp => coarseScopeDecision(emp, q.data as ScopeTicket, taxonomy) === null)) {
          toLoad.push(q);
        }
      }

      const detailMask = [...QUEUE_LIGHT_FIELDS, ...QUEUE_DETAIL_FIELDS, 'status'];
      const chunks: QueuedTicket[][] = [];
      for (let i = 0; i < toLoad.length; i += QUEUE_DETAIL_CHUNK) chunks.push(toLoad.slice(i, i + QUEUE_DETAIL_CHUNK));
      for (let i = 0; i < chunks.length; i += QUEUE_DETAIL_PARALLEL) {
        await Promise.all(chunks.slice(i, i + QUEUE_DETAIL_PARALLEL).map(async chunk => {
          const snaps = await db.getAll(
            ...chunk.map(q => db.collection('tickets').doc(q.id)),
            { fieldMask: detailMask }
          );
          snaps.forEach((snap, index) => {
            const q = chunk[index];
            const data = snap.data();
            // Left the Queue (or this category) since the scan: leave it for the next pass.
            if (!data || data.status !== 'Queue' ||
                (options?.departmentId && data.departmentId !== options.departmentId)) {
              q.gone = true;
              return;
            }
            const detail: Record<string, unknown> = {};
            for (const field of QUEUE_DETAIL_FIELDS) {
              if (data[field] === undefined) continue;
              detail[field] = internDetailValue(data[field]);
              data[field] = detail[field];
            }
            q.data = data;
            // Direct scan: the ticket's own update time (the next scan reports the same value
            // while the ticket is unchanged). Summary scan: keep the summary's version.
            if (!fromSummaries) q.version = snapshotVersion(snap);
            q.hasDetail = true;
            queueDetailCache.set(q.id, { version: q.version, departmentId: String(data.departmentId || ''), detail, loadedAt: Date.now() });
          });
        }));
      }
    }

    // Process queued tickets in FIFO sequence
    for (const q of queued) {
      const ticket = q.data as Ticket;
      const ticketId = q.id;

      if (q.gone) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: 'Ticket changed while assigning; will retry on the next Queue pass',
        });
        continue;
      }

      // Never auto-assign a ticket awaiting manager approval.
      if (
        (ticket as Ticket & { pendingLocalTransferRequestId?: string | null }).pendingLocalTransferRequestId ||
        (ticket as Ticket & { pendingTransferRequestId?: string | null }).pendingTransferRequestId
      ) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: 'Pending manager transfer approval',
        });
        continue;
      }
      const deptId = ticket.departmentId;

      if (!deptId) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: 'Ticket has no category/department specified',
        });
        continue;
      }

      const deptInfo = await getDeptInfo(deptId);

      if (!deptInfo) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: 'Department not found',
        });
        continue;
      }

      // ✅ Don't assign queued tickets outside department working hours or on official holidays
      const isNowWorking = isWithinWorkingHours(deptInfo.workingHours, new Date(), activeHolidays);

      if (!isNowWorking) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: `Outside working hours for category "${deptInfo.name}"`,
        });
        continue;
      }

      if (deptInfo.availableAgents.length === 0) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: `No available, logged-in agents in category "${deptInfo.name}"`,
        });
        continue;
      }

      // Filter agents covering the ticket's campus, school, division, and grade
      // Same result as agentCoversTicket, split so a ticket whose large scope fields were not
      // loaded is never judged on incomplete data.
      let detailMissing = false;
      const eligibleAgents = deptInfo.availableAgents.filter(emp => {
        const coarse = coarseScopeDecision(emp, ticket as ScopeTicket, taxonomy);
        if (coarse !== null) return coarse;
        if (!q.hasDetail) { detailMissing = true; return false; }
        return detailedScopeMatch(emp, ticket as ScopeTicket, taxonomy);
      });

      if (detailMissing) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: 'Scope detail not loaded in this pass; will retry on the next Queue pass',
        });
        continue;
      }

      if (eligibleAgents.length === 0) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: `No available, logged-in agent covers the ticket's campus/school/division/grade scope`,
        });
        continue;
      }

      // Round-robin selection among eligible agents
      let nextIndex = 0;
      if (deptInfo.lastAssignedUserId) {
        const prevIndex = eligibleAgents.findIndex(a => a.id === deptInfo.lastAssignedUserId);
        if (prevIndex !== -1) {
          nextIndex = (prevIndex + 1) % eligibleAgents.length;
        } else {
          nextIndex = (((deptInfo.lastAssignedUserIndex ?? -1) + 1) % eligibleAgents.length + eligibleAgents.length) % eligibleAgents.length;
        }
      } else {
        nextIndex = (((deptInfo.lastAssignedUserIndex ?? -1) + 1) % eligibleAgents.length + eligibleAgents.length) % eligibleAgents.length;
      }

      const chosenAgent = eligibleAgents[nextIndex];

      // Atomically recheck ticket and agent, then assign AND advance the pointer.
      // This prevents an old Queue snapshot or a newly Busy/Offline employee
      // from being assigned when multiple auto-assignment requests run together.
      const ticketRef = db.collection('tickets').doc(ticketId);
      const agentRef = db.collection('users').doc(chosenAgent.id);
      const assigned = await db.runTransaction(async tx => {
        const latest = await tx.get(ticketRef);
        const latestAgent = await tx.get(agentRef);
        const latestDepartment = await tx.get(deptInfo.deptRef);
        if (
          !latest.exists ||
          latest.data()?.status !== 'Queue' ||
          latest.data()?.assignedTo?.userId ||
          latest.data()?.pendingLocalTransferRequestId ||
          latest.data()?.pendingTransferRequestId
        ) return false;
        const agentData = latestAgent.data();
        if (!agentData || agentData.role !== 'Employee' || agentData.departmentId !== deptId ||
            agentData.status !== 'Available' || !agentData.activeSessionId) return false;
        if (!agentCoversTicket(agentData as ScopeAgent, latest.data() as ScopeTicket, taxonomy)) return false;
        if (!latestDepartment.exists) return false;
        if (!isWithinWorkingHours(latestDepartment.data()?.workingHours, new Date(), activeHolidays)) return false;

        tx.update(ticketRef, {
          status: 'Open',
          assignedTo: {
            userId: chosenAgent.id,
            name: chosenAgent.name,
            email: chosenAgent.email || '',
            avatarUrl: chosenAgent.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${chosenAgent.name.replace(/\s/g, '+')}`,
          },
          assignedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.update(deptInfo.deptRef, {
          lastAssignedUserId: chosenAgent.id,
          lastAssignedUserIndex: nextIndex,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return true;
      });
      if (!assigned) {
        // The real ticket / agent did not match what this pass believed. With the summary
        // scan, drop the remembered large fields so the next pass reads them afresh.
        if (fromSummaries) queueDetailCache.delete(ticketId);
        skippedTickets.push({ ticketId, ticketNumber: ticket.ticketNumber, subject: ticket.subject,
          reason: 'Ticket or employee changed while assigning; will retry on the next Queue pass' });
        continue;
      }
      deptInfo.lastAssignedUserId = chosenAgent.id;
      deptInfo.lastAssignedUserIndex = nextIndex;

      assignments.push({
        ticketId,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        assigneeId: chosenAgent.id,
        assigneeName: chosenAgent.name,
        departmentId: deptId,
        departmentName: deptInfo.name,
        campusId: ticket.campusId || null,
        campusName: ticket.campusName || null,
      });

      await logSystemEvent({
        eventType: 'TICKET_AUTO_ASSIGNED',
        actor: { userId: 'system', name: 'Auto-Assign System' },
        message: `Ticket #${ticket.ticketNumber || ticketId.substring(0, 6)} automatically assigned to ${chosenAgent.name} based on matching scope.`,
        details: {
          ticketId,
          ticketNumber: ticket.ticketNumber,
          assigneeId: chosenAgent.id,
          assigneeName: chosenAgent.name,
          departmentId: deptId,
          campusId: ticket.campusId,
          schoolId: ticket.schoolId,
          divisionId: ticket.divisionId,
          gradeId: ticket.gradeId,
        },
      });

      // Create internal notification for assigned agent
      await db.collection('ticket-events').add({
        ticketId,
        eventType: 'ASSIGNED',
        title: 'New Ticket Assigned',
        message: `Ticket #${ticket.ticketNumber || ticketId.substring(0, 6)} assigned to you based on department, campus, school, division and grade scope.`,
        recipient: chosenAgent.id,
        read: false,
        timestamp: FieldValue.serverTimestamp(),
      });
    }

    revalidatePath('/tickets');
    revalidatePath('/dashboard');

    return {
      success: true,
      assignedCount: assignments.length,
      totalQueued,
      assignments,
      // No caller reads the skipped list; returning thousands of rows to the browser on
      // every pass only costs time, so it is capped.
      skippedTickets: skippedTickets.slice(0, MAX_SKIPPED_RETURNED),
      message: `Successfully auto-assigned ${assignments.length} of ${totalQueued} queued tickets.`,
    };
  } catch (error: any) {
    console.error('Error auto-assigning queued tickets:', error);
    return {
      success: false,
      assignedCount: 0,
      totalQueued: 0,
      assignments: [],
      skippedTickets: [],
      message: error?.message || 'Database error during auto-assignment.',
    };
  }
}