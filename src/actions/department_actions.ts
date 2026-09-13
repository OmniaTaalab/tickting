
'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';
import type { WorkingHours } from '@/lib/types';

// ========== CREATE / UPDATE ==========
const DepartmentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, 'Category name must be at least 2 characters.'),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type DepartmentActionState = {
  errors?: {
    form?: string[];
    name?: string[];
  };
  message?: string | null;
  success?: boolean;
};

export async function createOrUpdateDepartmentAction(
  prevState: DepartmentActionState,
  formData: FormData
): Promise<DepartmentActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = DepartmentSchema.safeParse({
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
      // Update
      const deptRef = adminDb.collection('departments').doc(id);
      await deptRef.update({ name });
       await logSystemEvent({
        eventType: 'CATEGORY_UPDATED',
        actor,
        message: `${actorName} updated category "${name}".`,
        details: { departmentId: id, newName: name },
      });
    } else {
      // Create
      const docRef = await adminDb.collection('departments').add({ name });
      await logSystemEvent({
        eventType: 'CATEGORY_CREATED',
        actor,
        message: `${actorName} created category "${name}".`,
        details: { departmentId: docRef.id, name: name },
      });
    }
    revalidatePath('/settings');
    return {
      success: true,
      message: `Category "${name}" has been ${id ? 'updated' : 'created'}.`,
    };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed.', success: false };
  }
}


// ========== DELETE ==========
const DeleteDepartmentSchema = z.object({
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

export async function deleteDepartmentAction(
  prevState: DeleteActionState,
  formData: FormData
): Promise<DeleteActionState> {
  if (!adminDb) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = DeleteDepartmentSchema.safeParse({
    id: formData.get('id'),
    name: formData.get('name'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validatedFields.success) {
    return { errors: { form: ['Invalid data.'] }, success: false };
  }

  const { id, name, actorId, actorName } = validatedFields.data;

  try {
    await adminDb.collection('departments').doc(id).delete();
    
    await logSystemEvent({
        eventType: 'CATEGORY_DELETED',
        actor: { userId: actorId, name: actorName },
        message: `${actorName} deleted category "${name}".`,
        details: { departmentId: id, departmentName: name },
    });

    revalidatePath('/settings');
    return { success: true, message: 'Category deleted successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to delete.', success: false };
  }
}

// ========== WORKING HOURS ==========
export async function updateDepartmentWorkingHoursAction(
    departmentId: string,
    workingHours: WorkingHours,
    actor: { userId: string; name: string }
) {
    if (!adminDb) return { success: false, message: 'DB error' };

    try {
        await adminDb.collection('departments').doc(departmentId).update({
            workingHours,
        });

        await logSystemEvent({
            eventType: 'DEPARTMENT_WORKING_HOURS_UPDATED',
            actor,
            message: `${actor.name} updated working hours for department.`,
            details: { departmentId, workingHours },
        });

        revalidatePath('/settings');
        return { success: true, message: 'Working hours updated successfully.' };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
