/**
 * "This browser just changed some tickets" signal.
 *
 * The server-paged tickets list refreshes itself on a timer; an action taken on the page
 * itself (bulk status change, bulk assign, bulk delete, auto-assign) should show up right
 * away. The code that performed the action calls notifyTicketsChanged(); the list hook
 * (src/hooks/use-tickets-view.ts) listens and re-asks the server.
 * Only this tab is notified, and nothing is read from or written to Firestore.
 */
export const TICKETS_CHANGED_EVENT = 'nis:tickets-changed';

export function notifyTicketsChanged(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event(TICKETS_CHANGED_EVENT));
  } catch {
    // never let a refresh hint break the action that triggered it
  }
}
