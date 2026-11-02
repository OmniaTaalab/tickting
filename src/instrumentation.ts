/**
 * Next.js instrumentation hook: runs once when a server instance starts.
 * Warms the ticket-summary cache so the first /api/ticket-summaries request after an
 * instance starts does not pay the bootstrap read. Failures are logged and ignored.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return; // never during `next build`
  try {
    const { adminDb } = await import('@/lib/firebaseAdmin');
    if (!adminDb) return;
    const { warmTicketSummaryCache } = await import('@/lib/server/ticket-summary-cache');
    warmTicketSummaryCache(adminDb);
  } catch (e: any) {
    console.error('[instrumentation] ticket summary cache warm-up skipped:', e?.message || e);
  }
}
