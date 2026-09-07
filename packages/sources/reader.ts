export type SourceSection = {
  id: string;
  title: string;
  text: string;
  startOffset: number;
  endOffset: number;
  level: 1 | 2 | 3;
};

export type SourceMatch = {
  startOffset: number;
  endOffset: number;
  excerpt: string;
};

const heading = /^(#{1,3})\s+(.+?)\s*$/;
const numberedHeading = /^(\d+(?:\.\d+)*)[.)]\s+(.+?)\s*$/;

/** Split a captured source without changing its original text or offsets. */
export function sourceSections(text: string): SourceSection[] {
  const sections: SourceSection[] = [];
  let offset = 0;
  for (const rawLine of text.split(/\n/)) {
    const value = rawLine.replace(/\r$/, "");
    const trimmed = value.trim();
    const startOffset = offset;
    const endOffset = startOffset + value.length;
    offset += rawLine.length + 1;
    if (!trimmed) continue;
    const markdown = heading.exec(trimmed);
    const numbered = numberedHeading.exec(trimmed);
    const level = markdown
      ? Math.min(3, markdown[1]!.length)
      : numbered
        ? Math.min(3, numbered[1]!.split(".").length)
        : trimmed.length <= 70 && trimmed === trimmed.toUpperCase()
          ? 1
          : 3;
    const title = markdown?.[2] ?? numbered?.[2] ?? trimmed;
    sections.push({
      id: `source-${startOffset}`,
      title,
      text: value,
      startOffset,
      endOffset,
      level: level as 1 | 2 | 3,
    });
  }
  return sections;
}

export function sourceSearch(text: string, query: string): SourceMatch[] {
  const needle = query.trim();
  if (!needle) return [];
  const lower = text.toLocaleLowerCase();
  const target = needle.toLocaleLowerCase();
  const matches: SourceMatch[] = [];
  let start = 0;
  while (matches.length < 500) {
    const found = lower.indexOf(target, start);
    if (found < 0) break;
    const endOffset = found + needle.length;
    const excerptStart = Math.max(0, found - 70);
    const excerptEnd = Math.min(text.length, endOffset + 110);
    matches.push({
      startOffset: found,
      endOffset,
      excerpt: `${excerptStart ? "…" : ""}${text.slice(excerptStart, excerptEnd)}${excerptEnd < text.length ? "…" : ""}`,
    });
    start = Math.max(endOffset, found + 1);
  }
  return matches;
}

export function sourceExcerpt(text: string, startOffset: number, endOffset: number) {
  const start = Math.max(0, Math.min(text.length, Math.trunc(startOffset)));
  const end = Math.max(start, Math.min(text.length, Math.trunc(endOffset)));
  return text.slice(start, end);
}

export function sourceAnchorLabel(location: {
  page?: number;
  startMs?: number;
  startOffset?: number;
  label?: string;
}) {
  if (location.label) return location.label;
  if (location.page !== undefined) return `Page ${location.page}`;
  if (location.startMs !== undefined)
    return `${Math.floor(location.startMs / 60_000)}:${String(Math.floor((location.startMs % 60_000) / 1_000)).padStart(2, "0")}`;
  if (location.startOffset !== undefined) return `Character ${location.startOffset}`;
  return "Source passage";
}
