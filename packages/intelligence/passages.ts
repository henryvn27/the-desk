// Deterministic lexical retrieval over local text, not a semantic relevance claim.
const stopWords = new Set(
  "a an and are as at be by can do does for from how i in is it me of on or please the this to was what when where which why with you your".split(
    " ",
  ),
);
function words(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
export function sourcePassage(text: string, question: string) {
  const terms = new Set(
    words(question.slice(0, 4000))
      .filter((word) => word.length > 1 && !stopWords.has(word))
      .slice(0, 64),
  );
  let start = 0,
    score = 0;
  // Overlap keeps a matching passage from falling entirely across a window boundary.
  for (let offset = 0; offset < text.length; offset += 1500) {
    const found = new Set(
      words(text.slice(offset, offset + 3000)).filter((word) =>
        terms.has(word),
      ),
    );
    if (found.size > score) {
      start = offset;
      score = found.size;
    }
    if (offset + 3000 >= text.length) break;
  }
  const end = Math.min(text.length, start + 3000);
  return {
    excerpt: text.slice(start, end),
    excerptStart: start,
    excerptEnd: end,
    offsetUnit: "UTF-16 code units" as const,
    truncated: start > 0 || end < text.length,
    matchedQueryTerms: score,
    selectionMethod: score
      ? ("lexical-match" as const)
      : ("opening-fallback" as const),
  };
}
