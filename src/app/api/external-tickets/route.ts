
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { getRoundRobinAssignee } from '@/actions/ticket_assignment';
import { FieldValue } from 'firebase-admin/firestore';
import { isWithinWorkingHours } from '@/lib/working-hours-utils';

const MAILBOX_MAPPING: Record<string, string> = {
    "1st Settlement": "accounting.1stsettlement@nis-egypt.com",
    "El-Sherouk": "accounting.shorouk@nis-egypt.com",
    "6th October": "accounting.6thoctober@nis-egypt.com",
    "Nasr City": "Accounting.NasrCity@nis-egypt.com",
    "New Capital International": "accounting.newcapital.int@nis-egypt.com",
    "New Capital National": "accounting.newcapital.national@nis-egypt.com",
    "Porto Said": "accounting.portosaid@nis-egypt.com",
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const db = adminDb;

        if (!db) {
            return NextResponse.json({ error: 'Database connection error' }, { status: 500 });
        }

        const {
            ticketNumber,
            subject,
            description,
            departmentId,
            departmentName,
            parentName,
            parentEmail,
            createdBy,
            campus,
            school,
            division,
            grade,
            messages,
            attachments,
            priority,
            channel,
            source,
            status: externalStatus
        } = body;

        if (!departmentId) {
            return NextResponse.json({ error: 'departmentId is required for auto-assignment' }, { status: 400 });
        }

        // 1. Fetch Department to check working hours
        const deptDoc = await db.collection('departments').doc(departmentId).get();
        const deptData = deptDoc.exists ? deptDoc.data() : null;
        
        const isNowWorking = isWithinWorkingHours(deptData?.workingHours);
        
        // 2. Automated Assignment Logic
        let assignedUser = null;
        let finalStatus = externalStatus || 'Queue';

        if (isNowWorking) {
            assignedUser = await getRoundRobinAssignee(departmentId, campus?.id);
            if (assignedUser) {
                finalStatus = externalStatus || 'Open';
            }
        }

        const finalTicketNumber = ticketNumber || Math.floor(1000 + Math.random() * 9000);
        const finalSubject = subject || 'No Subject';

        // Normalize channel name
        const normalizeChannel = (c: string) => {
            if (!c) return 'Web';
            const lower = c.toLowerCase().trim();
            const map: Record<string, string> = {
                'email': 'Email',
                'phone': 'Phone',
                'walk-in': 'Walk-in',
                'social media': 'Social Media',
                'web': 'Web',
                'website': 'Web',
                'form': 'Form'
            };
            return map[lower] || c;
        };

        const finalChannel = normalizeChannel(channel);
        const campusNameValue = campus?.name || null;
        const mailboxEmail = campusNameValue ? MAILBOX_MAPPING[campusNameValue] : null;
        const finalAttachments = attachments || [];
        
        // Ensure attachments are inside the messages for UI visibility
        let finalMessages = messages || [];
        const creatorInfo = {
            userId: createdBy?.userId || 'external_system',
            name: createdBy?.name || parentName || 'External API', // Prioritize parent name if creator name is missing
            email: createdBy?.email || parentEmail || '',
            avatarUrl: createdBy?.avatarUrl || ''
        };

        if (finalMessages.length === 0) {
            finalMessages = [{
                id: String(Math.floor(1000 + Math.random() * 9000)),
                author: creatorInfo,
                text: description || finalSubject || '',
                createdAt: new Date().toISOString(),
                source: 'api',
                attachments: finalAttachments
            }];
        } else {
            // Ensure first message has attachments if they were sent at root
            if (finalAttachments.length > 0 && (!finalMessages[0].attachments || finalMessages[0].attachments.length === 0)) {
                finalMessages[0].attachments = finalAttachments;
            }
        }

        const ticketPayload = {
            ticketNumber: finalTicketNumber,
            title: finalSubject,
            subject: finalSubject,
            description: description || '',
            status: finalStatus,
            priority: priority || 'Normal',
            channel: finalChannel,
            source: source || 'api', 
            departmentId,
            departmentName: departmentName || deptData?.name || 'General',
            campusId: campus?.id || null,
            campusName: campusNameValue,
            schoolId: school?.id || null,
            schoolName: school?.name || null,
            divisionId: division?.id || null,
            divisionName: division?.name || (division?.divisionName) || null,
            gradeId: grade?.id || null,
            gradeName: grade?.name || (grade?.gradeName) || null,
            parentName: parentName || 'Unknown',
            parentEmail: parentEmail || 'Unknown',
            mailboxEmail: mailboxEmail,
            createdBy: creatorInfo,
            assignedTo: assignedUser ? {
                userId: assignedUser.id,
                name: assignedUser.name,
                email: assignedUser.email || '',
                avatarUrl: assignedUser.avatarUrl,
            } : null,
            assignedAt: assignedUser ? FieldValue.serverTimestamp() : null,
            attachments: finalAttachments,
            messages: finalMessages,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        };

        const docRef = await db.collection('tickets').add(ticketPayload);

        if (assignedUser) {
            await db.collection('ticket-events').add({
                ticketId: docRef.id,
                eventType: 'TICKET_CREATED',
                title: 'New API Ticket Assigned',
                message: `Ticket #${finalTicketNumber} from external system assigned to you.`,
                recipient: assignedUser.id,
                read: false,
                timestamp: FieldValue.serverTimestamp(),
            });
        }

        return NextResponse.json({ 
            success: true, 
            ticketId: docRef.id, 
            assignedTo: assignedUser?.name || 'Unassigned (After hours or Busy)' 
        }, { status: 201 });

    } catch (error: any) {
        console.error('External API Processing Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
