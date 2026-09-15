'use server';

import { z } from 'zod';
import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';
import { FieldValue } from 'firebase-admin/firestore';


const UpdateUserSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  name: z.string().min(1, "Name is required"),
  role: z.enum(['Admin', 'Employee', 'Manager']),
  departmentId: z.string().optional().nullable(), // Allow null for hidden fields
  divisionIds: z.array(z.string()).optional(),
  campusIds: z.array(z.string()).optional(),
  schoolIds: z.array(z.string()).optional(),
  gradeIds: z.array(z.string()).optional(),
  password: z.string().min(6, "Password must be at least 6 characters").optional().or(z.literal('')),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
}).superRefine((data, ctx) => {
    if ((data.role === 'Employee' || data.role === 'Manager') && (!data.departmentId || data.departmentId === 'none' || data.departmentId === '')) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Department is required for Employees and Managers",
            path: ["departmentId"],
        });
    }
});

export type UpdateUserState = {
  errors?: {
    name?: string[];
    role?: string[];
    departmentId?: string[];
    divisionIds?: string[];
    campusIds?: string[];
    schoolIds?: string[];
    gradeIds?: string[];
    form?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function updateUserAction(
  prevState: UpdateUserState,
  formData: FormData
): Promise<UpdateUserState> {
  
  if (!adminDb || !adminAuth) {
    return {
        errors: { form: ["Firebase Admin SDK is not configured."] },
        message: 'Server configuration error.',
        success: false,
    };
  }

  const validatedFields = UpdateUserSchema.safeParse({
    userId: formData.get('userId'),
    name: formData.get('name'),
    role: formData.get('role'),
    departmentId: formData.get('departmentId'),
    divisionIds: formData.getAll('divisionIds'),
    campusIds: formData.getAll('campusIds'),
    schoolIds: formData.getAll('schoolIds'),
    gradeIds: formData.getAll('gradeIds'),
    password: formData.get('password'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });


  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Validation failed. Please check the fields.',
      success: false,
    };
  }

  const { userId, name, role, departmentId, divisionIds, campusIds, schoolIds, gradeIds, password, actorId, actorName } = validatedFields.data;

  try {
    const actorRef = adminDb.collection('users').doc(actorId);
    const actorDoc = await actorRef.get();
    const actorData = actorDoc.data();

    if (!actorData) {
        return { success: false, message: 'Actor profile not found.' };
    }

    const targetUserRef = adminDb.collection('users').doc(userId);
    const targetDoc = await targetUserRef.get();
    const targetData = targetDoc.data();

    if (!targetData) {
        return { success: false, message: 'Target user not found.' };
    }

    // --- SECURITY CHECK FOR MANAGERS ---
    if (actorData.role !== 'Admin') {
        if (actorData.role === 'Manager') {
            const actorCampuses = actorData.campusIds || [];
            const targetCampuses = targetData.campusIds || [];
            // A Manager can only edit users who share at least one campus with them
            const hasCampusOverlap = targetCampuses.some((id: string) => actorCampuses.includes(id));
            
            if (!hasCampusOverlap && userId !== actorId) {
                return { 
                    success: false, 
                    message: 'Permission denied: You can only manage staff within your assigned campuses.' 
                };
            }
        } else {
            // Regular employees can't use this action to edit others
            if (userId !== actorId) {
                return { success: false, message: 'Permission denied.' };
            }
        }
    }

    const updates: Record<string, any> = {
        name,
        role,
        updatedAt: FieldValue.serverTimestamp(),
    };
    
    // Only admins can change roles for others
    if (actorData.role !== 'Admin' && role !== targetData.role) {
        delete updates.role; // Prevent role change if not admin
    }

    if (role === 'Admin') {
        updates.departmentId = FieldValue.delete();
        updates.divisionIds = FieldValue.delete();
        updates.campusIds = FieldValue.delete();
        updates.schoolIds = FieldValue.delete();
        updates.schoolId = FieldValue.delete();
        updates.gradeIds = FieldValue.delete();
    } else {
        if (departmentId && departmentId !== 'none') {
            updates.departmentId = departmentId;
        } else {
            updates.departmentId = FieldValue.delete();
        }

        updates.divisionIds = divisionIds || [];
        updates.campusIds = campusIds || [];
        updates.schoolIds = schoolIds || [];
        updates.schoolId = (schoolIds && schoolIds.length > 0) ? schoolIds[0] : FieldValue.delete();
        updates.gradeIds = gradeIds || [];
    }
    
    // 1. Update Firestore
    await targetUserRef.update(updates);

    // 2. Update Firebase Auth (Password & Display Name)
    const authUpdatePayload: any = {
        displayName: name
    };

    if (password && password.length >= 6) {
        authUpdatePayload.password = password;
    }

    try {
        await adminAuth.updateUser(userId, authUpdatePayload);
    } catch (authError) {
        console.warn(`Could not update Auth for ${userId}:`, authError);
    }
    
    await logSystemEvent({
      eventType: 'USER_UPDATED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} updated the profile ${password ? 'and password ' : ''}for user ${name}.`,
      details: {
        targetUserId: userId,
        updatedFields: { name, role, departmentId, divisionIds, campusIds, schoolIds, gradeIds, passwordUpdated: !!password }
      }
    });

    revalidatePath('/users');
    revalidatePath('/settings');
    revalidatePath(`/users/${userId}`);
    
    return {
      success: true,
      message: `Successfully updated user ${name}.${password ? ' Password changed.' : ''}`,
    };

  } catch (error: any) {
    console.error('Error updating user document:', error);    
    return {
      errors: { form: [error.message || 'Failed to update user profile.'] },
      message: 'Failed to update user profile.',
      success: false,
    };
  }
}
