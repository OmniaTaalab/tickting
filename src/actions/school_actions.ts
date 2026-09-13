
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';

const SchoolSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'School name is required.'),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type SchoolActionState = {
  errors?: {
    form?: string[];
    name?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createOrUpdateSchoolAction(
  prevState: SchoolActionState,
  formData: FormData
): Promise<SchoolActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = SchoolSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Validation failed.',
      success: false,
    };
  }

  const { id, name, actorId, actorName } = validatedFields.data;

  try {
    const actor = { userId: actorId, name: actorName };
    if (id) {
      const schoolRef = adminDb.collection('schools').doc(id);
      await schoolRef.update({ name });
      await logSystemEvent({
        eventType: 'SCHOOL_UPDATED',
        actor,
        message: `${actorName} updated school "${name}".`,
        details: { schoolId: id, newName: name },
      });
    } else {
      const docRef = await adminDb.collection('schools').add({ name });
      await logSystemEvent({
        eventType: 'SCHOOL_CREATED',
        actor,
        message: `${actorName} created school "${name}".`,
        details: { schoolId: docRef.id, name: name },
      });
    }
    revalidatePath('/settings');
    return {
      success: true,
      message: `School "${name}" has been ${id ? 'updated' : 'created'}.`,
    };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed.', success: false };
  }
}

export async function deleteSchoolAction(
  prevState: any,
  formData: FormData
): Promise<any> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const id = formData.get('id') as string;
  const name = formData.get('name') as string;
  const actorId = formData.get('actorId') as string;
  const actorName = formData.get('actorName') as string;

  try {
    await adminDb.collection('schools').doc(id).delete();
    await logSystemEvent({
        eventType: 'SCHOOL_DELETED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} deleted school "${name}".`,
        details: { schoolId: id, schoolName: name },
    });
    revalidatePath('/settings');
    return { success: true, message: 'School deleted successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to delete.', success: false };
  }
}
