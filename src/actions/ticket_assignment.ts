'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import type { UserProfile, Ticket } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

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
 * Returns the next available, logged-in staff member (Employees) in a department 
 * who is also assigned to the specific campus of the ticket.
 * Uses round-robin sequencing.
 */
export async function getRoundRobinAssignee(departmentId: string, campusId?: string | null): Promise<AssigneeProfile | null> {
    const db = adminDb;
    if (!db) {
        console.warn('getRoundRobinAssignee: Firestore Admin not initialized.');
        return null;
    }

    const deptRef = db.collection('departments').doc(departmentId);
    let assignee: AssigneeProfile | null = null;

    try {
        await db.runTransaction(async (transaction) => {
            const deptDoc = await transaction.get(deptRef);
            if (!deptDoc.exists) {
                throw new Error(`Department with ID ${departmentId} not found.`);
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

            // Filter staff by available & logged-in status AND matching campus
            const availableEmployees = usersSnapshot.docs
                .map((doc) => {
                    const data = doc.data() as UserProfile;
                    return {
                        id: doc.id,
                        name: data.name,
                        email: data.email,
                        avatarUrl: data.avatarUrl,
                        status: data.status || 'Available',
                        campusIds: data.campusIds || [],
                        activeSessionId: data.activeSessionId,
                    };
                })
                .filter(emp => emp.status !== 'Busy' && (emp.status === 'Available' || !!emp.activeSessionId))
                .filter(emp => {
                    if (!campusId || campusId === 'all' || campusId === 'N/A') return true;
                    return emp.campusIds.includes(campusId);
                })
                .sort((a, b) => a.id.localeCompare(b.id));

            if (availableEmployees.length === 0) {
                await logSystemEvent({
                    eventType: 'ASSIGNMENT_FAILED',
                    actor: { userId: 'system', name: 'Auto-Assign System' },
                    message: `No available, logged-in staff in category ${departmentId} covers campus ${campusId || 'N/A'}.`,
                    details: { departmentId, campusId, reason: 'no_staff_covering_campus' }
                });
                return;
            }

            const department = deptDoc.data() as any;
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
 * using fair round-robin distribution per department and campus coverage.
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

    // Cache departments and available agents
    const deptCache = new Map<string, {
      deptRef: FirebaseFirestore.DocumentReference;
      name: string;
      lastAssignedUserId?: string;
      lastAssignedUserIndex?: number;
      availableAgents: Array<{
        id: string;
        name: string;
        email?: string;
        avatarUrl?: string;
        status: string;
        campusIds: string[];
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
            status: data.status || 'Available',
            campusIds: data.campusIds || [],
            activeSessionId: data.activeSessionId,
          };
        })
        .filter(emp => emp.status !== 'Busy' && (emp.status === 'Available' || !!emp.activeSessionId))
        .sort((a, b) => a.id.localeCompare(b.id));

      const entry = {
        deptRef,
        name: deptName,
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
      if (!deptInfo || deptInfo.availableAgents.length === 0) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: `No available, logged-in agents in category "${deptInfo?.name || deptId}"`,
        });
        continue;
      }

      // Filter agents covering the ticket's campus (if specified)
      const campusId = ticket.campusId;
      const eligibleAgents = deptInfo.availableAgents.filter(emp => {
        if (!campusId || campusId === 'all' || campusId === 'N/A') return true;
        return emp.campusIds.includes(campusId);
      });

      if (eligibleAgents.length === 0) {
        skippedTickets.push({
          ticketId,
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          reason: `No available, logged-in agent covers campus "${ticket.campusName || campusId}"`,
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

      // Send ticket event / in-app notification to the assigned agent
      await db.collection('ticket-events').add({
        ticketId,
        eventType: 'TICKET_STATUS_CHANGED',
        title: 'Ticket Assigned from Queue',
        message: `Ticket #${ticket.ticketNumber || ticketId} ("${(ticket.subject || '').substring(0, 35)}...") was automatically assigned to you from Queue via round-robin distribution.`,
        recipient: chosenAgent.id,
        read: false,
        timestamp: FieldValue.serverTimestamp(),
      });

      // System audit log
      await logSystemEvent({
        eventType: 'TICKET_AUTO_ASSIGNED_FROM_QUEUE',
        actor: { userId: 'system', name: 'Auto-Assign System' },
        message: `Queued ticket #${ticket.ticketNumber || ticketId} auto-assigned to ${chosenAgent.name} via round-robin.`,
        details: {
          ticketId,
          ticketNumber: ticket.ticketNumber,
          assigneeId: chosenAgent.id,
          assigneeName: chosenAgent.name,
          departmentId: deptId,
          campusId: campusId || null,
        },
      });

      assignments.push({
        ticketId,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject || 'Ticket',
        assigneeId: chosenAgent.id,
        assigneeName: chosenAgent.name,
        departmentId: deptId,
        departmentName: deptInfo.name,
        campusId,
        campusName: ticket.campusName,
      });
    }

    // Persist updated department round-robin indices
    for (const [, deptInfo] of deptCache.entries()) {
      if (deptInfo.lastAssignedUserId) {
        await deptInfo.deptRef.update({
          lastAssignedUserId: deptInfo.lastAssignedUserId,
          lastAssignedUserIndex: deptInfo.lastAssignedUserIndex,
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
    }

    if (assignments.length > 0) {
      revalidatePath('/tickets');
      revalidatePath('/dashboard');
    }

    const assignedCount = assignments.length;
    const message = assignedCount > 0
      ? `Successfully auto-assigned ${assignedCount} queued ticket${assignedCount > 1 ? 's' : ''} to available, logged-in agents.`
      : `No queued tickets could be assigned (${skippedTickets.length} pending - no eligible agents available/logged-in).`;

    return {
      success: true,
      assignedCount,
      totalQueued,
      assignments,
      skippedTickets,
      message,
    };
  } catch (error: any) {
    console.error('Error auto-assigning queued tickets:', error);
    return {
      success: false,
      assignedCount: 0,
      totalQueued: 0,
      assignments: [],
      skippedTickets: [],
      message: error.message || 'Auto-assignment failed.',
    };
  }
}

/**
 * Server Action callable from client UI to trigger queue auto-assignment
 */
export async function assignQueuedTicketsAction(departmentId?: string): Promise<AutoAssignResult> {
  return autoAssignQueuedTickets({ departmentId: departmentId || undefined });
}

