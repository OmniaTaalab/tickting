'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import { getRoundRobinAssignee } from './ticket_assignment';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

const TransferSchema = z.object({
  ticketId: z.string().min(1),
  newCategoryId: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type TransferState = {
  success: boolean;
  message?: string;
  errors?: { form?: string[] };
};

export async function transferTicketToCategoryAction(
  prevState: TransferState,
  formData: FormData
): Promise<TransferState> {
  const db = adminDb;
  if (!db) return { success: false, message: 'Database configuration error.' };

  const validated = TransferSchema.safeParse({
    ticketId: formData.get('ticketId'),
    newCategoryId: formData.get('newCategoryId'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validated.success) {
    return { success: false, message: 'Validation failed. Please check the selected category.' };
  }

  const { ticketId, newCategoryId, actorId, actorName } = validated.data;

  try {
    // 1. Get the new category details
    const categoryDoc = await db.collection('departments').doc(newCategoryId).get();
    if (!categoryDoc.exists) return { success: false, message: 'Selected category does not exist.' };
    const categoryName = categoryDoc.data()!.name;

    // Get current ticket to know the campus
    const ticketDoc = await db.collection('tickets').doc(ticketId).get();
    const ticketData = ticketDoc.data();
    const campusId = ticketData?.campusId;

    // 2. Get the next available assignee in that category via Round Robin
    const newAssignee = await getRoundRobinAssignee(newCategoryId, campusId);
    
    // If no one is available, the status becomes "Queue"
    const newStatus = newAssignee ? 'Open' : 'Queue';

    const updates: any = {
      departmentId: newCategoryId,
      departmentName: categoryName,
      assignedTo: newAssignee ? {
        userId: newAssignee.id,
        name: newAssignee.name,
        email: newAssignee.email || '',
        avatarUrl: newAssignee.avatarUrl,
      } : null,
      status: newStatus,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // 3. Update the ticket
    await db.collection('tickets').doc(ticketId).update(updates);

    // 4. Log the event
    await logSystemEvent({
      eventType: 'TICKET_TRANSFERRED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} transferred ticket to Category: "${categoryName}".`,
      details: { 
          ticketId, 
          newCategoryId, 
          newCategoryName: categoryName, 
          newAssigneeId: newAssignee?.id,
          newAssigneeName: newAssignee?.name
      }
    });

    // 5. Notify the new assignee if present via in-app event
    if (newAssignee) {
        // In-App Notification
        await db.collection('ticket-events').add({
            ticketId,
            eventType: 'TICKET_STATUS_CHANGED',
            title: 'New Transferred Ticket',
            message: `A ticket was transferred to your category and assigned to you.`,
            recipient: newAssignee.id,
            read: false,
            timestamp: FieldValue.serverTimestamp(),
        });
    }

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/tickets');
    
    return { 
        success: true, 
        message: `Successfully transferred to ${categoryName}. ${newAssignee ? `Assigned to ${newAssignee.name}.` : 'No staff available, moved to Queue.'}` 
    };
  } catch (e: any) {
    console.error('Transfer Error:', e);
    return { success: false, message: 'An unexpected error occurred: ' + e.message };
  }
}
