export type ZonedDateParts = {
  year: number;
  month: number;
  day: number;
};

export const DEFAULT_TIME_ZONE = "UTC";

/** Return whether a value is a usable IANA time zone without consulting the host zone. */
export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US-u-ca-gregory", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

/** Resolve persisted profile time zones with one explicit, deterministic fallback. */
export function resolveTimeZone(value: string | null | undefined): string {
  return isValidTimeZone(value) ? value : DEFAULT_TIME_ZONE;
}

export function zonedDate(now: Date, timeZone: string): ZonedDateParts {
  if (!Number.isFinite(+now)) throw new Error("Invalid date");
  if (!isValidTimeZone(timeZone)) throw new RangeError(`Invalid time zone: ${timeZone}`);
  const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

export function addDays(date: ZonedDateParts, days: number): ZonedDateParts {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

export function formatDate(date: ZonedDateParts): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function calendarDayDistance(from: ZonedDateParts, to: ZonedDateParts): number {
  const start = Date.UTC(from.year, from.month - 1, from.day);
  const end = Date.UTC(to.year, to.month - 1, to.day);
  return Math.round((end - start) / 86_400_000);
}

export function formatInstant(value: string, timeZone?: string | null): string {
  const date = new Date(value);
  if (!Number.isFinite(+date)) return "an unknown date";
  const resolved = resolveTimeZone(timeZone);
  return date.toLocaleDateString("en-US", {
    timeZone: resolved,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}
