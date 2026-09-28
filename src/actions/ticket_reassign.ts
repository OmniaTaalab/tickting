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

    // Check authority: Non-admins cannot reassign tickets of other departments
    const actorDoc = await db.collection('users').doc(actorId).get();
    if (actorDoc.exists) {
      const actorProfile = actorDoc.data() as UserProfile;
      if (actorProfile.role !== 'Admin') {
        if (ticketData.departmentId && actorProfile.departmentId !== ticketData.departmentId) {
          return {
            errors: { form: [`Permission denied: This ticket belongs to ${ticketData.departmentName || 'another department'}. Transferred tickets are read-only.`] },
            message: 'Permission denied: This ticket belongs to another department.',
            success: false,
          };
        }
      }
    }

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
        updates.assignedAt = FieldValue.serverTimestamp();

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
        updates.assignedAt = FieldValue.delete();
        newAssigneePayload = null;
    }

    updates.assignedTo = newAssigneePayload;

    // Synchronize latest transfer record with new assignee
    try {
      const transfersSnapshot = await db.collection('ticket-transfers')
        .where('ticketId', '==', ticketId)
        .orderBy('transferredAt', 'desc')
        .limit(1)
        .get();

      if (!transfersSnapshot.empty) {
        const latestTransferDoc = transfersSnapshot.docs[0];
        const transferData = latestTransferDoc.data();
        if (transferData.toDepartmentId === ticketData.departmentId) {
          await latestTransferDoc.ref.update({
            toUser: newAssigneePayload,
          });
        }
      }

      // Also update in-ticket transferHistory array if present
      if (Array.isArray(ticketData.transferHistory) && ticketData.transferHistory.length > 0) {
        const updatedHistory = [...ticketData.transferHistory];
        const lastIndex = updatedHistory.length - 1;
        if (updatedHistory[lastIndex].toDepartmentId === ticketData.departmentId) {
          updatedHistory[lastIndex] = {
            ...updatedHistory[lastIndex],
            toUser: newAssigneePayload,
          };
          updates.transferHistory = updatedHistory;
        }
      }
    } catch (err) {
      console.error('Error synchronizing transfer record assignee:', err);
    }

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
