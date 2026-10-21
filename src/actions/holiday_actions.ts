'use server';

import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { revalidatePath } from 'next/cache';
import { logSystemEvent } from '@/lib/system-log';
import type { OfficialHoliday } from '@/lib/types';
import { getCairoDateString } from '@/lib/working-hours-utils';
import { DayButton } from 'react-day-picker';

export interface SaveHolidayResult {
  success: boolean;
  message?: string;
  holidayId?: string;
}

/**
 * Creates or updates an official holiday.
 * Validates required fields and prevents duplicate active holidays on the same date.
 */
export async function saveOfficialHoliday(
  data: {
    id?: string;
    name: string;
    date: string;
    isActive: boolean;
    emailSubject: string;
    emailBody: string;
  },
  actor?: { userId: string; name: string }
): Promise<SaveHolidayResult> {
  try {
      const db = adminDb;

    if (!db) {
      return {
        success: false,
        message: 'Firebase Admin database is not initialized.',
      };
    }
    const name = data.name?.trim();

    const date = data.date?.trim();
    const emailSubject = data.emailSubject?.trim();
    const emailBody = data.emailBody?.trim();
    const isActive = data.isActive !== false;

    if (!name) {
      return { success: false, message: 'Holiday Name is required.' };
    }
    if (!date) {
      return { success: false, message: 'Holiday Date is required.' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { success: false, message: 'Invalid date format. Please use YYYY-MM-DD.' };
    }
    if (!emailSubject) {
      return { success: false, message: 'Auto Reply Email Subject is required.' };
    }
    if (!emailBody) {
      return { success: false, message: 'Auto Reply Email Body is required.' };
    }

    // Check for duplicate active holidays on the same date
    if (isActive) {
      const existingSnap = await db
        .collection('official_holidays')
        .where('date', '==', date)
        .where('isActive', '==', true)
        .get();

      const conflictingDoc = existingSnap.docs.find(doc => doc.id !== data.id);
      if (conflictingDoc) {
        const conflictData = conflictingDoc.data();
        return {
          success: false,
          message: `An active holiday already exists for this date: "${conflictData.name}". Please deactivate the existing holiday or select a different date.`,
        };
      }
    }

    const payload = {
      name,
      date,
      isActive,
      emailSubject,
      emailBody,
      updatedAt: FieldValue.serverTimestamp(),
    };

    let holidayId = data.id;

    if (holidayId) {
      await db.collection('official_holidays').doc(holidayId).update(payload);

      await logSystemEvent({
        eventType: 'OFFICIAL_HOLIDAY_UPDATED',
        actor: actor || { userId: 'admin', name: 'Administrator' },
        message: `Official holiday "${name}" (${date}) updated [${isActive ? 'Active' : 'Inactive'}].`,
        details: { holidayId, name, date, isActive },
      });
    } else {
      const newDocRef = await db.collection('official_holidays').add({
        ...payload,
        createdAt: FieldValue.serverTimestamp(),
      });
      holidayId = newDocRef.id;

      await logSystemEvent({
        eventType: 'OFFICIAL_HOLIDAY_CREATED',
        actor: actor || { userId: 'admin', name: 'Administrator' },
        message: `Official holiday "${name}" for date ${date} created [${isActive ? 'Active' : 'Inactive'}].`,
        details: { holidayId, name, date, isActive },
      });
    }

    revalidatePath('/settings');
    revalidatePath('/tickets');
    revalidatePath('/dashboard');

    return { success: true, holidayId };
  } catch (error: any) {
    console.error('Error saving official holiday:', error);
    return { success: false, message: error?.message || 'Database error while saving holiday.' };
  }
}

/**
 * Deletes an official holiday by ID.
 */
export async function deleteOfficialHoliday(
  id: string,
  actor?: { userId: string; name: string }
): Promise<{ success: boolean; message?: string }> {
  try {
  const db = adminDb;

    if (!db) {
      return {
        success: false,
        message: 'Firebase Admin database is not initialized.',
      };
    }

    const docRef = db.collection('official_holidays').doc(id);
        const snap = await docRef.get();
    const data = snap.data();

    await docRef.delete();

    await logSystemEvent({
      eventType: 'OFFICIAL_HOLIDAY_DELETED',
      actor: actor || { userId: 'admin', name: 'Administrator' },
      message: `Official holiday "${data?.name || id}" (${data?.date || 'N/A'}) deleted.`,
      details: { holidayId: id, name: data?.name, date: data?.date },
    });

    revalidatePath('/settings');
    revalidatePath('/tickets');
    revalidatePath('/dashboard');

    return { success: true };
  } catch (error: any) {
    console.error('Error deleting official holiday:', error);
    return { success: false, message: error?.message || 'Failed to delete official holiday.' };
  }
}

/**
 * Toggles the active status of an official holiday.
 */
export async function toggleOfficialHolidayStatus(
  id: string,
  isActive: boolean,
  actor?: { userId: string; name: string }
): Promise<{ success: boolean; message?: string }> {
  try {

    const db = adminDb;

    if (!db) {
      return {
        success: false,
        message: 'Firebase Admin database is not initialized.',
      };
    }

    const docRef = db.collection('official_holidays').doc(id);
        const snap = await docRef.get();
    if (!snap.exists) {
      return { success: false, message: 'Holiday not found.' };
    }
    const data = snap.data() as OfficialHoliday;

    if (isActive) {
      // Check for duplicate active holidays on the same date
      const existingSnap = await db.collection('official_holidays')
        .where('date', '==', data.date)
        .where('isActive', '==', true)
        .get();

      const conflictingDoc = existingSnap.docs.find(doc => doc.id !== id);
      if (conflictingDoc) {
        const conflictData = conflictingDoc.data();
        return {
          success: false,
          message: `Cannot activate: another active holiday "${conflictData.name}" already exists on ${data.date}.`,
        };
      }
    }

    await docRef.update({
      isActive,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await logSystemEvent({
      eventType: 'OFFICIAL_HOLIDAY_STATUS_CHANGED',
      actor: actor || { userId: 'admin', name: 'Administrator' },
      message: `Official holiday "${data.name}" (${data.date}) set to ${isActive ? 'Active' : 'Inactive'}.`,
      details: { holidayId: id, name: data.name, date: data.date, isActive },
    });

    revalidatePath('/settings');
    revalidatePath('/tickets');
    revalidatePath('/dashboard');

    return { success: true };
  } catch (error: any) {
    console.error('Error toggling official holiday status:', error);
    return { success: false, message: error?.message || 'Failed to update holiday status.' };
  }
}

/**
 * Fetches all official holidays securely via Server Action.
 */
export async function getOfficialHolidaysAction(): Promise<{ success: boolean; holidays?: OfficialHoliday[]; message?: string }> {

  try {
    const db = adminDb;

    if (!db) {
      return {
        success: false,
        message: 'Firebase Admin database is not initialized.',
      };
    }

    const snapshot = await db.collection('official_holidays').orderBy('date', 'desc').get();
        const holidays = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        date: data.date,
        isActive: data.isActive !== false,
        emailSubject: data.emailSubject,
        emailBody: data.emailBody,
        createdAt: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : data.createdAt,
        updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : data.updatedAt,
      } as OfficialHoliday;
    });
    return { success: true, holidays };
  } catch (error: any) {
    console.error('Error fetching official holidays action:', error);
    return { success: false, message: error?.message || 'Failed to fetch holidays' };
  }
}

