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
  schoolIds: z.array(z.string()).optional(),
  gradeIds: z.array(z.string()).optional(),
  userId: z.string().optional(),
  actorId: z.string().optional(),
  actorName: z.string().optional(),
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
    schoolIds?: string[];
    gradeIds?: string[];
    form?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createAuthUserForUserAction(
  prevState: CreateAuthUserState,
  formData: FormData
): Promise<CreateAuthUserState> {
  try {
    const auth = adminAuth;
    const db = adminDb;
if (!auth || !db) {
  return {
    errors: {
      form: [
        `Firebase Admin SDK is not configured.

Check Google AI Studio environment variables:
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY`
      ]
    },
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
      schoolIds: formData.getAll('schoolIds'),
      gradeIds: formData.getAll('gradeIds'),
      userId: userId || undefined,
      actorId: formData.get('actorId') || undefined,
      actorName: formData.get('actorName') || undefined,
    });

    if (!validatedFields.success) {
      return {
        errors: validatedFields.error.flatten().fieldErrors,
        message: 'Validation failed. Please check the required fields.',
        success: false,
      };
    }

    const { email, password, role, departmentId, divisionIds, campusIds, schoolIds, gradeIds } = validatedFields.data;
    const actorId = validatedFields.data.actorId || 'system';
    const actorName = validatedFields.data.actorName || 'Admin';
    let name: string;
    
    if (isCreatingLoginForExistingUser && userId) {
        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (!userDoc.exists) {
                return { errors: { form: ['User profile not found.'] }, message: 'Error', success: false };
            }
            name = userDoc.data()!.name;
        } catch (e: any) {
            return { errors: { form: ['Failed to retrieve user profile: ' + (e?.message || '')] }, message: 'Error', success: false };
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
      let errorMessage = error?.message || 'An unexpected error occurred during user creation.';
      if (error.code === 'auth/email-already-exists') {
        errorMessage = `The email address "${email}" is already in use.`;
    } else if (
  errorMessage.includes('identitytoolkit.googleapis.com') ||
  errorMessage.includes('Identity Toolkit API') ||
  error?.code === 7 ||
  error?.code === 403
) {
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    'your Firebase project';

  errorMessage =
    `Firebase Authentication error for project "${projectId}". ` +
    `Please verify that Identity Toolkit API is enabled for the correct Firebase project. ` +
    `Original error: ${error?.message || 'Unknown authentication error'}`;
}
      return {
        errors: { form: [errorMessage] },
        message: errorMessage,
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
          if (schoolIds && schoolIds.length > 0 && (role === 'Employee' || role === 'Manager')) {
              newUserProfile.schoolIds = schoolIds;
          }
          if (gradeIds && gradeIds.length > 0 && (role === 'Employee' || role === 'Manager')) {
              newUserProfile.gradeIds = gradeIds;
          }

          await userDocRef.set(newUserProfile);
      }

      await logSystemEvent({
        eventType: isCreatingLoginForExistingUser ? 'USER_LOGIN_CREATED' : 'USER_CREATED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} created ${isCreatingLoginForExistingUser ? 'login' : 'account'} for ${name} (${email}). Status set to Busy by default.`,
        details: { targetUserId: userRecord.uid, role }
      }).catch(err => console.warn('Logging system event failed:', err));
      
      try {
        revalidatePath('/users');
        revalidatePath('/settings');
      } catch (err) {
        // revalidatePath might throw if not inside request context
      }

      return { success: true, message: `Successfully created user ${name}. Status set to Busy by default.` };

    } catch (error: any) {
      console.error('Error saving user profile:', error);
      await auth.deleteUser(userRecord.uid).catch(() => {});
      return {
        errors: { form: ['Failed to save user profile: ' + (error?.message || 'Unknown database error')] },
        message: error?.message || 'Database error.',
        success: false,
      };
    }
  } catch (fatalError: any) {
    console.error('Fatal unhandled error in createAuthUserForUserAction:', fatalError);
    return {
      errors: { form: [fatalError?.message || 'An unexpected server error occurred.'] },
      message: fatalError?.message || 'Unexpected server error.',
      success: false,
    };
  }
}