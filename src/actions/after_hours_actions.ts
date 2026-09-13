
'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import type { AfterHoursEmailSettings } from '@/lib/types';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

export async function updateAfterHoursEmailAction(
  settings: AfterHoursEmailSettings,
  actor: { userId: string; name: string },
  departmentId?: string // Optional: Update for a specific department
) {
  if (!adminDb) return { success: false, message: 'Database configuration error.' };

  try {
    if (departmentId && departmentId !== 'global') {
        // Update per-department settings
        await adminDb.collection('departments').doc(departmentId).update({
            afterHoursEmail: settings
        });
    } else {
        // Update global settings
        await adminDb.collection('settings').doc('afterHoursTicketEmail').set(settings);
    }
    
    await logSystemEvent({
      eventType: 'AFTER_HOURS_EMAIL_SETTINGS_UPDATED',
      actor,
      message: `${actor.name} updated the after-hours email template${departmentId && departmentId !== 'global' ? ` for department ${departmentId}` : ''}.`,
      details: { settings, departmentId },
    });

    revalidatePath('/settings');
    return { success: true, message: 'Email template updated successfully.' };
  } catch (error: any) {
    console.error("Failed to update after-hours settings:", error);
    return { success: false, message: error.message };
  }
}
