/**
 * Grade names are written with a space between the word and the number: "Grade 1", "Year 3".
 *
 * A ticket keeps the grade name as it was when the ticket was created, and older tickets
 * carry the previous spelling ("Grade1", "Year3"). Stored names go through this before they
 * are shown, so old and new tickets read the same. Any other name is returned unchanged.
 *
 * Matching (auto-assignment, email routing) does not depend on this: it compares names with
 * the space removed, see normalizeScope in src/actions/ticket_assignment.ts and
 * normalizeRoutingText in functions/src/index.ts.
 */
export function formatGradeName(name: string | null | undefined): string {
  const text = typeof name === 'string' ? name.trim() : '';
  const match = /^(grade|year)\s*(\d+)$/i.exec(text);
  if (!match) return text;
  const word = match[1];
  return `${word[0].toUpperCase()}${word.slice(1).toLowerCase()} ${match[2]}`;
}
