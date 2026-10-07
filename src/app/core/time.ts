import { Temporal } from '@js-temporal/polyfill';
import { DAYS, Day } from './models';

export function localToDate(local: string, timeZone: string, occurrence: 'reject' | 'earlier' | 'later' = 'reject'): Date {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new Error('Choose a date and time.');
  try {
    const wallTime = Temporal.PlainDateTime.from(local);
    const zoned = wallTime.toZonedDateTime(timeZone, { disambiguation: occurrence });
    // An explicit occurrence choice must never normalize a nonexistent time.
    if (!zoned.toPlainDateTime().equals(wallTime)) throw new Error('Nonexistent time');
    return new Date(zoned.epochMilliseconds);
  } catch {
    throw new Error('This time is invalid, falls in a daylight-saving gap, or occurs twice. For a repeated hour, choose the earlier or later occurrence.');
  }
}
export function scheduleDay(local: string): Day {
  return DAYS[Temporal.PlainDateTime.from(local).dayOfWeek % 7];
}
export function dateInZone(date: Date, zone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(zone).toPlainDateTime().toString({ smallestUnit: 'minute' });
}
