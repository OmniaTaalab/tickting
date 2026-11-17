/**
 * calculateWorkingHoursElapsed, evaluated the way a BROWSER IN A GIVEN TIME ZONE evaluates it.
 *
 * src/lib/working-hours-utils.ts walks the days between two instants with date-fns
 * (startOfDay, addDays, format 'EEEE', parse 'HH:mm'), all of which use the local time zone
 * of the machine running the code. In the browser that is the user's zone (Africa/Cairo for
 * the staff); on the server it is UTC, so the server cannot call that function and get the
 * numbers the user sees. This file performs the same steps, in the same order, for an
 * explicit IANA time zone, using plain arithmetic on a table of that zone's UTC-offset
 * changes. Verified to return bit-identical results to the original running with TZ set to
 * the same zone (every production ticket plus daylight-saving edge cases).
 *
 * It deliberately mirrors the original step by step, including what the JavaScript Date
 * object does when a local time does not exist or exists twice around a daylight-saving
 * change (the UTC offset in force BEFORE the change is used, per the language specification).
 *
 * Server-side use only (it is not needed in the browser, which has its own local time).
 */
import { parse } from 'date-fns';
import type { WorkingHours } from './types';
import { DEFAULT_WORKING_HOURS, WEEKDAYS } from './types';
import { getCairoDateString } from './working-hours-utils';

const MINUTE = 60_000;
const DAY = 86_400_000;

// ---- a time zone as a table of offset changes -------------------------------------------------
type Zone = {
  name: string;
  format: Intl.DateTimeFormat;
  /** Covered range [from, to): outside it offsets are asked from Intl directly. */
  from: number;
  to: number;
  /** Instants (ms) at which the UTC offset changes, ascending. */
  changes: number[];
  /** offsets[i] is the offset (ms, local - UTC) in force before changes[i]; the last one applies after the last change. */
  offsets: number[];
};

const zones = new Map<string, Zone>();
const MAX_ZONES = 40;

function intlOffset(format: Intl.DateTimeFormat, instant: number): number {
  const parts = format.formatToParts(new Date(instant));
  let y = 0, mo = 1, d = 1, h = 0, mi = 0, s = 0;
  for (const p of parts) {
    if (p.type === 'year') y = Number(p.value);
    else if (p.type === 'month') mo = Number(p.value);
    else if (p.type === 'day') d = Number(p.value);
    else if (p.type === 'hour') h = Number(p.value) % 24;
    else if (p.type === 'minute') mi = Number(p.value);
    else if (p.type === 'second') s = Number(p.value);
  }
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** Throws RangeError for a name Intl does not know. */
function getZone(timeZone: string): Zone {
  let zone = zones.get(timeZone);
  if (zone) return zone;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const from = Date.UTC(2015, 0, 1);
  const to = Date.UTC(new Date().getUTCFullYear() + 3, 0, 1);
  const changes: number[] = [];
  const offsets: number[] = [];
  let prevOffset = intlOffset(format, from);
  for (let t = from + DAY; t <= to; t += DAY) {
    const offset = intlOffset(format, t);
    if (offset !== prevOffset) {
      // the change happened in (t - DAY, t]: find the first second with the new offset
      let lo = t - DAY, hi = t;
      while (hi - lo > 1000) {
        const mid = lo + Math.floor((hi - lo) / 2000) * 1000;
        if (intlOffset(format, mid) === prevOffset) lo = mid; else hi = mid;
      }
      changes.push(hi);
      offsets.push(prevOffset);
      prevOffset = offset;
    }
  }
  offsets.push(prevOffset);
  zone = { name: timeZone, format, from, to, changes, offsets };
  if (zones.size >= MAX_ZONES) zones.clear();
  zones.set(timeZone, zone);
  return zone;
}

/** true when Intl accepts the name (the server refuses a request with any other). */
export function isSupportedTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.length > 64) return false;
  try {
    getZone(timeZone);
    return true;
  } catch {
    return false;
  }
}

function offsetAt(zone: Zone, instant: number): number {
  if (instant < zone.from || instant >= zone.to) return intlOffset(zone.format, instant);
  const { changes, offsets } = zone;
  let lo = 0, hi = changes.length; // first change strictly after `instant`
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (changes[mid] <= instant) lo = mid + 1; else hi = mid;
  }
  return offsets[lo];
}

type LocalFields = { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number; dow: number };

function localFields(zone: Zone, instant: number): LocalFields {
  const shifted = new Date(instant + offsetAt(zone, instant));
  return {
    y: shifted.getUTCFullYear(), mo: shifted.getUTCMonth(), d: shifted.getUTCDate(),
    h: shifted.getUTCHours(), mi: shifted.getUTCMinutes(), s: shifted.getUTCSeconds(), ms: shifted.getUTCMilliseconds(),
    dow: shifted.getUTCDay(),
  };
}

/**
 * new Date(y, mo, d, h, mi, s, ms) as a machine in `zone` computes it (ECMAScript UTC(t)):
 * a local time that does not exist, or exists twice, is read with the offset that was in
 * force before the change.
 */
function fromLocal(zone: Zone, y: number, mo: number, d: number, h: number, mi: number, s: number, ms: number): number {
  const local = Date.UTC(y, mo, d, h, mi, s, ms);
  const before = offsetAt(zone, local - DAY);
  const after = offsetAt(zone, local + DAY);
  if (before === after) return local - before;
  const withBefore = local - before;
  const withAfter = local - after;
  const beforeHolds = offsetAt(zone, withBefore) === before;
  const afterHolds = offsetAt(zone, withAfter) === after;
  return !beforeHolds && afterHolds ? withAfter : withBefore;
}

/** date-fns startOfDay: local date kept, time set to 00:00:00.000. */
function zonedStartOfDay(zone: Zone, instant: number): number {
  const f = localFields(zone, instant);
  return fromLocal(zone, f.y, f.mo, f.d, 0, 0, 0, 0);
}

/** date-fns addDays(date, 1): setDate(getDate() + 1), local time-of-day fields kept. */
function zonedAddDay(zone: Zone, instant: number): number {
  const f = localFields(zone, instant);
  return fromLocal(zone, f.y, f.mo, f.d + 1, f.h, f.mi, f.s, f.ms);
}

// "HH:mm" exactly as date-fns parse reads it (hour, minute) or null when it does not parse.
const clockCache = new Map<string, { h: number; mi: number } | null>();
const CLOCK_REFERENCE = new Date(2001, 0, 1);
function parseClock(text: unknown): { h: number; mi: number } | null {
  const key = String(text);
  let hit = clockCache.get(key);
  if (hit === undefined) {
    let parsed: Date;
    try {
      parsed = parse(text as string, 'HH:mm', CLOCK_REFERENCE);
    } catch {
      parsed = new Date(NaN);
    }
    hit = isNaN(parsed.getTime()) ? null : { h: parsed.getHours(), mi: parsed.getMinutes() };
    if (clockCache.size > 500) clockCache.clear();
    clockCache.set(key, hit);
  }
  return hit;
}

/** workingMinutesOnDay of the original, for the local day that `dayInstant` falls on. */
function minutesOnDay(
  zone: Zone,
  dayInstant: number,
  hoursToUse: WorkingHours,
  holidays: ReadonlySet<string>,
  start: number | null,
  end: number | null
): number {
  // Official holidays are whole days off; the original identifies the day by its Cairo date.
  if (holidays.size > 0 && holidays.has(getCairoDateString(new Date(dayInstant)))) return 0;

  const f = localFields(zone, dayInstant);
  const config = hoursToUse[WEEKDAYS[f.dow]];
  if (config?.isOpen) {
    const open = parseClock(config.start);
    const close = parseClock(config.end);
    const workdayStart = open ? fromLocal(zone, f.y, f.mo, f.d, open.h, open.mi, 0, 0) : NaN;
    const workdayEnd = close ? fromLocal(zone, f.y, f.mo, f.d, close.h, close.mi, 0, 0) : NaN;
    const actualStart = start !== null ? (start > workdayStart ? start : workdayStart) : workdayStart;
    const actualEnd = end !== null ? (end < workdayEnd ? end : workdayEnd) : workdayEnd;
    if (actualStart < actualEnd) {
      const minutes = Math.trunc((actualEnd - actualStart) / MINUTE);
      return Math.max(0, minutes === 0 ? 0 : minutes);
    }
  }
  return 0;
}

// Full days (neither the first nor the last day of an interval) depend only on the zone, the
// hours configuration, the holiday set and the day: remember them.
const fullDayMemo = new Map<string, Map<number, number>>();
const MAX_MEMO_KEYS = 200;
const holidayKeys = new WeakMap<object, string>();
function memoFor(zone: Zone, hoursToUse: WorkingHours, holidays: ReadonlySet<string>): Map<number, number> | null {
  let hoursKey: string;
  try {
    hoursKey = JSON.stringify(hoursToUse);
  } catch {
    return null;
  }
  let holidayKey = holidayKeys.get(holidays);
  if (holidayKey === undefined) {
    holidayKey = Array.from(holidays).sort().join(',');
    holidayKeys.set(holidays, holidayKey);
  }
  const key = `${zone.name}|${holidayKey}|${hoursKey}`;
  let perDay = fullDayMemo.get(key);
  if (!perDay) {
    if (fullDayMemo.size >= MAX_MEMO_KEYS) fullDayMemo.clear();
    perDay = new Map();
    fullDayMemo.set(key, perDay);
  }
  return perDay;
}

/**
 * Working hours between two instants, as calculateWorkingHoursElapsed(start, end,
 * workingHours, holidays) returns them in a browser whose time zone is `timeZone`.
 *
 * @param holidays  active official holidays as "YYYY-MM-DD" (the browser keeps the same
 *                  list in a module-level cache).
 * @throws RangeError if `timeZone` is not a zone Intl knows (check isSupportedTimeZone first).
 */
export function calculateWorkingHoursElapsedInZone(
  start: Date,
  end: Date,
  workingHours: WorkingHours | undefined,
  holidays: ReadonlySet<string>,
  timeZone: string
): number {
  const zone = getZone(timeZone);
  const hoursToUse = workingHours || DEFAULT_WORKING_HOURS;
  const startMs = start.getTime();
  const endMs = end.getTime();

  if (startMs > endMs) return 0;                    // isAfter(start, end)
  if (isNaN(startMs) || isNaN(endMs)) return 0;     // the original's loop never runs on an invalid date

  let totalMinutes = 0;
  let currentDay = zonedStartOfDay(zone, startMs);
  const lastDay = zonedStartOfDay(zone, endMs);
  const startDayMs = currentDay;
  const lastDayMs = lastDay;
  const memo = memoFor(zone, hoursToUse, holidays);

  while (currentDay <= lastDay) {
    const isFirst = currentDay === startDayMs;
    const isLast = currentDay === lastDayMs;
    if (memo && !isFirst && !isLast) {
      let minutes = memo.get(currentDay);
      if (minutes === undefined) {
        minutes = minutesOnDay(zone, currentDay, hoursToUse, holidays, null, null);
        if (memo.size > 5000) memo.clear();
        memo.set(currentDay, minutes);
      }
      totalMinutes += minutes;
    } else {
      totalMinutes += minutesOnDay(zone, currentDay, hoursToUse, holidays, isFirst ? startMs : null, isLast ? endMs : null);
    }
    currentDay = zonedAddDay(zone, currentDay);
  }

  return totalMinutes / 60;
}
