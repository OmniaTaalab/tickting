'use server';

import { z } from 'zod';
import { adminDb, adminStorage } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Ticket, UserProfile, TicketStatus } from '@/lib/types';
import { logSystemEvent } from '@/lib/system-log';
import { redirect } from 'next/navigation';
import { getRoundRobinAssignee } from './ticket_assignment';
import { revalidatePath } from 'next/cache';

const AddReplySchema = z.object({
  ticketId: z.string().min(1, "Ticket ID is required"),
  replyText: z.string().min(1, "Reply text cannot be empty"),
  userId: z.string().min(1, "User ID is required"),
  isInternal: z.boolean().optional().default(false),
});

export type AddReplyState = {
  errors?: {
    form?: string[];
    ticketId?: string[];
    replyText?: string[];
  };
  message?: string | null;
  success?: boolean;
  newTicketId?: string;
};

function generateRandom4Digit() {
  return Math.floor(1000 + Math.random() * 9000);
}

export async function addTicketReplyAction(
  prevState: AddReplyState,
  formData: FormData
): Promise<AddReplyState> {
  const db = adminDb;
  const storage = adminStorage;
  
  if (!db || !storage) {
    return {
      errors: { form: ["Firebase Admin SDK not configured."] },
      message: 'Server configuration error.',
      success: false,
    };
  }

  const validatedFields = AddReplySchema.safeParse({
    ticketId: formData.get('ticketId'),
    replyText: formData.get('replyText'),
    userId: formData.get('userId'),
    isInternal: formData.get('isInternal') === 'true',
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Validation failed. Please check the fields.',
      success: false,
    };
  }

  const { ticketId, replyText, userId, isInternal } = validatedFields.data;
  
  // Handle attachments in reply
  const newAttachments: string[] = [];
  const attachmentFiles = formData.getAll('attachments');
  
  for (const entry of attachmentFiles) {
    if (!entry || !(entry instanceof File)) continue;
    if (entry.size === 0) continue;

    try {
      const buffer = Buffer.from(await entry.arrayBuffer());
      const fileName = `${Date.now()}_reply_${crypto.randomUUID()}_${entry.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const filePath = `attachments/${fileName}`;

      const bucket = storage.bucket();
      const fileRef = bucket.file(filePath);
      const token = crypto.randomUUID();

      await fileRef.save(buffer, {
        resumable: false,
        contentType: entry.type || 'application/octet-stream',
        metadata: {
          metadata: { firebaseStorageDownloadTokens: token },
        },
      });

      const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
      newAttachments.push(downloadUrl);
    } catch (e) {
      console.error("Upload error in reply:", e);
    }
  }

  const ticketRef = db.collection('tickets').doc(ticketId);
  let newTicketCreatedId: string | null = null;

  try {
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) {
        return { errors: { form: ['Ticket not found.'] }, message: 'Error', success: false };
    }
    const ticketData = ticketDoc.data() as Ticket;

    const isCreator = userId === ticketData.createdBy.userId;
    const isFinished = ticketData.status === 'Resolved' || ticketData.status === 'Closed';

    if (isFinished && isCreator) {
        const assignedUser = await getRoundRobinAssignee(ticketData.departmentId, ticketData.campusId);
        const status: TicketStatus = assignedUser ? 'Open' : 'Queue';
        const ticketNumber = generateRandom4Digit();
        const now = new Date();

        const newTicketPayload = {
            ticketNumber,
            subject: `Follow-up: ${ticketData.subject}`,
            description: replyText,
            status,
            priority: ticketData.priority || 'Normal',
            departmentId: ticketData.departmentId,
            departmentName: ticketData.departmentName,
            divisionId: ticketData.divisionId || null,
            divisionName: ticketData.divisionName || null,
            schoolId: ticketData.schoolId || null,
            schoolName: ticketData.schoolName || null, 
            campusId: ticketData.campusId || null,
            campusName: ticketData.campusName || null, 
            gradeId: ticketData.gradeId || null,
            gradeName: ticketData.gradeName || null,
            createdBy: ticketData.createdBy,
            assignedTo: assignedUser ? {
                userId: assignedUser.id,
                name: assignedUser.name,
                avatarUrl: assignedUser.avatarUrl,
            } : null,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            messages: [
                {
                    id: String(generateRandom4Digit()),
                    author: {
                        userId: ticketData.createdBy.userId,
                        name: ticketData.createdBy.name,
                        avatarUrl: ticketData.createdBy.avatarUrl,
                    },
                    text: replyText,
                    createdAt: now.toISOString(),
                    attachments: newAttachments,
                },
            ],
            parentTicketId: ticketId,
            mailboxEmail: ticketData.mailboxEmail || null,
            attachments: newAttachments,
        };

        const newTicketRef = await db.collection('tickets').add(newTicketPayload);
        newTicketCreatedId = newTicketRef.id;

        if (assignedUser) {
            await db.collection('ticket-events').add({
                ticketId: newTicketCreatedId,
                eventType: 'TICKET_CREATED',
                title: 'New Follow-up Assigned',
                message: `Follow-up ticket #${ticketNumber} assigned to you.`,
                recipient: assignedUser.id,
                read: false,
                timestamp: FieldValue.serverTimestamp(),
            });
        }
    } else {
        let replierName = 'User';
        let replierAvatar = `https://api.dicebear.com/9.x/initials/svg?seed=U&backgroundColor=1e40af`;
        let replierEmail = '';
        const isExternal = userId.startsWith('anon_') || userId.startsWith('email_');

        if (isExternal) {
            if (userId === ticketData.createdBy.userId) {
                replierName = ticketData.createdBy.name;
                replierAvatar = ticketData.createdBy.avatarUrl;
                replierEmail = ticketData.createdBy.email;
            } else {
                replierName = 'Guest User';
            }
        } else {
            const userDoc = await db.collection('users').doc(userId).get();
            if (userDoc.exists) {
                const profile = userDoc.data() as UserProfile;
                replierName = profile.name;
                replierAvatar = profile.avatarUrl;
                replierEmail = profile.email;
            }
        }

        const now = new Date();
        const newReply = {
          id: String(generateRandom4Digit()),
          author: { userId, name: replierName, avatarUrl: replierAvatar },
          text: replyText,
          createdAt: now.toISOString(),
          isInternal,
          source: isExternal ? 'portal-user' : 'agent',
          attachments: newAttachments,
        };

        const updates: Record<string, any> = {
          messages: FieldValue.arrayUnion(newReply),
          updatedAt: FieldValue.serverTimestamp(),
        };

        if (newAttachments.length > 0) {
            updates.attachments = FieldValue.arrayUnion(...newAttachments);
        }

        if (!isInternal) {
            // SPECIFIC REQUIREMENT: If ticket is QUEUE and any employee replies, auto-assign it.
            if (ticketData.status === 'Queue' && !isExternal) {
                updates.assignedTo = {
                    userId: userId,
                    name: replierName,
                    email: replierEmail,
                    avatarUrl: replierAvatar,
                };
                updates.status = 'Waiting'; // Moves from Queue to Waiting (waiting for parent now)
            } else {
                if (ticketData.status === 'Queue' && isExternal) {
                    updates.status = 'Queue'; // Stay in queue if parent replies before assignment
                } else {
                    if (isCreator && isExternal) updates.status = 'In Progress';
                    else if (!isExternal) updates.status = 'Waiting';
                }
            }
            
            if (!ticketData.firstRespondedAt && !isCreator) {
                updates.firstRespondedAt = FieldValue.serverTimestamp();
            }
        }

        await ticketRef.update(updates);
        
        await logSystemEvent({
            eventType: isInternal ? 'INTERNAL_NOTE_ADDED' : 'TICKET_REPLIED',
            actor: { userId, name: replierName },
            message: `${replierName} ${isInternal ? 'added an internal note to' : 'replied to'} Ticket #${ticketData.ticketNumber || ticketId.substring(0, 4)}.`,
            details: {
                ticketId,
                ticketNumber: ticketData.ticketNumber,
                isInternal,
                hasAttachments: newAttachments.length > 0,
                newStatus: updates.status || ticketData.status,
            }
        });

        // Notify current assignee or log the auto-assignment
        if (ticketData.status === 'Queue' && !isExternal) {
             await logSystemEvent({
                eventType: 'TICKET_AUTO_ASSIGNED',
                actor: { userId, name: replierName },
                message: `Ticket #${ticketData.ticketNumber || ticketId.substring(0,4)} auto-assigned to ${replierName} upon reply.`,
                details: { ticketId, assignedTo: userId }
            });
        }
        else if (ticketData.assignedTo && userId !== ticketData.assignedTo.userId) {
            await db.collection('ticket-events').add({
                ticketId,
                eventType: 'TICKET_REPLY',
                title: isInternal ? 'New Internal Note' : 'New Reply',
                message: `${replierName} replied to ticket.`,
                recipient: ticketData.assignedTo.userId,
                read: false,
                timestamp: FieldValue.serverTimestamp(),
            });
        }
    }

    revalidatePath(`/tickets/${ticketId}`);
    return { success: true, message: isInternal ? 'Internal note saved.' : 'Reply added successfully.' };
  } catch (error: any) {
    return { errors: { form: [error.message] }, message: 'Failed to process reply.', success: false };
  }
}
