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

/** Format an instant with an explicit profile zone instead of the host zone. */
export function formatInstantWithOptions(
  value: string | number | Date,
  timeZone: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(+date)) return "an unknown date";
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: resolveTimeZone(timeZone),
  }).format(date);
}

export function formatInstantTime(value: string | number | Date, timeZone?: string | null): string {
  return formatInstantWithOptions(value, timeZone, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatInstant(value: string, timeZone?: string | null): string {
  return formatInstantWithOptions(value, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

type DateTimeLocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
};

const dateTimeLocalPattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;

function dateTimeLocalParts(value: string): DateTimeLocalParts {
  const match = dateTimeLocalPattern.exec(value);
  if (!match) throw new RangeError(`Invalid local date-time: ${value}`);
  const [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText = "0",
    millisecondsText = "0",
  ] = match.slice(1);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(millisecondsText.padEnd(3, "0"));
  const candidate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second, millisecond),
  );
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day ||
    candidate.getUTCHours() !== hour ||
    candidate.getUTCMinutes() !== minute ||
    candidate.getUTCSeconds() !== second ||
    candidate.getUTCMilliseconds() !== millisecond
  ) {
    throw new RangeError(`Invalid local date-time: ${value}`);
  }
  return { year, month, day, hour, minute, second, millisecond };
}

function dateTimeLocalKey(parts: DateTimeLocalParts): string {
  return [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
    String(parts.hour).padStart(2, "0"),
    String(parts.minute).padStart(2, "0"),
    String(parts.second).padStart(2, "0"),
    String(parts.millisecond).padStart(3, "0"),
  ].join("-");
}

function dateTimeLocalMilliseconds(parts: DateTimeLocalParts): number {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
}

function dateTimeLocalFormatter(timeZone: string) {
  return new Intl.DateTimeFormat("en-US-u-ca-gregory", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function partsForInstant(value: Date, timeZone: string): DateTimeLocalParts {
  const parts = dateTimeLocalFormatter(timeZone).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: number("year"),
    month: number("month"),
    day: number("day"),
    hour: number("hour"),
    minute: number("minute"),
    second: number("second"),
    millisecond: value.getUTCMilliseconds(),
  };
}

function offsetAt(value: Date, timeZone: string): number {
  const parts = partsForInstant(value, timeZone);
  const displayed = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  );
  return displayed - value.getTime();
}

function timeZoneOffsets(naive: Date, timeZone: string): number[] {
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(offsetAt(new Date(naive.getTime() + hours * 3_600_000), timeZone));
  }
  return [...offsets];
}

/**
 * Format an ISO instant for a datetime-local input in the persisted profile
 * zone. The result intentionally has no offset because that is the HTML
 * input's wall-clock contract.
 */
export function formatDateTimeLocal(
  value: string | Date | null | undefined,
  timeZone?: string | null,
  options?: { includeSeconds?: boolean },
): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(+date)) return "";
  const parts = partsForInstant(date, resolveTimeZone(timeZone));
  const result = `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
  return options?.includeSeconds
    ? `${result}:${String(parts.second).padStart(2, "0")}`
    : result;
}

/**
 * Convert a datetime-local wall clock into an ISO instant in an explicit
 * IANA profile zone. Ambiguous fall-back times choose the earlier instant;
 * nonexistent spring-forward times normalize forward to the nearest valid
 * wall clock, without consulting the host process timezone.
 */
export function parseDateTimeLocal(
  value: string,
  timeZone?: string | null,
): string {
  const parts = dateTimeLocalParts(value);
  const resolved = resolveTimeZone(timeZone);
  const naive = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
      parts.millisecond,
    ),
  );
  const requestedKey = dateTimeLocalKey(parts);
  const candidates = timeZoneOffsets(naive, resolved)
    .map((offset) => new Date(naive.getTime() - offset))
    .filter(
      (candidate) =>
        dateTimeLocalKey(partsForInstant(candidate, resolved)) === requestedKey,
    )
    .sort((left, right) => left.getTime() - right.getTime());
  if (candidates[0]) return candidates[0].toISOString();

  // A spring-forward wall clock does not exist. Pick the nearest represented
  // wall clock and prefer the forward side when the distance is tied.
  const nearest = timeZoneOffsets(naive, resolved)
    .map((offset) => new Date(naive.getTime() - offset))
    .sort((left, right) => {
      const leftDistance = Math.abs(
        dateTimeLocalMilliseconds(partsForInstant(left, resolved)) -
          dateTimeLocalMilliseconds(parts),
      );
      const rightDistance = Math.abs(
        dateTimeLocalMilliseconds(partsForInstant(right, resolved)) -
          dateTimeLocalMilliseconds(parts),
      );
      return leftDistance - rightDistance || right.getTime() - left.getTime();
    })[0];
  if (!nearest) throw new RangeError(`Unable to resolve local date-time: ${value}`);
  return nearest.toISOString();
}
