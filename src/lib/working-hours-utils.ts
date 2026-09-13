
import { format, parse, isSameDay, addDays, startOfDay, isBefore, isAfter, differenceInMinutes } from 'date-fns';
import type { WorkingHours } from './types';
import { DEFAULT_WORKING_HOURS } from './types';

/**
 * Checks if a given date (defaulting to now) is within the provided working hours config.
 * Forces comparison in Africa/Cairo timezone.
 */
export function isWithinWorkingHours(workingHours: WorkingHours | undefined, date: Date = new Date()): boolean {
    const hoursToUse = workingHours || DEFAULT_WORKING_HOURS;

    // Force Cairo Timezone for evaluation
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Africa/Cairo',
        weekday: 'long',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

    const parts = formatter.formatToParts(date);
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
 */
export function calculateWorkingHoursElapsed(start: Date, end: Date, workingHours: WorkingHours | undefined): number {
    const hoursToUse = workingHours || DEFAULT_WORKING_HOURS;

    if (isAfter(start, end)) return 0;

    let totalMinutes = 0;
    let currentDay = startOfDay(start);
    const lastDay = startOfDay(end);

    while (currentDay <= lastDay) {
        const dayName = format(currentDay, 'EEEE');
        const config = hoursToUse[dayName];

        if (config?.isOpen) {
            const workdayStart = parse(config.start, 'HH:mm', currentDay);
            const workdayEnd = parse(config.end, 'HH:mm', currentDay);

            // Determine intersection between (start, end) and (workdayStart, workdayEnd)
            const actualStart = isSameDay(currentDay, start) 
                ? (isAfter(start, workdayStart) ? start : workdayStart)
                : workdayStart;
            
            const actualEnd = isSameDay(currentDay, end)
                ? (isBefore(end, workdayEnd) ? end : workdayEnd)
                : workdayEnd;

            if (isBefore(actualStart, actualEnd)) {
                totalMinutes += Math.max(0, differenceInMinutes(actualEnd, actualStart));
            }
        }
        currentDay = addDays(currentDay, 1);
    }

    return totalMinutes / 60;
}

/**
 * Returns a human-readable string of working hours for a department.
 */
export function getWorkingHoursSummary(workingHours: WorkingHours | undefined): string {
    const hoursToUse = workingHours || DEFAULT_WORKING_HOURS;
    
    const summaries = Object.entries(hoursToUse)
        .filter(([_, config]) => config.isOpen)
        .map(([day, config]) => `${day.substring(0, 3)}: ${config.start}-${config.end}`);
    
    return summaries.length > 0 ? summaries.join(', ') : "Closed";
}
