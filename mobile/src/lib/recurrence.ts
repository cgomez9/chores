export type Recurrence =
  | { type: 'once'; due: string }
  | { type: 'daily' }
  | { type: 'weekly'; days: number[] };

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatRecurrence(rec: Recurrence): string {
  if (rec.type === 'once') {
    const d = new Date(rec.due + 'T00:00:00Z');
    return `Once on ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`;
  }
  if (rec.type === 'daily') return 'Daily';
  if (rec.type === 'weekly') {
    if (rec.days.length === 7) return 'Every day';
    return [...rec.days].sort((a, b) => a - b).map((d) => DAY_LABELS[d]).join(' · ');
  }
  return 'Unknown';
}
