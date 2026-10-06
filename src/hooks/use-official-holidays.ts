'use client';

import { useEffect, useState } from 'react';
import { useFirebase, useCollection, useMemoFirebase, useUser } from '@/firebase';
import { collection, query, orderBy } from 'firebase/firestore';
import type { OfficialHoliday } from '@/lib/types';
import { setActiveHolidaysCache } from '@/lib/working-hours-utils';
import { getOfficialHolidaysAction } from '@/actions/holiday_actions';

export function useOfficialHolidays() {
    const { firestore } = useFirebase();
    const { user, isUserLoading } = useUser();
    const [serverHolidays, setServerHolidays] = useState<OfficialHoliday[]>([]);

    const holidaysQuery = useMemoFirebase(() => {
        if (!firestore || isUserLoading || !user) return null;
        return query(collection(firestore, 'official_holidays'), orderBy('date', 'desc'));
    }, [firestore, user, isUserLoading]);

    const { data: clientHolidays, isLoading, error } = useCollection<OfficialHoliday>(holidaysQuery);

    useEffect(() => {
        getOfficialHolidaysAction().then(res => {
            if (res.success && res.holidays) {
                setServerHolidays(res.holidays);
                setActiveHolidaysCache(res.holidays.filter(h => h.isActive !== false));
            }
        }).catch(err => {
            console.error('Error fetching official holidays from server:', err);
        });
    }, []);

    const allHolidays = clientHolidays || serverHolidays;
    const activeHolidays = allHolidays.filter(h => h.isActive !== false);

    useEffect(() => {
        if (allHolidays.length > 0) {
            setActiveHolidaysCache(activeHolidays);
        }
    }, [allHolidays, activeHolidays]);

    return {
        allHolidays,
        activeHolidays,
        isLoading: isLoading && serverHolidays.length === 0,
        error
    };
}
