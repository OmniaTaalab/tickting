
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';

const TagSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Tag name is required.'),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type TagActionState = {
  errors?: {
    form?: string[];
    name?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createOrUpdateTagAction(
  prevState: TagActionState,
  formData: FormData
): Promise<TagActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = TagSchema.safeParse({
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
  const cleanName = name.trim().toLowerCase().replace(/^#/, '');

  try {
    const actor = { userId: actorId, name: actorName };
    if (id) {
      const tagRef = adminDb.collection('settings_tags').doc(id);
      await tagRef.update({ name: cleanName });
      await logSystemEvent({
        eventType: 'TAG_UPDATED',
        actor,
        message: `${actorName} updated predefined tag to "${cleanName}".`,
        details: { tagId: id, newName: cleanName },
      });
    } else {
      // Check if exists
      const existing = await adminDb.collection('settings_tags').where('name', '==', cleanName).get();
      if (!existing.empty) {
          return { errors: { form: ['This tag already exists.'] }, success: false };
      }

      const docRef = await adminDb.collection('settings_tags').add({ name: cleanName });
      await logSystemEvent({
        eventType: 'TAG_CREATED',
        actor,
        message: `${actorName} created predefined tag "${cleanName}".`,
        details: { tagId: docRef.id, name: cleanName },
      });
    }
    revalidatePath('/settings');
    return {
      success: true,
      message: `Tag "${cleanName}" has been ${id ? 'updated' : 'created'}.`,
    };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed.', success: false };
  }
}

export async function deleteTagAction(
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
    await adminDb.collection('settings_tags').doc(id).delete();
    await logSystemEvent({
        eventType: 'TAG_DELETED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} deleted predefined tag "${name}".`,
        details: { tagId: id, tagName: name },
    });
    revalidatePath('/settings');
    return { success: true, message: 'Tag deleted successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to delete.', success: false };
  }
}
