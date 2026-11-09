'use client';

import { getApp } from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';

/** Cloud Functions region used by functions/src/index.ts (v2 default). */
const FUNCTIONS_REGION = 'us-central1';

export type MailboxTestResult =
  | { ok: true; emailAddress: string; messagesTotal: number | null; inboxLast7Days: number; durationMs: number }
  | { ok: false; error: string; durationMs: number };

/**
 * Settings > Email Configurations > "Test connection".
 * Calls the admin-only `testMailboxConnection` callable, which impersonates the
 * mailbox with the Gmail service account exactly like the sync does.
 */
export async function testMailboxConnection(input: { email: string; mailboxId?: string }): Promise<MailboxTestResult> {
  const fns = getFunctions(getApp(), FUNCTIONS_REGION);
  const callable = httpsCallable<{ email: string; mailboxId?: string }, MailboxTestResult>(fns, 'testMailboxConnection');
  const res = await callable(input);
  return res.data;
}
