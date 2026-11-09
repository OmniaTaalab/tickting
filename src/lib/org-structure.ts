/**
 * Organization structure helpers (pure, no Firestore access).
 *
 * The structure is a tree per campus:
 *   campus -> schools -> divisions -> grades
 * stored on `campuses/{id}.schoolConfigs[].divisions[]`.
 *
 * Categories (departments) link to campuses through `departments/{id}.campusIds`.
 * Mailboxes (Settings > Email Configurations) point at a category, a campus,
 * schools and divisions; their routes and the employee scopes are DERIVED from
 * the campus tree so there is a single source of truth.
 */
import type {
  Campus,
  CampusDivisionConfig,
  CampusSchoolConfig,
  Department,
  MailboxConfig,
} from './types';

export type NamedRecord = { id: string; name: string };

export type DerivedScope = {
  campusIds: string[];
  schoolIds: string[];
  divisionIds: string[];
  gradeIds: string[];
};

const uniq = (values: Array<string | null | undefined>): string[] =>
  Array.from(new Set(values.filter((v): v is string => Boolean(v && v.trim()))));

/** Divisions of a school config, tolerating the older shape that only had gradeIds. */
export function divisionsOfSchoolConfig(config: CampusSchoolConfig | undefined): CampusDivisionConfig[] {
  if (!config) return [];
  return Array.isArray(config.divisions) ? config.divisions.filter((d) => d && d.divisionId) : [];
}

/**
 * Every grade offered by a school on a campus: the grades of its divisions PLUS any
 * grade listed directly on the school (live data created before divisions existed).
 * Nothing is ever dropped from a school by adding divisions.
 */
export function gradesOfSchoolConfig(config: CampusSchoolConfig | undefined): string[] {
  if (!config) return [];
  return uniq([...(config.gradeIds || []), ...divisionsOfSchoolConfig(config).flatMap((d) => d.gradeIds || [])]);
}

/** Grades on the school that no division claims yet (shown as a warning in the campus editor). */
export function unassignedGradesOfSchoolConfig(config: CampusSchoolConfig | undefined): string[] {
  if (!config) return [];
  const claimed = new Set(divisionsOfSchoolConfig(config).flatMap((d) => d.gradeIds || []));
  return (config.gradeIds || []).filter((g) => !claimed.has(g));
}

/** Normalize a school config: clean divisions, `gradeIds` = existing grades + division grades. */
export function normalizeSchoolConfig(config: CampusSchoolConfig): CampusSchoolConfig {
  const divisions = divisionsOfSchoolConfig(config).map((d) => ({
    divisionId: d.divisionId,
    gradeIds: uniq(d.gradeIds || []),
  }));
  return {
    schoolId: config.schoolId,
    divisions,
    gradeIds: uniq([...(config.gradeIds || []), ...divisions.flatMap((d) => d.gradeIds)]),
  };
}

export function schoolConfigsOf(campus: Campus | undefined | null): CampusSchoolConfig[] {
  return Array.isArray(campus?.schoolConfigs) ? campus!.schoolConfigs!.filter((c) => c && c.schoolId) : [];
}

/** Categories available on at least one of the given campuses (empty campusIds = all). */
export function departmentsForCampuses(departments: Department[], campusIds: string[]): Department[] {
  if (!campusIds.length) return departments;
  return departments.filter((d) => !d.campusIds?.length || d.campusIds.some((id) => campusIds.includes(id)));
}

/** Campuses a category operates on (empty campusIds = all). */
export function campusesForDepartment(campuses: Campus[], department: Department | undefined | null): Campus[] {
  if (!department || !department.campusIds?.length) return campuses;
  return campuses.filter((c) => department.campusIds!.includes(c.id));
}

/** School ids configured on any of the given campuses. */
export function schoolIdsForCampuses(campuses: Campus[], campusIds: string[]): string[] {
  return uniq(
    campuses
      .filter((c) => campusIds.includes(c.id))
      .flatMap((c) => schoolConfigsOf(c).map((cfg) => cfg.schoolId))
  );
}

/** Division ids configured under the given schools on the given campuses. */
export function divisionIdsFor(campuses: Campus[], campusIds: string[], schoolIds: string[]): string[] {
  return uniq(
    campuses
      .filter((c) => campusIds.includes(c.id))
      .flatMap((c) =>
        schoolConfigsOf(c)
          .filter((cfg) => schoolIds.includes(cfg.schoolId))
          .flatMap((cfg) => divisionsOfSchoolConfig(cfg).map((d) => d.divisionId))
      )
  );
}

/** Grade ids under the given divisions of the given schools on the given campuses. */
export function gradeIdsFor(
  campuses: Campus[],
  campusIds: string[],
  schoolIds: string[],
  divisionIds: string[]
): string[] {
  return uniq(
    campuses
      .filter((c) => campusIds.includes(c.id))
      .flatMap((c) =>
        schoolConfigsOf(c)
          .filter((cfg) => schoolIds.includes(cfg.schoolId))
          .flatMap((cfg) =>
            divisionsOfSchoolConfig(cfg)
              .filter((d) => divisionIds.includes(d.divisionId))
              .flatMap((d) => d.gradeIds || [])
          )
      )
  );
}

/** Scope implied by a set of mailboxes (campus, schools, divisions, and grades from the tree). */
export function scopeFromMailboxes(mailboxes: MailboxConfig[], campuses: Campus[]): DerivedScope {
  const campusIds = uniq(mailboxes.map((m) => m.campusId));
  const schoolIds = uniq(mailboxes.flatMap((m) => m.schoolIds || []));
  const divisionIds = uniq(mailboxes.flatMap((m) => m.divisionIds || []));
  const gradeIds = uniq(
    mailboxes.flatMap((m) =>
      m.campusId ? gradeIdsFor(campuses, [m.campusId], m.schoolIds || [], m.divisionIds || []) : []
    )
  );
  return { campusIds, schoolIds, divisionIds, gradeIds };
}

export type MailboxRoute = { school: string; division: string; grades: string[] };

/**
 * Routes (by NAME, as the email router expects) for one mailbox:
 * one route per (school, division) pair that exists in the campus tree.
 */
export function routesForMailbox(
  mailbox: Pick<MailboxConfig, 'scope' | 'campusId' | 'schoolIds' | 'divisionIds'> & { assignTo?: string[] },
  campus: Campus | undefined | null,
  names: { schools: Map<string, string>; divisions: Map<string, string>; grades: Map<string, string> }
): MailboxRoute[] {
  if (mailbox.scope !== 'academic' || !campus) return [];
  const routes: MailboxRoute[] = [];
  for (const cfg of schoolConfigsOf(campus)) {
    if (!mailbox.schoolIds.includes(cfg.schoolId)) continue;
    const school = names.schools.get(cfg.schoolId);
    if (!school) continue;
    // Director-style queue (explicit staff list): the selected divisions label the queue
    // and cover every grade the school offers, so the campus tree is not polluted with them.
    if (mailbox.assignTo?.length) {
      const grades = uniq(gradesOfSchoolConfig(cfg).map((g) => names.grades.get(g)));
      for (const divisionId of mailbox.divisionIds) {
        const division = names.divisions.get(divisionId);
        if (division && grades.length) routes.push({ school, division, grades });
      }
      continue;
    }
    for (const div of divisionsOfSchoolConfig(cfg)) {
      if (!mailbox.divisionIds.includes(div.divisionId)) continue;
      const division = names.divisions.get(div.divisionId);
      if (!division) continue;
      const grades = uniq((div.gradeIds || []).map((g) => names.grades.get(g)));
      if (!grades.length) continue;
      routes.push({ school, division, grades });
    }
  }
  return routes;
}

export const normalizeEmail = (value: string | null | undefined): string => String(value || '').trim().toLowerCase();
