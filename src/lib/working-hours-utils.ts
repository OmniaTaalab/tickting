import { format, parse, isSameDay, addDays, startOfDay, isBefore, isAfter, differenceInMinutes } from 'date-fns';
import type { WorkingHours, OfficialHoliday } from './types';
import { DEFAULT_WORKING_HOURS, WEEKDAYS } from './types';

// PERF: Intl.DateTimeFormat construction is expensive (~100us with a timeZone) and
// these functions run once per day per ticket inside SLA loops. Formatters are
// immutable and use an explicit locale + timeZone, so a lazily-created shared
// instance produces byte-identical output. Options must stay exactly as-is.
let cairoDateFormatter: Intl.DateTimeFormat | null = null;
function getCairoDateFormatter(): Intl.DateTimeFormat {
    if (!cairoDateFormatter) {
        cairoDateFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Africa/Cairo',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        });
    }
    return cairoDateFormatter;
}

let cairoWeekdayTimeFormatter: Intl.DateTimeFormat | null = null;
function getCairoWeekdayTimeFormatter(): Intl.DateTimeFormat {
    if (!cairoWeekdayTimeFormatter) {
        cairoWeekdayTimeFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Africa/Cairo',
            weekday: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
        });
    }
    return cairoWeekdayTimeFormatter;
}

/**
 * Returns date formatted as YYYY-MM-DD in Africa/Cairo timezone.
 */
export function getCairoDateString(date: Date = new Date()): string {
    const parts = getCairoDateFormatter().formatToParts(date);
    const year = parts.find(p => p.type === 'year')?.value || '1970';
    const month = parts.find(p => p.type === 'month')?.value || '01';
    const day = parts.find(p => p.type === 'day')?.value || '01';
    return `${year}-${month}-${day}`;
}

// Module-level cache for active official holidays (YYYY-MM-DD)
let globalActiveHolidays = new Set<string>();

/**
 * Updates the in-memory cache of active holiday date strings (YYYY-MM-DD).
 */
export function setActiveHolidaysCache(
    holidays: Array<OfficialHoliday | { date: string; isActive?: boolean } | string> | Set<string>
): void {
    const nextSet = new Set<string>();
    if (holidays instanceof Set) {
        holidays.forEach(d => nextSet.add(d));
    } else if (Array.isArray(holidays)) {
        holidays.forEach(h => {
            if (typeof h === 'string') {
                nextSet.add(h);
            } else if (h && (h.isActive === undefined || h.isActive === true)) {
                nextSet.add(h.date);
            }
        });
    }
    globalActiveHolidays = nextSet;
}

/**
 * Returns the current active holiday date strings set.
 */
export function getActiveHolidaysCache(): Set<string> {
    return globalActiveHolidays;
}

/**
 * Checks if a given date is an active official holiday in Africa/Cairo timezone.
 */
export function isHolidayDate(
    date: Date,
    holidays?: Array<OfficialHoliday | { date: string; isActive?: boolean } | string> | Set<string>
): boolean {
    const dateStr = getCairoDateString(date);
    if (holidays !== undefined) {
        if (holidays instanceof Set) {
            return holidays.has(dateStr);
        }
        if (Array.isArray(holidays)) {
            return holidays.some(h => {
                if (typeof h === 'string') return h === dateStr;
                return h.date === dateStr && (h.isActive === undefined || h.isActive === true);
            });
        }
    }
    return globalActiveHolidays.has(dateStr);
}

/**
 * Checks if a given date (defaulting to now) is within the provided working hours config.
 * Forces comparison in Africa/Cairo timezone.
 * Returns false if the date is an active Official Holiday.
 */
export function isWithinWorkingHours(
    workingHours: WorkingHours | undefined,
    date: Date = new Date(),
    holidays?: Array<OfficialHoliday | { date: string; isActive?: boolean } | string> | Set<string>
): boolean {
    // 1. Official Holiday Check: If date falls on an active holiday, whole day is OFF!
    if (isHolidayDate(date, holidays)) {
        return false;
    }

    const hoursToUse = workingHours || DEFAULT_WORKING_HOURS;

    // Force Cairo Timezone for evaluation
    const parts = getCairoWeekdayTimeFormatter().formatToParts(date);
    const dayName = parts.find(p => p.type === 'weekday')?.value || '';
    const hour = parts.find(p => p.type === 'hour')?.value || '00';
    const minute = parts.find(p => p.type === 'minute')?.value || '00';
    
    const currentTimeStr = `${hour}:${minute}`;
    const dayConfig = hoursToUse[dayName];

    if (!dayConfig || !dayConfig.isOpen) {
        return false;
    }

    // String comparison for HH:mm is safe and efficient
    return currentTimeStr >= dayConfig.start && currentTimeStr <= dayConfig.end;
}

/**
 * Calculates total WORKING hours elapsed between two dates based on department hours.
 * Skips weekends AND active Official Holidays.
 */
export function calculateWorkingHoursElapsed(
    start: Date,
    end: Date,
    workingHours: WorkingHours | undefined,
    holidays?: Array<OfficialHoliday | { date: string; isActive?: boolean } | string> | Set<string>
): number {
    const hoursToUse = workingHours || DEFAULT_WORKING_HOURS;

    if (isAfter(start, end)) return 0;

    let totalMinutes = 0;
    let currentDay = startOfDay(start);
    const lastDay = startOfDay(end);
    // currentDay is always a local midnight, so isSameDay(currentDay, start) is exactly
    // currentDay.getTime() === startOfDay(start).getTime() (and likewise for end).
    const startDayMs = currentDay.getTime();
    const lastDayMs = lastDay.getTime();
    // PERF: days that are neither the first nor the last day contribute a value that depends
    // only on (day, hours config, holiday set). Memoise those per day; first/last days keep
    // the full computation. Memo only on the global-holiday path (all app callers).
    const memo = holidays === undefined ? getFullDayMemo(hoursToUse) : null;

    while (currentDay <= lastDay) {
        const ms = currentDay.getTime();
        const isFirst = ms === startDayMs;
        const isLast = ms === lastDayMs;
        if (memo && !isFirst && !isLast) {
            let minutes = memo.get(ms);
            if (minutes === undefined) {
                minutes = workingMinutesOnDay(currentDay, hoursToUse, holidays, null, null);
                memo.set(ms, minutes);
            }
            totalMinutes += minutes;
        } else {
            totalMinutes += workingMinutesOnDay(currentDay, hoursToUse, holidays, isFirst ? start : null, isLast ? end : null);
        }
        currentDay = addDays(currentDay, 1);
    }

    return totalMinutes / 60;
}

/**
 * Working minutes contributed by one calendar day — the body of the original day loop.
 * `start` / `end` are passed only on the day they fall on (null otherwise), which is
 * exactly when the original code's isSameDay() checks were true.
 */
function workingMinutesOnDay(
    currentDay: Date,
    hoursToUse: WorkingHours,
    holidays: Array<OfficialHoliday | { date: string; isActive?: boolean } | string> | Set<string> | undefined,
    start: Date | null,
    end: Date | null
): number {
    // Exclude active Official Holidays from SLA calculation
    if (isHolidayDate(currentDay, holidays)) return 0;

    const dayName = format(currentDay, 'EEEE');
    const config = hoursToUse[dayName];

    if (config?.isOpen) {
        const workdayStart = parse(config.start, 'HH:mm', currentDay);
        const workdayEnd = parse(config.end, 'HH:mm', currentDay);

        // Determine intersection between (start, end) and (workdayStart, workdayEnd)
        const actualStart = start
            ? (isAfter(start, workdayStart) ? start : workdayStart)
            : workdayStart;

        const actualEnd = end
            ? (isBefore(end, workdayEnd) ? end : workdayEnd)
            : workdayEnd;

        if (isBefore(actualStart, actualEnd)) {
            return Math.max(0, differenceInMinutes(actualEnd, actualStart));
        }
    }
    return 0;
}

// Memo of full-day working minutes: holiday Set identity (replaced wholesale by
// setActiveHolidaysCache, never mutated) -> hours config CONTENT -> day midnight ms -> minutes.
const fullDayMemo = new WeakMap<object, Map<string, Map<number, number>>>();
const MAX_MEMO_CONFIGS = 64;

function getFullDayMemo(hoursToUse: WorkingHours): Map<number, number> | null {
    if (typeof hoursToUse !== 'object' || hoursToUse === null) return null;
    let byConfig = fullDayMemo.get(globalActiveHolidays);
    if (!byConfig) {
        byConfig = new Map();
        fullDayMemo.set(globalActiveHolidays, byConfig);
    }
    let key: string;
    try {
        key = JSON.stringify(hoursToUse);
    } catch {
        return null;
    }
    let perDay = byConfig.get(key);
    if (!perDay) {
        if (byConfig.size >= MAX_MEMO_CONFIGS) byConfig.clear();
        perDay = new Map();
        byConfig.set(key, perDay);
    }
    return perDay;
}

/**
 * Returns a human-readable string of working hours for a department.
 */
export function getWorkingHoursSummary(workingHours: WorkingHours | undefined): string {
    const hoursToUse = workingHours || DEFAULT_WORKING_HOURS;
    
    const summaries = WEEKDAYS
        .filter((day) => hoursToUse[day]?.isOpen)
        .map((day) => `${day.substring(0, 3)}: ${hoursToUse[day].start}-${hoursToUse[day].end}`);
    
    return summaries.length > 0 ? summaries.join(', ') : "Closed";
}
