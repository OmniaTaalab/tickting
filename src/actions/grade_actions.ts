
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';

const GradeSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Grade name is required.'),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type GradeActionState = {
  errors?: {
    form?: string[];
    name?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createOrUpdateGradeAction(
  prevState: GradeActionState,
  formData: FormData
): Promise<GradeActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = GradeSchema.safeParse({
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
      const gradeRef = adminDb.collection('grades').doc(id);
      await gradeRef.update({ name });
      await logSystemEvent({
        eventType: 'GRADE_UPDATED',
        actor,
        message: `${actorName} updated grade "${name}".`,
        details: { gradeId: id, newName: name },
      });
    } else {
      const docRef = await adminDb.collection('grades').add({ name });
      await logSystemEvent({
        eventType: 'GRADE_CREATED',
        actor,
        message: `${actorName} created grade "${name}".`,
        details: { gradeId: docRef.id, name: name },
      });
    }
    revalidatePath('/settings');
    return {
      success: true,
      message: `Grade "${name}" has been ${id ? 'updated' : 'created'}.`,
    };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed.', success: false };
  }
}

export async function deleteGradeAction(
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
    await adminDb.collection('grades').doc(id).delete();
    await logSystemEvent({
        eventType: 'GRADE_DELETED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} deleted grade "${name}".`,
        details: { gradeId: id, gradeName: name },
    });
    revalidatePath('/settings');
    return { success: true, message: 'Grade deleted successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to delete.', success: false };
  }
}
