const localParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
function parts(at: Date): number[] {
  const values = Object.fromEntries(localParts.formatToParts(at).map(p => [p.type, p.value]));
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(k => Number(values[k]));
}
function utc(values: number[]): number {
  const result = new Date(0);
  result.setUTCFullYear(values[0], values[1] - 1, values[2]);
  result.setUTCHours(values[3], values[4], values[5], 0);
  return result.getTime();
}
export function johannesburgNow(): string {
  const [year, month, day, hour, minute] = parts(new Date());
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
export function johannesburgToUtc(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Enter a valid Johannesburg date and time.');
  const target = match.slice(1).map(n => Number(n ?? 0));
  if (target[0] < 2 || target[0] > 9998) throw new Error('Supported years are 0002 to 9998.');
  const wall = utc(target);
  let instant = wall;
  for (let i = 0; i < 3; i++) instant += wall - utc(parts(new Date(instant)));
  if (parts(new Date(instant)).some((n, i) => n !== target[i])) throw new Error('This local date/time does not exist.');
  // Historical clock changes can make a local timestamp ambiguous. Never guess.
  for (const delta of [-3600000, 3600000]) {
    if (parts(new Date(instant + delta)).every((n, i) => n === target[i])) throw new Error('This historical local time is ambiguous. Use an explicit-offset API request.');
  }
  return new Date(instant).toISOString();
}
