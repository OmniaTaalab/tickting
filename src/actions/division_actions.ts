
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';

const DivisionSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Division name is required.'),
  color: z.string().optional(),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type DivisionActionState = {
  errors?: {
    form?: string[];
    name?: string[];
    color?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createOrUpdateDivisionAction(
  prevState: DivisionActionState,
  formData: FormData
): Promise<DivisionActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = DivisionSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    color: formData.get('color') || undefined,
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

  const { id, name, color, actorId, actorName } = validatedFields.data;

  try {
    const actor = { userId: actorId, name: actorName };
    const payload = { name, color: color || '#3B82F6' };

    if (id) {
      const docRef = adminDb.collection('divisions').doc(id);
      await docRef.update(payload);
      await logSystemEvent({
        eventType: 'DIVISION_UPDATED',
        actor,
        message: `${actorName} updated division "${name}".`,
        details: { divisionId: id, newName: name, color: payload.color },
      });
    } else {
      const docRef = await adminDb.collection('divisions').add(payload);
      await logSystemEvent({
        eventType: 'DIVISION_CREATED',
        actor,
        message: `${actorName} created division "${name}".`,
        details: { divisionId: docRef.id, name: name, color: payload.color },
      });
    }
    revalidatePath('/settings');
    return {
      success: true,
      message: `Division "${name}" has been ${id ? 'updated' : 'created'}.`,
    };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed.', success: false };
  }
}

export async function deleteDivisionAction(
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
    await adminDb.collection('divisions').doc(id).delete();
    await logSystemEvent({
        eventType: 'DIVISION_DELETED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} deleted division "${name}".`,
        details: { divisionId: id, divisionName: name },
    });
    revalidatePath('/settings');
    return { success: true, message: 'Division deleted successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to delete.', success: false };
  }
}
