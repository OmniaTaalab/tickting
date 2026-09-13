'use client';

import { useUser as useFirebaseUser } from '../provider';
import type { UserHookResult } from '../provider';


export const useUser = (): UserHookResult => {
    return useFirebaseUser();
};
