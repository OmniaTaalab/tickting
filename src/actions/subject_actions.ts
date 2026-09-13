'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';


// ========== CREATE / UPDATE ==========
const SubjectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(3, 'Subject name must be at least 3 characters.'),
  departmentId: z.string().min(1, 'You must select a Category.'),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type SubjectActionState = {
  errors?: {
    form?: string[];
    name?: string[];
    departmentId?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createOrUpdateSubjectAction(
  prevState: SubjectActionState,
  formData: FormData
): Promise<SubjectActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = SubjectSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    departmentId: formData.get('departmentId'),
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

  const { id, name, departmentId, actorId, actorName } = validatedFields.data;
  const data = { name, departmentId };
  const actor = { userId: actorId, name: actorName };

  try {
    if (id) {
      // Update
      const subjectRef = adminDb.collection('subjects').doc(id);
      await subjectRef.update(data);
       await logSystemEvent({
        eventType: 'SUBJECT_UPDATED',
        actor,
        message: `${actorName} updated subject "${name}".`,
        details: { subjectId: id, newName: name, departmentId },
      });
    } else {
      // Create
      const docRef = await adminDb.collection('subjects').add(data);
       await logSystemEvent({
        eventType: 'SUBJECT_CREATED',
        actor,
        message: `${actorName} created subject "${name}".`,
        details: { subjectId: docRef.id, name, departmentId },
      });
    }
    revalidatePath('/settings');
    return {
      success: true,
      message: `Subject "${name}" has been ${id ? 'updated' : 'created'}.`,
    };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed.', success: false };
  }
}

// ========== DELETE ==========
const DeleteSubjectSchema = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1, 'Name is required'),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type DeleteActionState = {
  errors?: { form?: string[]; };
  message?: string | null;
  success?: boolean;
};

export async function deleteSubjectAction(
  prevState: DeleteActionState,
  formData: FormData
): Promise<DeleteActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = DeleteSubjectSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validatedFields.success) {
    return { errors: { form: ['Invalid ID.'] }, success: false };
  }

  const { id, name, actorId, actorName } = validatedFields.data;

  try {
    await adminDb.collection('subjects').doc(id).delete();

    await logSystemEvent({
        eventType: 'SUBJECT_DELETED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} deleted subject "${name}".`,
        details: { subjectId: id, subjectName: name },
    });

    revalidatePath('/settings');
    return { success: true, message: 'Subject deleted successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to delete.', success: false };
  }
}
