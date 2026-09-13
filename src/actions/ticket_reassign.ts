'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { logSystemEvent } from '@/lib/system-log';
import type { UserProfile, Ticket } from '@/lib/types';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';

const ReassignTicketSchema = z.object({
  ticketId: z.string().min(1),
  newAssigneeId: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
});

export type ReassignTicketState = {
  errors?: { form?: string[] };
  message?: string | null;
  success: boolean;
};

export async function reassignTicketAction(
  prevState: ReassignTicketState,
  formData: FormData
): Promise<ReassignTicketState> {
  const db = adminDb;
  if (!db) {
    return { errors: { form: ['Firebase Admin not configured'] }, success: false };
  }

  const validatedFields = ReassignTicketSchema.safeParse({
    ticketId: formData.get('ticketId'),
    newAssigneeId: formData.get('newAssigneeId'),
    actorId: formData.get('actorId'),
    actorName: formData.get('actorName'),
  });

  if (!validatedFields.success) {
    return {
      errors: { form: ['Invalid data provided.'] },
      success: false,
    };
  }
  
  const { ticketId, newAssigneeId, actorId, actorName } = validatedFields.data;

  try {
    const ticketRef = db.collection('tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();

    if (!ticketDoc.exists) {
      return { errors: { form: ['Ticket not found.'] }, success: false };
    }

    const ticketData = ticketDoc.data() as Ticket;
    let newAssigneePayload: any = null;
    let newAssigneeName = 'Unassigned';
    let message = `Ticket successfully unassigned and moved to Queue status.`;
    
    const updates: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    if (newAssigneeId !== 'unassigned') {
        const newAssigneeRef = db.collection('users').doc(newAssigneeId);
        const newAssigneeDoc = await newAssigneeRef.get();

        if (!newAssigneeDoc.exists) {
            return { errors: { form: ['Assignee not found in user profiles.'] }, success: false };
        }
        
        const newAssigneeData = { id: newAssigneeDoc.id, ...newAssigneeDoc.data() } as UserProfile;
        
        newAssigneePayload = {
            userId: newAssigneeDoc.id,
            name: newAssigneeData.name,
            email: newAssigneeData.email,
            avatarUrl: newAssigneeData.avatarUrl,
        };
        newAssigneeName = newAssigneeData.name;
        message = `Ticket successfully reassigned to ${newAssigneeData.name} and moved to Open.`;

        // ANY REASSIGNMENT TO A HUMAN MAKES IT OPEN
        updates.status = 'Open';

        await db.collection('ticket-events').add({
            ticketId: ticketId,
            eventType: 'TICKET_STATUS_CHANGED',
            title: 'Ticket Reassigned',
            message: `Ticket "${ticketData.subject.substring(0, 30)}..." was reassigned to you.`,
            recipient: newAssigneeData.id,
            read: false,
            timestamp: FieldValue.serverTimestamp(),
        });
    } else {
        // UNASSIGNED -> QUEUE
        updates.status = 'Queue';
        newAssigneePayload = null;
    }

    updates.assignedTo = newAssigneePayload;

    await ticketRef.update(updates);

    await logSystemEvent({
      eventType: 'TICKET_REASSIGNED',
      actor: { userId: actorId, name: actorName },
      message: `${actorName} reassigned ticket "${ticketData.subject}" to ${newAssigneeName}.`,
      details: {
        ticketId: ticketId,
        ticketSubject: ticketData.subject,
        oldAssigneeId: ticketData.assignedTo?.userId,
        oldAssigneeName: ticketData.assignedTo?.name,
        newAssigneeId: newAssigneeId === 'unassigned' ? 'unassigned' : newAssigneeId,
        newAssigneeName: newAssigneeName,
        newStatus: updates.status || ticketData.status
      },
    });

    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/tickets');
    return {
      success: true,
      message,
    };
  } catch (error: any) {
    console.error('Error reassigning ticket:', error);
    return {
      errors: { form: [error.message] },
      message: 'Failed to reassign ticket.',
      success: false,
    };
  }
}
