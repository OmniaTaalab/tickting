'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import type { UserProfile } from '@/lib/types';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';

type AssigneeProfile = Pick<UserProfile, 'id' | 'name' | 'avatarUrl' | 'email'>;

/**
 * Returns the next available staff member (Only Employees) in a department 
 * who is also assigned to the specific campus of the ticket.
 * STRICT: Returns null if no staff is available in that campus.
 */
export async function getRoundRobinAssignee(departmentId: string, campusId?: string | null): Promise<AssigneeProfile | null> {
    const db = adminDb;
    if (!db) {
        console.error('getRoundRobinAssignee: Firestore Admin not initialized.');
        throw new Error("Server configuration error.");
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

            // Filter staff by status AND matching campus
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
                    };
                })
                .filter(emp => emp.status !== 'Busy')
                .filter(emp => {
                    if (!campusId) return true; // Fallback for tickets without campus
                    return emp.campusIds.includes(campusId);
                })
                .sort((a, b) => a.id.localeCompare(b.id));

            if (availableEmployees.length === 0) {
                await logSystemEvent({
                    eventType: 'ASSIGNMENT_FAILED',
                    actor: { userId: 'system', name: 'Auto-Assign System' },
                    message: `No available staff in category ${departmentId} covers campus ${campusId || 'N/A'}.`,
                    details: { departmentId, campusId, reason: 'no_staff_covering_campus' }
                });
                return;
            }

            const department = deptDoc.data() as any;
            let lastIndex = department.lastAssignedUserIndex ?? -1;

            // Find next candidate from the filtered available list
            let nextIndex = (lastIndex + 1) % availableEmployees.length;
            const candidate = availableEmployees[nextIndex];

            assignee = {
                id: candidate.id,
                name: candidate.name,
                email: candidate.email,
                avatarUrl: candidate.avatarUrl,
            };

            // Update the department's last assigned index
            transaction.update(deptRef, {
                lastAssignedUserIndex: nextIndex,
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        return assignee;
    } catch (error) {
        console.error(`Round-robin assignment failed:`, error);
        return null;
    }
}
