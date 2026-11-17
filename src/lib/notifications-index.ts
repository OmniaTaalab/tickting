/**
 * "Newest notifications first" needs the Firestore composite index
 *   ticket-events: recipient ASC, timestamp DESC
 * Until that index exists, Firestore rejects the query and the notification bell / page use
 * their previous queries instead. This remembers the rejection for the rest of the browser
 * session, so the failing query is tried once, not on every page. After the index has been
 * created, a page reload picks it up.
 */
let latestFirstUnavailable = false;

export function latestNotificationsUnavailable(): boolean {
  return latestFirstUnavailable;
}

export function markLatestNotificationsUnavailable(): void {
  latestFirstUnavailable = true;
}
