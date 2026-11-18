/**
 * How the campus editor shows and rebuilds `schoolConfigs[].divisions[]` (pure, no Firestore).
 *
 * Every grade has ONE own division (Elementary, Middle School...), chosen per grade. Some
 * divisions also cover grades that already have their own division: Academic Dean's Office
 * on 1st Settlement / American covers Grade 1-12, which are also in Elementary, Middle
 * School and High School, and the ad.tg@ mailbox routes through it. Those are kept as
 * "extra" divisions with their own grade list, so opening a campus and saving it never
 * drops one.
 */
import type { CampusDivisionConfig, CampusSchoolConfig } from './types';

export type DivisionLayout = {
  /** grade -> its own division. */
  main: Map<string, string>;
  /** division -> grades it covers in addition to their own division. */
  extra: Map<string, string[]>;
  /** Division order as stored; a save keeps it. */
  order: string[];
};

export function divisionLayout(config: CampusSchoolConfig): DivisionLayout {
  const order: string[] = [];
  const members = new Map<string, string[]>();
  for (const d of config.divisions || []) {
    if (!d?.divisionId) continue;
    if (!members.has(d.divisionId)) { order.push(d.divisionId); members.set(d.divisionId, []); }
    const list = members.get(d.divisionId)!;
    for (const g of d.gradeIds || []) if (g && !list.includes(g)) list.push(g);
  }
  // A grade in several divisions belongs to the most specific one (fewest grades); the
  // broader one covers it as an extra. Ties keep the later division, as the editor always did.
  const main = new Map<string, string>();
  for (const id of order) {
    for (const g of members.get(id)!) {
      const current = main.get(g);
      if (!current || members.get(id)!.length <= members.get(current)!.length) main.set(g, id);
    }
  }
  const extra = new Map<string, string[]>();
  for (const id of order) {
    const grades = members.get(id)!.filter((g) => main.get(g) !== id);
    if (grades.length) extra.set(id, grades);
  }
  return { main, extra, order };
}

/** The stored shape from the grades offered + each grade's own division + extra divisions. */
export function buildSchoolConfig(schoolId: string, gradeIds: string[], layout: DivisionLayout): CampusSchoolConfig {
  const ids = [...layout.order];
  const add = (id: string) => { if (!ids.includes(id)) ids.push(id); };
  for (const g of gradeIds) { const d = layout.main.get(g); if (d) add(d); }
  layout.extra.forEach((_, d) => add(d));
  const divisions: CampusDivisionConfig[] = ids
    .map((divisionId) => ({
      divisionId,
      gradeIds: gradeIds.filter((g) => layout.main.get(g) === divisionId || (layout.extra.get(divisionId) || []).includes(g)),
    }))
    .filter((d) => d.gradeIds.length > 0);
  return { schoolId, gradeIds, divisions };
}

export function withMainDivision(layout: DivisionLayout, gradeId: string, divisionId: string | null): DivisionLayout {
  const main = new Map(layout.main);
  if (divisionId) main.set(gradeId, divisionId);
  else main.delete(gradeId);
  return { ...layout, main };
}

export function withExtraDivision(layout: DivisionLayout, divisionId: string, gradeIds: string[] | null): DivisionLayout {
  const extra = new Map(layout.extra);
  if (gradeIds && gradeIds.length) extra.set(divisionId, gradeIds);
  else extra.delete(divisionId);
  return { ...layout, extra };
}
