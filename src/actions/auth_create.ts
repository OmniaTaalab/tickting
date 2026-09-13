'use server';

import { z } from 'zod';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

const CreateAuthUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("A valid email is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(['Admin', 'Employee', 'Manager']),
  departmentId: z.string().optional(),
  divisionIds: z.array(z.string()).optional(),
  campusIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
  actorId: z.string().min(1, "Actor ID is missing"),
  actorName: z.string().min(1, "Actor Name is missing"),
}).superRefine((data, ctx) => {
  if ((data.role === 'Employee' || data.role === 'Manager') && (!data.departmentId || data.departmentId === 'none' || data.departmentId === '')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Category is required for Employees and Managers",
      path: ["departmentId"],
    });
  }
});

export type CreateAuthUserState = {
  errors?: {
    name?: string[];
    email?: string[];
    password?: string[];
    role?: string[];
    departmentId?: string[];
    divisionIds?: string[];
    campusIds?: string[];
    form?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createAuthUserForUserAction(
  prevState: CreateAuthUserState,
  formData: FormData
): Promise<CreateAuthUserState> {
  
  const auth = adminAuth;
  const db = adminDb;

  if (!auth || !db) {
    return {
        errors: { form: ["Firebase Admin SDK is not configured."] },
        message: 'Server configuration error.',
        success: false,
    };
  }
  
  const userId = formData.get('userId') as string | null;
  const isCreatingLoginForExistingUser = !!userId;

  const validatedFields = CreateAuthUserSchema.safeParse({
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
    role: formData.get('role'),
    departmentId: formData.get('departmentId') || undefined,
    divisionIds: formData.getAll('divisionIds'),
    campusIds: formData.getAll('campusIds'),
    userId: userId || undefined,
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Validation failed. Please check the required fields.',
      success: false,
    };
  }

  const { email, password, actorId, actorName, role, departmentId, divisionIds, campusIds } = validatedFields.data;
  let name: string;
  
  if (isCreatingLoginForExistingUser && userId) {
      try {
          const userDoc = await db.collection('users').doc(userId).get();
          if (!userDoc.exists) {
              return { errors: { form: ['User profile not found.'] }, message: 'Error', success: false };
          }
          name = userDoc.data()!.name;
      } catch (e) {
          return { errors: { form: ['Failed to retrieve user profile.'] }, message: 'Error', success: false };
      }
  } else {
      name = validatedFields.data.name;
  }

  let userRecord;
  try {
    userRecord = await auth.createUser({
      email: email,
      emailVerified: true, 
      password: password,
      displayName: name,
      disabled: false,
    });
  } catch (error: any) {
    console.error('Error creating Firebase Auth user:', error);
    let errorMessage = 'An unexpected error occurred during user creation.';
    if (error.code === 'auth/email-already-exists') {
      errorMessage = `The email address "${email}" is already in use.`;
    }
    return {
      errors: { form: [errorMessage] },
      message: 'Failed to create user login.',
      success: false,
    };
  }
  
  try {
    const userDocRef = db.collection("users").doc(userRecord.uid);

    if (isCreatingLoginForExistingUser && userId) {
        const existingRef = db.collection("users").doc(userId);
        await existingRef.update({
            authId: userRecord.uid,
            status: 'Busy', // ALWAYS START AS BUSY
            updatedAt: FieldValue.serverTimestamp(),
        });
    } else {
        const newUserProfile: any = {
            id: userRecord.uid,
            authId: userRecord.uid,
            name,
            email,
            role,
            status: 'Busy', // ALWAYS START AS BUSY
            avatarUrl: `https://api.dicebear.com/9.x/initials/svg?seed=${name.replace(/\s/g, '+')}&backgroundColor=1e40af`,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        if (departmentId && (role === 'Employee' || role === 'Manager')) {
            newUserProfile.departmentId = departmentId;
        }
        if (divisionIds && divisionIds.length > 0 && (role === 'Employee' || role === 'Manager')) {
            newUserProfile.divisionIds = divisionIds;
        }
        if (campusIds && campusIds.length > 0 && (role === 'Employee' || role === 'Manager')) {
            newUserProfile.campusIds = campusIds;
        }

        await userDocRef.set(newUserProfile);
    }

    await logSystemEvent({
      eventType: isCreatingLoginForExistingUser ? 'USER_LOGIN_CREATED' : 'USER_CREATED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} created ${isCreatingLoginForExistingUser ? 'login' : 'account'} for ${name} (${email}). Status set to Busy by default.`,
      details: { targetUserId: userRecord.uid, role }
    });
    
    revalidatePath('/users');
    revalidatePath('/settings');
    return { success: true, message: `Successfully created user ${name}. Status set to Busy by default.` };

  } catch (error: any) {
    console.error('Error saving user profile:', error);
    await auth.deleteUser(userRecord.uid).catch(() => {});
    return {
      errors: { form: ['Failed to save user profile. Operation rolled back.'] },
      message: 'Database error.',
      success: false,
    };
  }
}