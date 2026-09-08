import type { Class } from "../domain/contracts";
import { addDays, formatDate, zonedDate } from "../domain/time-zone";

export type CaptureConfidence = "high" | "medium" | "low";
export type CaptureObjectType =
  | "assignment"
  | "syllabus"
  | "worksheet"
  | "graded-assessment"
  | "rubric"
  | "lecture-slide"
  | "handwritten-note"
  | "timetable"
  | "teacher-message"
  | "web-page"
  | "unknown";
export type CaptureField =
  | "title"
  | "classId"
  | "deadline"
  | "minutes"
  | "resources"
  | "objectType";

export type CaptureUncertainty = {
  field: CaptureField;
  message: string;
  candidates?: string[];
};

export type CapturedDeadline = {
  /** A literal date, or the candidate interpretation of relative text. */
  date: string | null;
  /** Present only when the source contains an explicit time. */
  time: string | null;
  /** Canonical instant only when the paste states Z or a numeric UTC offset. */
  instant: string | null;
  timeZone: string;
  candidates: string[];
  sourceText: string[];
  requiresConfirmation: boolean;
};

export type CaptureDraft = {
  title: string;
  classId: string | null;
  objectType: CaptureObjectType;
  deadline: CapturedDeadline | null;
  minutes: number | null;
  resources: string[];
  confidence: Record<CaptureField, CaptureConfidence>;
  uncertainties: CaptureUncertainty[];
  provenance: {
    source: "pasted-text" | "text-file";
    sourceName?: string;
    authority: "user-provided-text";
    capturedAt: string;
    originalText: string;
    sourceText: string;
    lineNumber: number | null;
  };
};

export type CaptureContext = {
  classes: readonly Class[];
  now: Date;
  /** Required so relative dates never depend on the machine running the parser. */
  timeZone: string;
  sourceName?: string;
  /** Existing foreground/session class context, used only as a reviewable hint. */
  contextClassId?: string;
};

type Segment = { text: string; lineNumber: number | null };
type DateEvidence = {
  date: string;
  source: string;
  explicit: boolean;
  requiresConfirmation?: boolean;
};

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g;
const ISO_DATE_TIME =
  /\b\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?\b/i;
const ISO_DATE_TIME_ALL =
  /\b(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/gi;
const RELATIVE_DATE =
  /\b(?:(?:this|next)\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b(?:today|tomorrow)\b/gi;
const MONTH_DATE =
  /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,\s*(\d{4}))?\b/gi;
const EXPLICIT_TIME =
  /\b(?:at|by)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(?:at|by)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i;
const DURATION =
  /\b(?:(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|h)(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|min|m))?|(\d+)\s*(?:minutes?|mins?|min|m))\b/gi;
const URL_TOKEN = /\b(?:[a-z][a-z\d+.-]*:\/\/|javascript:)[^\s<>"']+/gi;

/**
 * Classifies a capture into a small semantic hint for Inbox review. This is
 * deliberately deterministic and advisory: the original capture, V1
 * provenance and confidence policy remain authoritative.
 */
export function classifyCaptureText(
  text: string,
  sourceName?: string,
): { type: CaptureObjectType; confidence: CaptureConfidence } {
  const value = `${text}\n${sourceName ?? ""}`.toLocaleLowerCase("en-US");
  const filename = (sourceName ?? "").toLocaleLowerCase("en-US");
  const isImage = /\.(?:png|jpe?g|heic|webp|gif|bmp|tiff?)$/.test(filename);

  if (
    /\b(?:score\s*\d+\s*\/\s*\d+|teacher\s+marks?|teacher\s+comments?|marked\s+incorrect|graded\s+assessment|graded\s+test)\b/.test(
      value,
    )
  )
    return { type: "graded-assessment", confidence: "high" };
  if (
    /\b(?:from\s+(?:dr\.?|mr\.?|mrs\.?|ms\.?|prof\.?|teacher)|teacher\s+e-?mail|email\s+from)\b/.test(
      value,
    ) || /(?:^|[-_])(?:teacher|professor)[-_]?email/.test(filename)
  )
    return { type: "teacher-message", confidence: "high" };
  if (
    /\b(?:syllabus|course\s+outline|grading\s+policy|office\s+hours|course\s+policies)\b/.test(
      value,
    )
  )
    return { type: "syllabus", confidence: "high" };
  if (/\b(?:timetable|schedule|period\s+\d+|room\s+\w+)\b/.test(value))
    return { type: "timetable", confidence: "high" };
  if (
    /\b(?:rubric|criteria|points\s+breakdown|grading\s+criteria)\b/.test(
      value,
    )
  )
    return { type: "rubric", confidence: "high" };
  if (
    /\b(?:lecture\s+slides?|slide\s+deck|presentation\s+slides?)\b/.test(
      value,
    )
  )
    return { type: "lecture-slide", confidence: "high" };
  if (
    /\[(?:photo\s+ocr\s+uncertain|whiteboard|handwriting)\]/i.test(
      value,
    ) ||
    /\b(?:handwritten|handwriting|whiteboard|notebook\s+page|class\s+notes|free[- ]body\s+diagram)\b/.test(
      value,
    ) ||
    (isImage && /\b(?:glare|shadow|blurred)\b/.test(value))
  )
    return { type: "handwritten-note", confidence: "high" };
  if (/\b(?:worksheet|practice\s+problems?|problem\s+sheet)\b/.test(value))
    return { type: "worksheet", confidence: "high" };

  const hasAssignmentMarker =
    /\b(?:assignment|problem\s+set|homework|lab\s+report|submit|turn\s+in|finish|complete|due|deadline)\b/.test(
      value,
    ) ||
    (/\bread\b/.test(value) &&
      /\b(?:chapter|pages?|assignment|homework|due|deadline|submit)\b/.test(
        value,
      ));
  if (hasAssignmentMarker)
    return { type: "assignment", confidence: "high" };
  if (
    /\b(?:google\s+classroom|course\s+resources?|web\s+page|website|drive|docs?)\b/.test(
      value,
    ) ||
    /\b(?:https?|ftp):\/\//i.test(text) ||
    /\.(?:html?|url)$/.test(filename) ||
    /\bweb[-_]?capture\b/.test(filename)
  )
    return { type: "web-page", confidence: "medium" };
  if (isImage) return { type: "unknown", confidence: "low" };
  return { type: "unknown", confidence: "low" };
}

/**
 * Deterministically interprets pasted text into reviewable drafts. It only
 * extracts evidence present in the paste; relative dates remain candidates.
 */
export function interpretCapture(
  originalText: string,
  context: CaptureContext,
): CaptureDraft[] {
  if (!Number.isFinite(+context.now))
    throw new RangeError("Invalid current date");
  zonedDate(context.now, context.timeZone); // validates the IANA time zone
  if (!originalText.trim()) return [];

  return segment(originalText, context.classes).map(({ text, lineNumber }) =>
    interpretSegment(originalText, text, lineNumber, context),
  );
}

function interpretSegment(
  originalText: string,
  sourceText: string,
  lineNumber: number | null,
  context: CaptureContext,
): CaptureDraft {
  const uncertainties: CaptureUncertainty[] = [];
  const classMatch = matchClass(
    sourceText,
    context.classes,
    context.contextClassId,
  );
  const object = classifyCaptureText(sourceText, context.sourceName);
  if (object.type === "unknown")
    uncertainties.push({
      field: "objectType",
      message: "I could not identify this capture yet. Review it in Capture Inbox.",
    });
  if (!classMatch.value) {
    uncertainties.push({
      field: "classId",
      message: classMatch.candidates.length
        ? "More than one class matches this text."
        : context.classes.length
          ? "I don't know which class this belongs to."
          : "No classes are available to match.",
      ...(classMatch.candidates.length
        ? { candidates: classMatch.candidates.map((item) => item.name) }
        : {}),
    });
  }

  const dateResult = extractDeadline(sourceText, context);
  uncertainties.push(...dateResult.uncertainties);
  const durationResult = extractDuration(sourceText);
  uncertainties.push(...durationResult.uncertainties);
  const resourceResult = extractResources(sourceText);
  uncertainties.push(...resourceResult.uncertainties);

  const title = extractTitle(sourceText);
  if (!title)
    uncertainties.push({
      field: "title",
      message: "I don't know what this assignment should be called.",
    });

  return {
    title,
    classId: classMatch.value?.id ?? null,
    objectType: object.type,
    deadline: dateResult.deadline,
    minutes: durationResult.minutes,
    resources: resourceResult.resources,
    confidence: {
      title: title ? "high" : "low",
      classId: classMatch.value ? classMatch.confidence : "low",
      deadline: dateResult.confidence,
      minutes: durationResult.minutes === null ? "low" : "high",
      resources: resourceResult.unsafe ? "low" : "high",
      objectType: object.confidence,
    },
    uncertainties,
    provenance: {
      source: "pasted-text",
      authority: "user-provided-text",
      capturedAt: context.now.toISOString(),
      originalText,
      sourceText,
      lineNumber,
    },
  };
}

function segment(text: string, classes: readonly Class[]): Segment[] {
  const lines = text
    .split(/\r?\n/)
    .map((value, index) => ({
      text: value.trim(),
      lineNumber: index + 1,
      listed: /^\s*(?:[-*•]|\d+[.)])\s+/.test(value),
    }))
    .filter((line) => line.text);
  if (lines.length < 2) return [{ text: text.trim(), lineNumber: null }];

  const clearlySeparate =
    lines.every((line) => line.listed) ||
    lines.every((line) =>
      Boolean(
        line.text.match(ISO_DATE) ||
        line.text.match(RELATIVE_DATE) ||
        line.text.match(DURATION) ||
        matchClass(line.text, classes).value,
      ),
    );
  if (!clearlySeparate) return [{ text: text.trim(), lineNumber: null }];
  return lines.map((line) => ({
    text: line.text.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim(),
    lineNumber: line.lineNumber,
  }));
}

function matchClass(
  text: string,
  classes: readonly Class[],
  contextClassId?: string,
) {
  const input = normalize(text);
  const inputTokens = new Set(tokens(input));
  const scored = classes
    .map((item) => {
      const name = normalize(item.name);
      const nameTokens = tokens(name);
      const overlap = nameTokens.filter((token) =>
        inputTokens.has(token),
      ).length;
      const score = input.includes(name)
        ? 1_000 + name.length
        : nameTokens.length && overlap / nameTokens.length >= 0.5
          ? Math.round((overlap / nameTokens.length) * 100) + overlap
          : 0;
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name),
    );
  if (!scored.length) {
    const contextual = contextClassId
      ? classes.find((item) => item.id === contextClassId)
      : undefined;
    if (contextual)
      return {
        value: contextual,
        confidence: "medium" as const,
        candidates: [contextual],
      };
    return {
      value: null,
      confidence: "low" as const,
      candidates: [] as Class[],
    };
  }
  const best = scored[0]!;
  const tied = scored.filter(({ score }) => score === best.score);
  if (tied.length > 1)
    return {
      value: null,
      confidence: "low" as const,
      candidates: tied.map(({ item }) => item),
    };
  return {
    value: best.item,
    confidence: (best.score >= 1_000 ? "high" : "medium") as CaptureConfidence,
    candidates: [best.item],
  };
}

function parseMonthDate(
  match: RegExpMatchArray,
  context: CaptureContext,
): { date: string; explicit: boolean; requiresConfirmation: boolean } | null {
  const monthText = match[1]?.toLocaleLowerCase("en-US");
  const day = Number(match[2]);
  if (!monthText || !Number.isInteger(day)) return null;
  const monthNames = [
    ["jan", "january"],
    ["feb", "february"],
    ["mar", "march"],
    ["apr", "april"],
    ["may"],
    ["jun", "june"],
    ["jul", "july"],
    ["aug", "august"],
    ["sep", "sept", "september"],
    ["oct", "october"],
    ["nov", "november"],
    ["dec", "december"],
  ];
  const month = monthNames.findIndex((names) => names.includes(monthText));
  if (month < 0) return null;
  const year = Number(match[3] ?? zonedDate(context.now, context.timeZone).year);
  if (!Number.isInteger(year)) return null;
  const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (!isCalendarDate(date)) return null;
  const hasYear = Boolean(match[3]);
  return { date, explicit: hasYear, requiresConfirmation: !hasYear };
}

function extractDeadline(text: string, context: CaptureContext) {
  const evidence: DateEvidence[] = [];
  for (const match of text.matchAll(ISO_DATE_TIME_ALL)) {
    if (isCalendarDate(match[1]!))
      evidence.push({ date: match[1]!, source: match[0], explicit: true });
  }
  for (const match of text.matchAll(ISO_DATE)) {
    if (isCalendarDate(match[1]!))
      evidence.push({ date: match[1]!, source: match[0], explicit: true });
  }
  for (const match of text.matchAll(MONTH_DATE)) {
    if (!hasCalendarCue(text, match[0], match.index ?? 0)) continue;
    const parsed = parseMonthDate(match, context);
    if (parsed)
      evidence.push({
        date: parsed.date,
        source: match[0],
        explicit: parsed.explicit,
        requiresConfirmation: parsed.requiresConfirmation,
      });
  }
  for (const match of text.matchAll(RELATIVE_DATE)) {
    if (!hasCalendarCue(text, match[0], match.index ?? 0)) continue;
    evidence.push({
      date: relativeDate(match[0], context.now, context.timeZone),
      source: match[0],
      explicit: false,
    });
  }
  const dates = [...new Set(evidence.map(({ date }) => date))];
  if (!dates.length)
    return {
      deadline: null,
      confidence: "low" as const,
      uncertainties: [
        { field: "deadline", message: "I don't know the deadline." },
      ] satisfies CaptureUncertainty[],
    };

  if (dates.length > 1)
    return {
      deadline: {
        date: null,
        time: null,
        instant: null,
        timeZone: context.timeZone,
        candidates: dates,
        sourceText: evidence.map(({ source }) => source),
        requiresConfirmation: true,
      },
      confidence: "low" as const,
      uncertainties: [
        {
          field: "deadline",
          message:
            "The pasted text contains conflicting dates. Choose which one to use.",
          candidates: dates,
        },
      ] satisfies CaptureUncertainty[],
    };

  const requiresConfirmation = evidence.some(
    ({ explicit, requiresConfirmation: candidateNeedsConfirmation }) =>
      !explicit || candidateNeedsConfirmation,
  );
  const time = extractTime(text, context.timeZone);
  return {
    deadline: {
      date: dates[0]!,
      time: time.value,
      instant: time.instant,
      timeZone: time.timeZone,
      candidates: dates,
      sourceText: evidence.map(({ source }) => source),
      requiresConfirmation,
    },
    confidence: requiresConfirmation ? ("low" as const) : ("high" as const),
    uncertainties: requiresConfirmation
      ? ([
          {
            field: "deadline",
            message: `Confirm that ${evidence[0]!.source} means ${dates[0]}.`,
            candidates: dates,
          },
        ] satisfies CaptureUncertainty[])
      : [],
  };
}

function hasCalendarCue(text: string, source: string, index: number): boolean {
  const nearby = text
    .slice(Math.max(0, index - 48), index + source.length + 48)
    .toLocaleLowerCase("en-US");
  return /\b(?:due|deadline|submit|turn\s+in|by|on|test|quiz|exam|assessment|assignment|problem|essay|lab|homework|finish|complete)\b/.test(
    nearby,
  );
}

function extractTime(text: string, fallbackTimeZone: string) {
  const timestamp = text.match(ISO_DATE_TIME);
  if (timestamp)
    return {
      value: `${timestamp[1]}:${timestamp[2]}`,
      instant: timestamp[3] ? new Date(timestamp[0]).toISOString() : null,
      timeZone:
        timestamp[3]?.toUpperCase() === "Z"
          ? "UTC"
          : (timestamp[3]?.replace(/^(\D?\d{2})(\d{2})$/, "$1:$2") ??
            fallbackTimeZone),
    };
  const match = text.match(EXPLICIT_TIME);
  if (!match) return { value: null, instant: null, timeZone: fallbackTimeZone };
  if (match[4])
    return {
      value: `${match[4]!.padStart(2, "0")}:${match[5]}`,
      instant: null,
      timeZone: fallbackTimeZone,
    };
  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3]!.toLowerCase().startsWith("p") ? "pm" : "am";
  if (hour < 1 || hour > 12 || minute > 59)
    return { value: null, instant: null, timeZone: fallbackTimeZone };
  if (hour === 12) hour = 0;
  if (meridiem === "pm") hour += 12;
  return {
    value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    instant: null,
    timeZone: fallbackTimeZone,
  };
}

function extractDuration(text: string) {
  const values = [...text.matchAll(DURATION)].map((match) =>
    match[3]
      ? Number(match[3])
      : Math.round(Number(match[1]) * 60 + Number(match[2] ?? 0)),
  );
  const candidates = [
    ...new Set(values.filter((value) => Number.isFinite(value))),
  ];
  if (!candidates.length)
    return {
      minutes: null,
      uncertainties: [
        { field: "minutes", message: "I don't know how long this will take." },
      ] satisfies CaptureUncertainty[],
    };
  if (candidates.length > 1)
    return {
      minutes: null,
      uncertainties: [
        {
          field: "minutes",
          message: "The pasted text contains conflicting durations.",
          candidates: candidates.map(String),
        },
      ] satisfies CaptureUncertainty[],
    };
  const minutes = candidates[0]!;
  return {
    minutes,
    uncertainties:
      minutes < 5 || minutes > 2_400
        ? ([
            {
              field: "minutes",
              message:
                "The duration is outside the supported 5–2400 minute range.",
              candidates: [String(minutes)],
            },
          ] satisfies CaptureUncertainty[])
        : [],
  };
}

function extractResources(text: string) {
  const resources: string[] = [];
  let unsafe = false;
  const uncertainties: CaptureUncertainty[] = [];
  for (const match of text.matchAll(URL_TOKEN)) {
    const raw = match[0].replace(/[),.;!?]+$/, "");
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:") {
        unsafe = true;
        uncertainties.push({
          field: "resources",
          message: `Ignored non-HTTPS resource: ${raw}`,
        });
      } else if (!resources.includes(url.href)) resources.push(url.href);
    } catch {
      unsafe = true;
      uncertainties.push({
        field: "resources",
        message: `Ignored invalid resource: ${raw}`,
      });
    }
  }
  return { resources, unsafe, uncertainties };
}

function extractTitle(text: string): string {
  const unlisted = text.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
  const dueAt = unlisted.search(/\b(?:due|deadline)\b/i);
  const candidate = dueAt > 0 ? unlisted.slice(0, dueAt) : unlisted;
  return candidate
    .replace(URL_TOKEN, " ")
    .replace(ISO_DATE_TIME_ALL, " ")
    .replace(ISO_DATE, " ")
    .replace(MONTH_DATE, " ")
    .replace(RELATIVE_DATE, " ")
    .replace(EXPLICIT_TIME, " ")
    .replace(DURATION, " ")
    .replace(/^\s*(?:due|deadline)\s*(?:on|by)?\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,;:–—-]+/, "")
    .replace(/[\s,;:–—-]+$/, "")
    .trim();
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  return value
    .split(" ")
    .filter(
      (token) => token.length > 2 && !["the", "and", "class"].includes(token),
    );
}

function isCalendarDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month! - 1 &&
    date.getUTCDate() === day
  );
}

function relativeDate(value: string, now: Date, timeZone: string): string {
  const current = zonedDate(now, timeZone);
  const normalized = value.toLowerCase();
  if (normalized === "today") return formatDate(current);
  if (normalized === "tomorrow") return formatDate(addDays(current, 1));
  const weekday = WEEKDAYS.findIndex((day) => normalized.endsWith(day));
  const currentWeekday = new Date(
    Date.UTC(current.year, current.month - 1, current.day),
  ).getUTCDay();
  let offset = (weekday - currentWeekday + 7) % 7;
  if (offset === 0 && !normalized.startsWith("this ")) offset = 7;
  return formatDate(addDays(current, offset));
}
