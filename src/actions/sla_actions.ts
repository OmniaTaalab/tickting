
'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import type { SLASettings } from '@/lib/types';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

export async function updateSLASettingsAction(
  settings: SLASettings,
  actor: { userId: string; name: string }
) {
  if (!adminDb) return { success: false, message: 'DB not configured' };

  try {
    await adminDb.collection('settings').doc('sla').set(settings);
    
    await logSystemEvent({
      eventType: 'SLA_SETTINGS_UPDATED',
      actor,
      message: `${actor.name} updated SLA response policies.`,
      details: { settings },
    });

    revalidatePath('/settings');
    revalidatePath('/dashboard');
    return { success: true, message: 'SLA policies updated successfully.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}
