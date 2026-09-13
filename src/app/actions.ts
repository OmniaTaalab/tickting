'use server';

import { assignTicketToDepartment } from '@/ai/flows/assign-ticket-to-department';
import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import type { Department, UserProfile } from '@/lib/types';


const AssignDepartmentInputSchema = z.object({
  subject: z.string(),
  body: z.string(),
});

type AssignDepartmentInput = z.infer<typeof AssignDepartmentInputSchema>;

export async function getAssignedDepartment(input: AssignDepartmentInput): Promise<{ departmentName: string; departmentId: string, reason: string }> {
  const validatedInput = AssignDepartmentInputSchema.parse(input);
  
  // 1. Get AI-suggested department
  const assignment = await assignTicketToDepartment({
    subject: validatedInput.subject,
    body: validatedInput.body,
  });
  
  if (!adminDb) {
    throw new Error("Firestore Admin not initialized.");
  }

  const snapshot = await adminDb.collection("departments").get();
  const departments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as { name: string }),
    }));


  const assignedDepartment = departments.find(d => d.name === assignment.department);

  if (!assignedDepartment) {
    // Fallback to a default department if AI gives a weird response
    const defaultDept = departments.find(d => d.id === 'it')!;
    return { departmentName: defaultDept.name, departmentId: defaultDept.id, reason: `AI assignment failed, fell back to default. AI reason: ${assignment.reason}` };
  }
  
  return { departmentName: assignedDepartment.name, departmentId: assignedDepartment.id, reason: assignment.reason };
}

export async function getDepartments(): Promise<Department[]> {
  if (!adminDb) {
    console.error("❌ Firestore Admin not initialized.");
    return [];
  }

  try {
    const snapshot = await adminDb.collection("departments").get();

    const departments = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as { name: string }),
    }));

    return departments;
  } catch (error) {
    console.error("🔥 Error fetching departments:", error);
    return [];
  }
}

export async function findDepartmentAdmin(departmentId: string): Promise<UserProfile | null> {
    if (!adminDb) {
        console.error("❌ Firestore Admin not initialized.");
        return null;
    }

    try {
        const snapshot = await adminDb.collection('users')
            .where('departmentId', '==', departmentId)
            .where('role', '==', 'Admin')
            .limit(1)
            .get();
        
        if (snapshot.empty) {
            console.warn(`No admin found for department ${departmentId}`);
            return null;
        }

        const adminDoc = snapshot.docs[0];
        return {
            id: adminDoc.id,
            ...adminDoc.data()
        } as UserProfile;

    } catch (error) {
        console.error(`🔥 Error finding admin for department ${departmentId}:`, error);
        return null;
    }
}
