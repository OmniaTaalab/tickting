'use server';

import { z } from 'zod';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { adminDb } from '@/lib/firebaseAdmin';
import { logSystemEvent } from '@/lib/system-log';
import { divisionIdsFor, normalizeEmail, schoolIdsForCampuses } from '@/lib/org-structure';
import type { Campus, MailboxScope } from '@/lib/types';

const MAILBOXES_COLLECTION = 'mailboxes';

const MailboxSchema = z
  .object({
    id: z.string().optional(),
    email: z.string().trim().toLowerCase().email('Enter a valid mailbox address.'),
    displayName: z.string().trim().max(80).optional(),
    departmentId: z.string().min(1, 'Select a category.'),
    scope: z.enum(['department', 'campus', 'academic']),
    campusId: z.string().optional(),
    schoolIds: z.array(z.string()).default([]),
    divisionIds: z.array(z.string()).default([]),
    assignTo: z.array(z.string()).default([]),
    enabled: z.boolean().default(true),
    notes: z.string().trim().max(500).optional(),
    actorId: z.string().min(1),
    actorName: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (data.scope !== 'department' && !data.campusId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['campusId'], message: 'Select a campus.' });
    }
    if (data.scope === 'academic') {
      if (!data.schoolIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schoolIds'], message: 'Select at least one school.' });
      }
      if (!data.divisionIds.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['divisionIds'], message: 'Select at least one division.' });
      }
    }
  });

export type MailboxActionState = {
  errors?: Partial<Record<'form' | 'email' | 'departmentId' | 'scope' | 'campusId' | 'schoolIds' | 'divisionIds' | 'assignTo', string[]>>;
  message?: string | null;
  success?: boolean;
  id?: string;
};

async function requireAdmin(actorId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!adminDb) return { ok: false, message: 'Firebase Admin not configured.' };
  const snap = await adminDb.collection('users').doc(actorId).get();
  let data = snap.data();
  if (!data) {
    const byAuth = await adminDb.collection('users').where('authId', '==', actorId).limit(1).get();
    data = byAuth.docs[0]?.data();
  }
  if (data?.role !== 'Admin') return { ok: false, message: 'Only administrators can manage email configurations.' };
  return { ok: true };
}

export async function createOrUpdateMailboxAction(
  prevState: MailboxActionState,
  formData: FormData
): Promise<MailboxActionState> {
  if (!adminDb) return { errors: { form: ['Firebase Admin not configured'] }, success: false };

  const parsed = MailboxSchema.safeParse({
    id: formData.get('id') || undefined,
    email: formData.get('email'),
    displayName: formData.get('displayName') || undefined,
    departmentId: formData.get('departmentId'),
    scope: formData.get('scope'),
    campusId: formData.get('campusId') || undefined,
    schoolIds: formData.getAll('schoolIds').map(String),
    divisionIds: formData.getAll('divisionIds').map(String),
    assignTo: formData.getAll('assignTo').map(String),
    enabled: formData.get('enabled') !== 'false',
    notes: formData.get('notes') || undefined,
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!parsed.success) {
    return { errors: parsed.error.flatten().fieldErrors as MailboxActionState['errors'], message: 'Validation failed.', success: false };
  }
  const data = parsed.data;

  const auth = await requireAdmin(data.actorId);
  if (!auth.ok) return { errors: { form: [auth.message] }, message: auth.message, success: false };

  try {
    // Unique address.
    const dup = await adminDb.collection(MAILBOXES_COLLECTION).where('email', '==', data.email).limit(1).get();
    if (!dup.empty && dup.docs[0].id !== data.id) {
      return { errors: { email: ['This mailbox is already configured.'] }, message: 'Duplicate mailbox.', success: false };
    }

    const deptSnap = await adminDb.collection('departments').doc(data.departmentId).get();
    if (!deptSnap.exists) return { errors: { departmentId: ['Category not found.'] }, success: false };
    const departmentName = String(deptSnap.data()?.name || '');

    let campusName: string | null = null;
    let schoolIds: string[] = [];
    let divisionIds: string[] = [];
    const scope: MailboxScope = data.scope;

    if (scope !== 'department' && data.campusId) {
      const campusSnap = await adminDb.collection('campuses').doc(data.campusId).get();
      if (!campusSnap.exists) return { errors: { campusId: ['Campus not found.'] }, success: false };
      const campus = { id: campusSnap.id, ...(campusSnap.data() as Omit<Campus, 'id'>) } as Campus;
      campusName = campus.name;

      if (scope === 'academic') {
        // Only schools and divisions that exist in this campus's tree are accepted.
        const allowedSchools = schoolIdsForCampuses([campus], [campus.id]);
        schoolIds = data.schoolIds.filter((id) => allowedSchools.includes(id));
        if (!schoolIds.length) {
          return { errors: { schoolIds: ['Selected schools are not configured on this campus.'] }, success: false };
        }
        if (data.assignTo.length) {
          // Director-style queue: divisions only label the queue, so any division is allowed.
          divisionIds = Array.from(new Set(data.divisionIds));
        } else {
          const allowedDivisions = divisionIdsFor([campus], [campus.id], schoolIds);
          divisionIds = data.divisionIds.filter((id) => allowedDivisions.includes(id));
        }
        if (!divisionIds.length) {
          return { errors: { divisionIds: ['Selected divisions are not configured under these schools on this campus.'] }, success: false };
        }
      }
    }

    const payload: Record<string, unknown> = {
      email: data.email,
      displayName: data.displayName || null,
      departmentId: data.departmentId,
      departmentName,
      scope,
      campusId: scope === 'department' ? null : data.campusId || null,
      campusName,
      schoolIds,
      divisionIds,
      assignTo: Array.from(new Set(data.assignTo.map(normalizeEmail).filter(Boolean))),
      enabled: data.enabled,
      notes: data.notes || null,
      updatedAt: FieldValue.serverTimestamp(),
    };

    const actor = { userId: data.actorId, name: data.actorName };
    let id = data.id;
    if (id) {
      await adminDb.collection(MAILBOXES_COLLECTION).doc(id).set(payload, { merge: true });
      await logSystemEvent({
        eventType: 'MAILBOX_UPDATED',
        actor,
        message: `${data.actorName} updated email configuration "${data.email}".`,
        details: { mailboxId: id, ...payload, updatedAt: undefined },
      });
    } else {
      const ref = await adminDb.collection(MAILBOXES_COLLECTION).add({
        ...payload,
        lastSyncStatus: 'never',
        createdAt: FieldValue.serverTimestamp(),
      });
      id = ref.id;
      await logSystemEvent({
        eventType: 'MAILBOX_CREATED',
        actor,
        message: `${data.actorName} added email configuration "${data.email}".`,
        details: { mailboxId: id, ...payload, updatedAt: undefined },
      });
    }

    revalidatePath('/settings');
    return { success: true, id, message: `Email configuration "${data.email}" ${data.id ? 'updated' : 'created'}.` };
  } catch (error: any) {
    console.error('Mailbox action error:', error);
    return { errors: { form: [error?.message || 'Failed to save.'] }, message: 'Failed.', success: false };
  }
}

export async function setMailboxEnabledAction(
  prevState: MailboxActionState,
  formData: FormData
): Promise<MailboxActionState> {
  if (!adminDb) return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  const id = String(formData.get('id') || '');
  const enabled = formData.get('enabled') === 'true';
  const actorId = String(formData.get('actorId') || '');
  const actorName = String(formData.get('actorName') || 'Admin');
  if (!id || !actorId) return { errors: { form: ['Missing mailbox or actor.'] }, success: false };

  const auth = await requireAdmin(actorId);
  if (!auth.ok) return { errors: { form: [auth.message] }, success: false };

  try {
    const ref = adminDb.collection(MAILBOXES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { errors: { form: ['Mailbox not found.'] }, success: false };
    await ref.update({ enabled, updatedAt: FieldValue.serverTimestamp() });
    await logSystemEvent({
      eventType: enabled ? 'MAILBOX_ENABLED' : 'MAILBOX_DISABLED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} ${enabled ? 'enabled' : 'disabled'} email configuration "${snap.data()?.email}".`,
      details: { mailboxId: id, enabled },
    });
    revalidatePath('/settings');
    return { success: true, id, message: `Mailbox ${enabled ? 'enabled' : 'disabled'}.` };
  } catch (error: any) {
    return { errors: { form: [error?.message || 'Failed.'] }, success: false };
  }
}

export async function deleteMailboxAction(
  prevState: MailboxActionState,
  formData: FormData
): Promise<MailboxActionState> {
  if (!adminDb) return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  const id = String(formData.get('id') || '');
  const actorId = String(formData.get('actorId') || '');
  const actorName = String(formData.get('actorName') || 'Admin');
  if (!id || !actorId) return { errors: { form: ['Missing mailbox or actor.'] }, success: false };

  const auth = await requireAdmin(actorId);
  if (!auth.ok) return { errors: { form: [auth.message] }, success: false };

  try {
    const ref = adminDb.collection(MAILBOXES_COLLECTION).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return { errors: { form: ['Mailbox not found.'] }, success: false };
    const email = String(snap.data()?.email || '');

    // Detach staff that were assigned by this mailbox so they are not left restricted to a deleted queue.
    const attached = await adminDb.collection('users').where('mailboxIds', 'array-contains', id).get();
    const batch = adminDb.batch();
    attached.docs.forEach((doc) => {
      batch.update(doc.ref, {
        mailboxIds: FieldValue.arrayRemove(id),
        mailboxEmails: FieldValue.arrayRemove(email),
      });
    });
    batch.delete(ref);
    await batch.commit();

    await logSystemEvent({
      eventType: 'MAILBOX_DELETED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} deleted email configuration "${email}".`,
      details: { mailboxId: id, email, detachedUsers: attached.size },
    });
    revalidatePath('/settings');
    return { success: true, message: `Mailbox "${email}" deleted.` };
  } catch (error: any) {
    return { errors: { form: [error?.message || 'Failed to delete.'] }, success: false };
  }
}
