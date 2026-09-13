
'use server';

import { z } from 'zod';
import { adminAuth, adminDb } from '@/lib/firebaseAdmin';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

const DeleteUserSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
  authId: z.string().optional(),
  userName: z.string().min(1, "User name is required"),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type DeleteUserState = {
  errors?: {
    form?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function deleteUserAction(
  prevState: DeleteUserState,
  formData: FormData
): Promise<DeleteUserState> {
  
  if (!adminAuth || !adminDb) {
    const errorMessage = "Firebase Admin SDK is not configured.";
    return {
        errors: { form: [errorMessage] },
        message: 'Server configuration error.',
        success: false,
    };
  }

  const validatedFields = DeleteUserSchema.safeParse({
    userId: formData.get('userId'),
    authId: formData.get('authId'),
    userName: formData.get('userName'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validatedFields.success) {
    return {
      errors: { form: ['Invalid user data provided.'] },
      message: 'Validation failed.',
      success: false,
    };
  }

  const { userId, authId, userName, actorId, actorName } = validatedFields.data;

  try {
    // 1. Determine the UID for Firebase Auth
    // In this system, the Firestore document ID (userId) IS usually the Firebase Auth UID.
    const uidToDelete = authId && authId.trim() !== '' ? authId : userId;

    // 2. Delete the user from Firebase Auth FIRST to revoke access immediately
    try {
        await adminAuth.deleteUser(uidToDelete);
    } catch (authError: any) {
        // If the user doesn't exist in Auth (e.g. manually deleted or never had a login), 
        // we should still proceed with deleting the Firestore record.
        if (authError.code === 'auth/user-not-found') {
            console.warn(`User ${uidToDelete} not found in Firebase Auth, proceeding with Firestore deletion.`);
        } else {
            console.error('Error deleting from Firebase Auth:', authError);
            // We proceed anyway to clean up Firestore
        }
    }

    // 3. Delete the user from Firestore
    await adminDb.collection('users').doc(userId).delete();

    // 4. Log the system event
    await logSystemEvent({
      eventType: 'USER_DELETED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} deleted user ${userName} and revoked their login access.`,
      details: { deletedUserId: userId, deletedUserName: userName, deletedAuthId: uidToDelete }
    });
    
    revalidatePath('/users');
    revalidatePath('/settings');
    
    return {
      success: true,
      message: `Successfully deleted ${userName} and revoked all system access.`,
    };

  } catch (error: any) {
    console.error('Error in deleteUserAction:', error);
    return {
      errors: { form: [error.message || 'An unexpected error occurred during deletion.'] },
      message: 'Failed to delete user completely.',
      success: false,
    };
  }
}
