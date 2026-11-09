import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { Campus, MailboxConfig } from '@/lib/types';
import { normalizeEmail, scopeFromMailboxes } from '@/lib/org-structure';

export type ScopeFormInput = {
  role: string;
  scopeMode?: string | null;
  departmentId?: string | null;
  campusIds: string[];
  schoolIds: string[];
  divisionIds: string[];
  gradeIds: string[];
  mailboxIds: string[];
};

export type ResolvedScopeFields = {
  fields: Record<string, unknown>;
  departmentId: string | null;
  error?: string;
};

export function readScopeFromFormData(formData: FormData, role: string): ScopeFormInput {
  const all = (key: string) => formData.getAll(key).map(String).filter(Boolean);
  return {
    role,
    scopeMode: (formData.get('scopeMode') as string | null) || null,
    departmentId: (formData.get('departmentId') as string | null) || null,
    campusIds: all('campusIds'),
    schoolIds: all('schoolIds'),
    divisionIds: all('divisionIds'),
    gradeIds: all('gradeIds'),
    mailboxIds: all('mailboxIds'),
  };
}

/**
 * Turn the employee dialog's selection into the user-document fields.
 *
 * - Admins carry no scope: every scope field is removed.
 * - "By mailbox": the chosen mailboxes are authoritative. Campus, schools, divisions
 *   and grades are DERIVED here from the mailbox documents and the campus tree (the
 *   client's values are ignored), and `mailboxEmails` restricts assignment to them.
 * - "By structure": the ids are stored as chosen; mailbox membership is cleared.
 */
export async function resolveScopeFields(db: Firestore, input: ScopeFormInput): Promise<ResolvedScopeFields> {
  const isStaff = input.role === 'Employee' || input.role === 'Manager';
  if (!isStaff) {
    return {
      departmentId: null,
      fields: {
        departmentId: FieldValue.delete(),
        divisionIds: FieldValue.delete(),
        campusIds: FieldValue.delete(),
        schoolIds: FieldValue.delete(),
        schoolId: FieldValue.delete(),
        gradeIds: FieldValue.delete(),
        scopeMode: FieldValue.delete(),
        mailboxIds: FieldValue.delete(),
        mailboxEmails: FieldValue.delete(),
      },
    };
  }

  const mode = input.scopeMode === 'mailbox' || (!input.scopeMode && input.mailboxIds.length) ? 'mailbox' : 'structure';

  if (mode === 'mailbox') {
    if (!input.mailboxIds.length) return { departmentId: null, fields: {}, error: 'Select at least one mailbox.' };
    const mailboxSnaps = await Promise.all(input.mailboxIds.map((id) => db.collection('mailboxes').doc(id).get()));
    const mailboxes = mailboxSnaps
      .filter((s) => s.exists)
      .map((s) => ({ id: s.id, ...(s.data() as Omit<MailboxConfig, 'id'>) }) as MailboxConfig);
    if (!mailboxes.length) return { departmentId: null, fields: {}, error: 'Selected mailboxes were not found.' };

    const departmentIds = Array.from(new Set(mailboxes.map((m) => m.departmentId)));
    if (departmentIds.length !== 1) {
      return { departmentId: null, fields: {}, error: 'Selected mailboxes belong to different categories. Pick mailboxes of one category.' };
    }
    const campusIds = Array.from(new Set(mailboxes.map((m) => m.campusId).filter((c): c is string => Boolean(c))));
    const campusSnaps = await Promise.all(campusIds.map((id) => db.collection('campuses').doc(id).get()));
    const campuses = campusSnaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...(s.data() as Omit<Campus, 'id'>) }) as Campus);
    const derived = scopeFromMailboxes(mailboxes, campuses);

    return {
      departmentId: departmentIds[0],
      fields: {
        departmentId: departmentIds[0],
        scopeMode: 'mailbox',
        mailboxIds: mailboxes.map((m) => m.id),
        mailboxEmails: Array.from(new Set(mailboxes.map((m) => normalizeEmail(m.email)))),
        campusIds: derived.campusIds,
        schoolIds: derived.schoolIds,
        schoolId: derived.schoolIds[0] || FieldValue.delete(),
        divisionIds: derived.divisionIds,
        gradeIds: derived.gradeIds,
      },
    };
  }

  const departmentId = input.departmentId && input.departmentId !== 'none' ? input.departmentId : null;
  if (!departmentId) return { departmentId: null, fields: {}, error: 'Category is required for Employees and Managers.' };
  if (!input.campusIds.length) return { departmentId, fields: {}, error: 'Select at least one campus.' };

  return {
    departmentId,
    fields: {
      departmentId,
      scopeMode: 'structure',
      mailboxIds: FieldValue.delete(),
      mailboxEmails: FieldValue.delete(),
      campusIds: input.campusIds,
      schoolIds: input.schoolIds,
      schoolId: input.schoolIds[0] || FieldValue.delete(),
      divisionIds: input.divisionIds,
      gradeIds: input.gradeIds,
    },
  };
}

/** For `set()` on a brand-new document: drop FieldValue.delete() sentinels. */
export function stripDeletes(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof FieldValue) continue;
    out[k] = v;
  }
  return out;
}
