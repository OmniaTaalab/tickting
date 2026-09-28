'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { Ticket, UserProfile, Department } from '@/lib/types';
import { logSystemEvent } from '@/lib/system-log';
import { revalidatePath } from 'next/cache';

const ShareTicketSchema = z.object({
  ticketId: z.string().min(1, 'Ticket ID is required'),
  recipientEmail: z.string().email('Please enter a valid email address'),
  actorId: z.string().min(1, 'User ID is required'),
});

export type ShareTicketState = {
  errors?: {
    form?: string[];
    recipientEmail?: string[];
    ticketId?: string[];
  };
  message?: string | null;
  success: boolean;
};

const MAILBOX_MAPPING: Record<string, string> = {
  "1st Settlement": "accounting.1stsettlement@nis-egypt.com",
  "El-Sherouk": "accounting.shorouk@nis-egypt.com",
  "6th October": "accounting.6thoctober@nis-egypt.com",
  "Nasr City": "Accounting.NasrCity@nis-egypt.com",
  "New Capital International": "accounting.newcapital.int@nis-egypt.com",
  "New Capital National": "accounting.newcapital.national@nis-egypt.com",
  "Porto Said": "accounting.portosaid@nis-egypt.com",
};

function generateRandom4Digit() {
  return Math.floor(1000 + Math.random() * 9000);
}

function resolveDepartmentMailbox(ticket: Ticket, department?: Department | null): { mailboxEmail: string; departmentName: string } {
  const deptName = department?.name || ticket.departmentName || 'Support';
  
  // 1. Check if department document has explicit email
  const docEmail = (department as any)?.mailboxEmail || (department as any)?.email;
  if (docEmail && typeof docEmail === 'string' && docEmail.includes('@')) {
    return { mailboxEmail: docEmail.trim(), departmentName: deptName };
  }

  // 2. Check if ticket has a campus-specific accounting mailbox
  const cleanDeptName = deptName.toLowerCase();
  if (cleanDeptName.includes('account') && ticket.campusName && MAILBOX_MAPPING[ticket.campusName]) {
    return { mailboxEmail: MAILBOX_MAPPING[ticket.campusName], departmentName: deptName };
  }

  if (ticket.mailboxEmail && ticket.mailboxEmail.includes('@')) {
    return { mailboxEmail: ticket.mailboxEmail, departmentName: deptName };
  }

  // 3. Match known department slugs
  if (cleanDeptName.includes('it') || cleanDeptName.includes('tech')) {
    return { mailboxEmail: 'it.support@nis-egypt.com', departmentName: deptName };
  }
  if (cleanDeptName.includes('operation')) {
    return { mailboxEmail: 'operations@nis-egypt.com', departmentName: deptName };
  }
  if (cleanDeptName.includes('attendance')) {
    return { mailboxEmail: 'attendance@nis-egypt.com', departmentName: deptName };
  }
  if (cleanDeptName.includes('hr') || cleanDeptName.includes('human')) {
    return { mailboxEmail: 'hr@nis-egypt.com', departmentName: deptName };
  }
  if (cleanDeptName.includes('admission')) {
    return { mailboxEmail: 'admissions@nis-egypt.com', departmentName: deptName };
  }
  if (cleanDeptName.includes('data')) {
    return { mailboxEmail: 'data@nis-egypt.com', departmentName: deptName };
  }
  if (cleanDeptName.includes('website')) {
    return { mailboxEmail: 'website@nis-egypt.com', departmentName: deptName };
  }

  const slug = cleanDeptName.replace(/[^a-z0-9]/g, '');
  return { mailboxEmail: `${slug || 'support'}@nis-egypt.com`, departmentName: deptName };
}

function escapeHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export async function shareTicketViaEmailAction(
  prevState: ShareTicketState,
  formData: FormData
): Promise<ShareTicketState> {
  const db = adminDb;
  if (!db) {
    return {
      errors: { form: ['Firebase Admin SDK not initialized.'] },
      message: 'Server configuration error.',
      success: false,
    };
  }

  const validatedFields = ShareTicketSchema.safeParse({
    ticketId: formData.get('ticketId'),
    recipientEmail: formData.get('recipientEmail'),
    actorId: formData.get('actorId'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Please provide a valid recipient email address.',
      success: false,
    };
  }

  const { ticketId, recipientEmail, actorId } = validatedFields.data;
  const cleanRecipientEmail = recipientEmail.trim().toLowerCase();

  try {
    // 1. Authenticate & authorize actor (Must be Admin or Manager)
    const actorDoc = await db.collection('users').doc(actorId).get();
    if (!actorDoc.exists) {
      return {
        errors: { form: ['Unauthorized: User profile not found.'] },
        message: 'Permission denied: User profile not found.',
        success: false,
      };
    }

    const actorProfile = { id: actorDoc.id, ...actorDoc.data() } as UserProfile;
    if (actorProfile.role !== 'Admin' && actorProfile.role !== 'Manager') {
      return {
        errors: { form: ['Permission denied: Only Managers and Admins can share tickets via email.'] },
        message: 'Permission denied: Only Managers and Admins can share tickets via email.',
        success: false,
      };
    }

    // 2. Load ticket
    const ticketRef = db.collection('tickets').doc(ticketId);
    const ticketDoc = await ticketRef.get();
    if (!ticketDoc.exists) {
      return {
        errors: { form: ['Ticket not found.'] },
        message: 'Ticket not found.',
        success: false,
      };
    }

    const ticketData = { id: ticketDoc.id, ...ticketDoc.data() } as Ticket;

    // 3. Resolve department & department mailbox (FROM address)
    let departmentData: Department | null = null;
    if (ticketData.departmentId) {
      try {
        const deptDoc = await db.collection('departments').doc(ticketData.departmentId).get();
        if (deptDoc.exists) {
          departmentData = { id: deptDoc.id, ...deptDoc.data() } as Department;
        }
      } catch (err) {
        console.warn('Could not fetch department doc:', err);
      }
    }

    const { mailboxEmail: fromMailbox, departmentName } = resolveDepartmentMailbox(ticketData, departmentData);
    const senderHeader = `"${departmentName} Department - NIS Connect" <${fromMailbox}>`;

    // 4. Prepare email content
    const ticketNumberDisplay = ticketData.ticketNumber ? `#T-${ticketData.ticketNumber}` : `#T-${ticketData.id.slice(0, 6)}`;
    const ticketTitle = ticketData.title || ticketData.subject || 'Ticket Details';
    const emailSubject = `[${ticketNumberDisplay}] ${ticketTitle}`;

    // Filter public messages ONLY (Strictly exclude isInternal: true)
    const externalMessages = (ticketData.messages || []).filter(msg => !msg.isInternal);

    // Format date string safely
    let createdDateStr = 'N/A';
    if (ticketData.createdAt) {
      const d = typeof (ticketData.createdAt as any)?.toDate === 'function' 
        ? (ticketData.createdAt as any).toDate() 
        : new Date(ticketData.createdAt as any);
      if (!isNaN(d.getTime())) {
        createdDateStr = d.toLocaleString('en-US', {
          dateStyle: 'medium',
          timeStyle: 'short',
        });
      }
    }

    // Build message thread HTML
    let threadHtml = '';
    if (externalMessages.length > 0) {
      threadHtml = externalMessages.map((msg, idx) => {
        let msgDateStr = '';
        if (msg.createdAt) {
          const md = typeof (msg.createdAt as any)?.toDate === 'function'
            ? (msg.createdAt as any).toDate()
            : new Date(msg.createdAt as any);
          if (!isNaN(md.getTime())) {
            msgDateStr = md.toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
          }
        }

        const msgAttachmentsHtml = (msg.attachments && msg.attachments.length > 0)
          ? `<div style="margin-top: 8px; font-size: 12px;">
              <strong>Attachments:</strong>
              <ul style="margin: 4px 0 0 0; padding-left: 18px;">
                ${msg.attachments.map((url, aIdx) => `<li><a href="${url}" target="_blank" style="color: #1e3a8a; text-decoration: underline;">Attachment ${aIdx + 1}</a></li>`).join('')}
              </ul>
            </div>`
          : '';

        return `
          <div style="margin-bottom: 16px; padding: 12px 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; border-bottom: 1px solid #edf2f7; padding-bottom: 4px;">
              <strong style="color: #0f172a; font-size: 13px;">${escapeHtml(msg.author?.name || 'User')}</strong>
              <span style="color: #64748b; font-size: 11px;">${escapeHtml(msgDateStr)}</span>
            </div>
            <div style="color: #334155; font-size: 13px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(msg.text)}</div>
            ${msgAttachmentsHtml}
          </div>
        `;
      }).join('');
    }

    // Attachments section from ticket root
    let rootAttachmentsHtml = '';
    if (ticketData.attachments && ticketData.attachments.length > 0) {
      rootAttachmentsHtml = `
        <div style="margin-top: 16px; padding: 12px; background-color: #f1f5f9; border-radius: 8px;">
          <strong style="font-size: 12px; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">Ticket Attachments:</strong>
          <ul style="margin: 6px 0 0 0; padding-left: 18px; font-size: 13px;">
            ${ticketData.attachments.map((att, i) => {
              const url = typeof att === 'string' ? att : att.url;
              const name = typeof att === 'string' ? `Attachment ${i + 1}` : (att.name || `Attachment ${i + 1}`);
              return `<li><a href="${url}" target="_blank" style="color: #1e3a8a; font-weight: bold; text-decoration: underline;">${escapeHtml(name)}</a></li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(emailSubject)}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f1f5f9; margin: 0; padding: 24px; color: #334155;">
  <div style="max-width: 680px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06); border: 1px solid #e2e8f0;">
    
    <!-- Header -->
    <div style="background-color: #1e3a8a; color: #ffffff; padding: 24px 28px;">
      <div style="font-size: 11px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; color: #93c5fd; margin-bottom: 4px;">
        NIS Connect • Ticket Details
      </div>
      <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff; line-height: 1.3;">
        ${escapeHtml(ticketTitle)}
      </h1>
      <div style="margin-top: 8px; font-size: 13px; font-weight: 600; color: #e0e7ff;">
        ${escapeHtml(ticketNumberDisplay)}
      </div>
    </div>

    <!-- Body -->
    <div style="padding: 24px 28px;">
      
      <!-- Metadata Grid -->
      <table style="width: 100%; border-collapse: collapse; margin-bottom: 24px; font-size: 13px;">
        <tbody>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold; width: 35%;">Status:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: bold;">
              <span style="display: inline-block; padding: 2px 8px; background-color: #e0e7ff; color: #1e3a8a; border-radius: 4px; font-size: 12px;">
                ${escapeHtml(ticketData.status)}
              </span>
            </td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Department / Category:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(departmentName)}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Priority:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(ticketData.priority || 'Normal')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Channel:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(ticketData.channel || 'Email')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Assigned Tech / Staff:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(ticketData.assignedTo?.name || 'Unassigned')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Campus:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(ticketData.campusName || 'N/A')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Division:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(ticketData.divisionName || 'N/A')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Grade:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(ticketData.gradeName || 'N/A')}</td>
          </tr>
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Requester / Parent:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">
              ${escapeHtml(ticketData.parentName || ticketData.createdBy?.name || 'N/A')}
              ${ticketData.parentEmail ? `<br><span style="color: #64748b; font-size: 12px;">${escapeHtml(ticketData.parentEmail)}</span>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Created Date:</td>
            <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${escapeHtml(createdDateStr)}</td>
          </tr>
        </tbody>
      </table>

      <!-- Description / Request -->
      <div style="margin-bottom: 24px;">
        <h3 style="font-size: 14px; font-weight: 800; text-transform: uppercase; color: #1e3a8a; margin: 0 0 8px 0; letter-spacing: 0.5px;">
          Original Description
        </h3>
        <div style="padding: 14px 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 13px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${escapeHtml(ticketData.description || 'No description provided.')}</div>
      </div>

      ${rootAttachmentsHtml}

      <!-- Conversation History (Public Only) -->
      ${threadHtml ? `
        <div style="margin-top: 28px;">
          <h3 style="font-size: 14px; font-weight: 800; text-transform: uppercase; color: #1e3a8a; margin: 0 0 12px 0; letter-spacing: 0.5px;">
            Conversation History
          </h3>
          ${threadHtml}
        </div>
      ` : ''}

    </div>

    <!-- Footer -->
    <div style="background-color: #f8fafc; padding: 18px 28px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 12px; color: #64748b;">
      <p style="margin: 0 0 4px 0;">This email was shared via NIS Connect Support Portal.</p>
      <p style="margin: 0; font-weight: 600; color: #1e3a8a;">${escapeHtml(senderHeader)}</p>
    </div>

  </div>
</body>
</html>
    `;

    const plainText = `
NIS Connect • Ticket Details
${ticketNumberDisplay}: ${ticketTitle}
--------------------------------------------------
Status: ${ticketData.status}
Department: ${departmentName}
Priority: ${ticketData.priority || 'Normal'}
Channel: ${ticketData.channel || 'Email'}
Assigned Tech: ${ticketData.assignedTo?.name || 'Unassigned'}
Campus: ${ticketData.campusName || 'N/A'}
Division: ${ticketData.divisionName || 'N/A'}
Grade: ${ticketData.gradeName || 'N/A'}
Requester: ${ticketData.parentName || ticketData.createdBy?.name || 'N/A'} (${ticketData.parentEmail || ticketData.createdBy?.email || 'N/A'})
Created Date: ${createdDateStr}
From Mailbox: ${fromMailbox}

--------------------------------------------------
Original Description:
${ticketData.description || 'No description provided.'}

--------------------------------------------------
This email was shared via NIS Connect Support Portal by ${actorProfile.name}.
    `.trim();

    // 5. Send/Queue the email in Firestore 'mail' collection (Firebase Trigger Email extension standard)
    await db.collection('mail').add({
      to: [cleanRecipientEmail],
      from: senderHeader,
      replyTo: fromMailbox,
      message: {
        subject: emailSubject,
        html: emailHtml,
        text: plainText,
      },
      metadata: {
        ticketId: ticketId,
        ticketNumber: ticketData.ticketNumber || null,
        sharedBy: {
          userId: actorProfile.id || actorId,
          name: actorProfile.name,
          email: actorProfile.email || '',
        },
        fromMailbox,
        departmentName,
      },
      createdAt: FieldValue.serverTimestamp(),
    });

    // 6. Create REAL Internal Note in the ticket conversation
    const now = new Date();
    const actorAvatar = actorProfile.avatarUrl || `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(actorProfile.name)}&backgroundColor=1e40af`;

    const shareInternalNote = {
      id: String(generateRandom4Digit()),
      author: {
        userId: actorProfile.id || actorId,
        name: actorProfile.name,
        avatarUrl: actorAvatar,
      },
      text: `Shared this ticket via email with ${cleanRecipientEmail}`,
      createdAt: now.toISOString(),
      isInternal: true,
      source: 'agent',
      attachments: [],
    };

    await ticketRef.update({
      messages: FieldValue.arrayUnion(shareInternalNote),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 7. Audit log in system events
    await logSystemEvent({
      eventType: 'TICKET_SHARED',
      actor: { userId: actorProfile.id || actorId, name: actorProfile.name },
      message: `${actorProfile.name} shared ticket "${ticketTitle}" via email with ${cleanRecipientEmail}.`,
      details: {
        ticketId,
        ticketNumber: ticketData.ticketNumber || null,
        recipientEmail: cleanRecipientEmail,
        departmentId: ticketData.departmentId,
        departmentName,
        fromMailbox,
      },
    });

    // 8. Revalidate paths
    revalidatePath(`/tickets/${ticketId}`);
    revalidatePath('/tickets');

    return {
      success: true,
      message: 'Ticket shared successfully',
    };
  } catch (error: any) {
    console.error('Error sharing ticket via email:', error);
    return {
      errors: { form: [error.message || 'Failed to share ticket via email.'] },
      message: error.message || 'Failed to share ticket via email.',
      success: false,
    };
  }
}
