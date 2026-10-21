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
 * Strict scope eligibility: category/department is filtered by the caller,
 * then campus, division, and grade MUST all match by Firestore ID.
 * Missing/unconfigured values are not wildcards.
 * If a school is explicitly scoped on the ticket and the agent, preserve
 * the existing school restriction as an additional safeguard.
 */
function agentCoversTicket(agent: {
    campusIds?: string[];
    schoolIds?: string[];
    divisionIds?: string[];
    gradeIds?: string[];
}, ticket: {
    campusId?: string | null;
    schoolId?: string | null;
    divisionId?: string | null;
    gradeId?: string | null;
}): boolean {
    const matchesRequiredScope = (
        ticketId: string | null | undefined,
        agentIds: string[] | undefined
    ): boolean => {
        if (!ticketId || ticketId === 'all' || ticketId === 'N/A') return false;
        return Array.isArray(agentIds) && agentIds.includes(ticketId);
    };

    // AND: Campus AND Division AND Grade (Department is checked by query).
    if (!matchesRequiredScope(ticket.campusId, agent.campusIds)) return false;
    if (!matchesRequiredScope(ticket.divisionId, agent.divisionIds)) return false;
    if (!matchesRequiredScope(ticket.gradeId, agent.gradeIds)) return false;

    // Maintain any explicit school restriction from the existing implementation.
    if (ticket.schoolId && ticket.schoolId !== 'all' && ticket.schoolId !== 'N/A') {
        if (agent.schoolIds?.length && !agent.schoolIds.includes(ticket.schoolId)) return false;
    }

    return true;
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
    let ticketContext: {
        campusId?: string | null;
        schoolId?: string | null;
        divisionId?: string | null;
        gradeId?: string | null;
    } = {};

    if (typeof departmentIdOrTicket === 'object' && departmentIdOrTicket !== null) {
        departmentId = departmentIdOrTicket.departmentId;
        ticketContext = {
            campusId: departmentIdOrTicket.campusId,
            schoolId: departmentIdOrTicket.schoolId,
            divisionId: departmentIdOrTicket.divisionId,
            gradeId: departmentIdOrTicket.gradeId,
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

            if (usersSnapshot.empty) {
                await logSystemEvent({
                    eventType: 'ASSIGNMENT_FAILED',
                    actor: { userId: 'system', name: 'Auto-Assign System' },
                    message: `No active employees found in department ${departmentId}.`,
                    details: { departmentId, reason: 'no_employees_in_dept' }
                });
                return;
            }

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
                        schoolIds: data.schoolIds || [],
                        divisionIds: data.divisionIds || [],
                        gradeIds: data.gradeIds || [],
                        activeSessionId: data.activeSessionId,
                    };
                })
                .filter(emp => emp.status === 'Available' && !!emp.activeSessionId)
                .filter(emp => agentCoversTicket(emp, ticketContext))
                .sort((a, b) => a.id.localeCompare(b.id));

            if (availableEmployees.length === 0) {
                await logSystemEvent({
                    eventType: 'ASSIGNMENT_FAILED',
                    actor: { userId: 'system', name: 'Auto-Assign System' },
                    message: `No available, logged-in staff in category ${departmentId} covering ticket scope.`,
                    details: { departmentId, ticketContext, reason: 'no_staff_covering_scope' }
                });
                return;
            }

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
  availableAgents: Array<{
    id: string;
    name: string;
    email?: string;
    avatarUrl?: string;
    status: string;
    campusIds: string[];
    schoolIds: string[];
    divisionIds: string[];
    gradeIds: string[];
    activeSessionId?: string;
  }>;
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
            schoolIds: data.schoolIds || [],
            divisionIds: data.divisionIds || [],
            gradeIds: data.gradeIds || [],
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
      const eligibleAgents = deptInfo.availableAgents.filter(emp => agentCoversTicket(emp, ticket));

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

      // Advance department round-robin pointer in cache
      deptInfo.lastAssignedUserId = chosenAgent.id;
      deptInfo.lastAssignedUserIndex = nextIndex;

      // Update ticket: Move from 'Queue' to 'Open' and set assignedTo
      const ticketRef = db.collection('tickets').doc(ticketId);
      await ticketRef.update({
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

      // Update department pointer in Firestore DB as well
      await deptInfo.deptRef.update({
        lastAssignedUserId: chosenAgent.id,
        lastAssignedUserIndex: nextIndex,
        updatedAt: FieldValue.serverTimestamp(),
      });

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