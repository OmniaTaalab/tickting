'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';

const CampusSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Campus name is required.'),
  schoolConfigsJson: z.string().min(1, 'School configuration is required.'),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type CampusActionState = {
  errors?: {
    form?: string[];
    name?: string[];
    schoolConfigsJson?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createOrUpdateCampusAction(
  prevState: CampusActionState,
  formData: FormData
): Promise<CampusActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = CampusSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    schoolConfigsJson: formData.get('schoolConfigsJson'),
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

  const { id, name, schoolConfigsJson, actorId, actorName } = validatedFields.data;

  try {
    const schoolConfigs = JSON.parse(schoolConfigsJson);
    const actor = { userId: actorId, name: actorName };
    const payload = { 
        name, 
        schoolConfigs 
    };

    if (id) {
      const campusRef = adminDb.collection('campuses').doc(id);
      await campusRef.update(payload);
      await logSystemEvent({
        eventType: 'CAMPUS_UPDATED',
        actor,
        message: `${actorName} updated campus "${name}" with ${schoolConfigs.length} school configurations.`,
        details: { campusId: id, newName: name, schoolConfigs },
      });
    } else {
      const docRef = await adminDb.collection('campuses').add(payload);
      await logSystemEvent({
        eventType: 'CAMPUS_CREATED',
        actor,
        message: `${actorName} created campus "${name}" with ${schoolConfigs.length} school configurations.`,
        details: { campusId: docRef.id, name: name, schoolConfigs },
      });
    }
    revalidatePath('/settings');
    return {
      success: true,
      message: `Campus "${name}" has been ${id ? 'updated' : 'created'}.`,
    };
  } catch (error: any) {
    console.error("Campus action error:", error);
    return { errors: { form: [error.message] }, message: 'Failed.', success: false };
  }
}

export async function deleteCampusAction(
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
    await adminDb.collection('campuses').doc(id).delete();
    await logSystemEvent({
        eventType: 'CAMPUS_DELETED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} deleted campus "${name}".`,
        details: { campusId: id, campusName: name },
    });
    revalidatePath('/settings');
    return { success: true, message: 'Campus deleted successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to delete.', success: false };
  }
}
