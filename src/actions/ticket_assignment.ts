

'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import type { UserProfile, Ticket } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
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
type ScopeRecord = Record<string, unknown>;
type ScopeTicket = {
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
  routingOptions?: Array<{ school?: string; division?: string; grades?: string[] }>;
  mailboxEmail?: string | null;
};
type ScopeAgent = {
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
type Taxonomy = { schools: Map<string, string[]>; divisions: Map<string, string[]>; grades: Map<string, string[]> };

const normalizeScope = (v: unknown): string => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/grade\s*(\d+)/g, 'grade$1').replace(/kg\s*(\d+)/g, 'kg$1')
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
  const [schools, divisions, grades] = await Promise.all([
    build('schools'), build('divisions'), build('grades')
  ]);
  return { schools, divisions, grades };
}

/**
 * Central scope guard shared by immediate and queued auto-assignment.
 * Missing or contradictory ticket attributes must NEVER widen access.
 */
function agentCoversTicket(agent: ScopeAgent, ticket: ScopeTicket, taxonomy: Taxonomy): boolean {
  const agentCampuses = textValues(agent.campusIds, agent.campusId);
  if (!ticket.campusId || !agentCampuses.includes(ticket.campusId)) return false;

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
  if (data.role !== 'Employee' || data.departmentId !== ticket.departmentId) return false;
  const taxonomy = await loadTaxonomy(db);
  return agentCoversTicket(data as ScopeAgent, ticket, taxonomy);
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
            campusId: departmentIdOrTicket.campusId,
            schoolId: departmentIdOrTicket.schoolId,
            divisionId: departmentIdOrTicket.divisionId,
            gradeId: departmentIdOrTicket.gradeId,
            schoolName: departmentIdOrTicket.schoolName,
            divisionName: departmentIdOrTicket.divisionName,
            gradeName: departmentIdOrTicket.gradeName,
            grades: departmentIdOrTicket.grades,
            mailboxEmail: departmentIdOrTicket.mailboxEmail,
            routingOptions: departmentIdOrTicket.routingOptions,
        };
    } else {
        departmentId = departmentIdOrTicket;
        ticketContext = { campusId, schoolId, divisionId, gradeId };
    }

    const deptRef = db.collection('departments').doc(departmentId);
    let assignee: AssigneeProfile | null = null;

    try {
        const holidaysSnap = await db.collection('official_holidays').where('isActive', '==', true).get();
        const activeHolidays = holidaysSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

        const taxonomy = await loadTaxonomy(db);

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

/**
 * Automatically assigns queued tickets (status === 'Queue') to available, logged-in agents
 * using fair round-robin distribution per department and campus/school/division/grade coverage.
 */
export async function autoAssignQueuedTickets(options?: {
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
    let queryRef = db.collection('tickets').where('status', '==', 'Queue');
    if (options?.departmentId) {
      queryRef = queryRef.where('departmentId', '==', options.departmentId);
    }

    const queuedSnap = await queryRef.get();
    let queuedDocs = queuedSnap.docs;

    if (options?.ticketId) {
      queuedDocs = queuedDocs.filter(d => d.id === options.ticketId);
    }

    if (queuedDocs.length === 0) {
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
    queuedDocs.sort((a, b) => {
      const dataA = a.data();
      const dataB = b.data();
      const timeA = dataA.createdAt?.toDate ? dataA.createdAt.toDate().getTime() : (new Date(dataA.createdAt || 0).getTime() || 0);
      const timeB = dataB.createdAt?.toDate ? dataB.createdAt.toDate().getTime() : (new Date(dataB.createdAt || 0).getTime() || 0);
      return timeA - timeB;
    });

    const totalQueued = queuedDocs.length;
    const assignments: QueuedTicketAssignment[] = [];
    const skippedTickets: Array<{ ticketId: string; ticketNumber?: number | string; subject?: string; reason: string }> = [];

    const holidaysSnap = await db.collection('official_holidays').where('isActive', '==', true).get();
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

    const taxonomy = await loadTaxonomy(db);

    // Process queued tickets in FIFO sequence
    for (const ticketDoc of queuedDocs) {
      const ticket = ticketDoc.data() as Ticket;
      const ticketId = ticketDoc.id;
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
      const eligibleAgents = deptInfo.availableAgents.filter(emp => agentCoversTicket(emp, ticket as ScopeTicket, taxonomy));

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
        if (!latest.exists || latest.data()?.status !== 'Queue' || latest.data()?.assignedTo?.userId) return false;
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
      skippedTickets,
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