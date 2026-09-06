import { test } from "node:test";
import assert from "node:assert/strict";
import { sourcePassage } from "./passages";
test("retrieves later relevant original text with exact source offsets", () => {
  const text =
    "Introductory material. ".repeat(400) +
    "Static friction prevents relative sliding. Maximum friction depends on the normal force.\n" +
    "Other material. ".repeat(400);
  const result = sourcePassage(
    text,
    "How does static friction depend on normal force?",
  );
  assert.ok(result.excerptStart > 0);
  assert.ok(
    result.excerpt.includes("Static friction prevents relative sliding."),
  );
  assert.equal(
    result.excerpt,
    text.slice(result.excerptStart, result.excerptEnd),
  );
  assert.ok(result.excerpt.length <= 3000);
  assert.ok(result.truncated);
  assert.equal(result.selectionMethod, "lexical-match");
});
test("no match falls back explicitly and repeated terms do not overpower distinct terms", () => {
  const text = "apple ".repeat(600) + "pear orange banana.";
  assert.equal(
    sourcePassage(text, "pear orange banana apple").excerpt.includes(
      "pear orange banana.",
    ),
    true,
  );
  const fallback = sourcePassage(text, "Why is this?");
  assert.equal(fallback.excerptStart, 0);
  assert.equal(fallback.selectionMethod, "opening-fallback");
  assert.equal(fallback.matchedQueryTerms, 0);
  const short = sourcePassage("Αλφα physics 👋", "physics");
  assert.equal(short.truncated, false);
  assert.equal(short.excerpt, "Αλφα physics 👋");
});
