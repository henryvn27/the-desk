import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMath } from "./math";

test("equations render as self-contained paths with bounded size", () => {
  for (const latex of [
    String.raw`\frac{-b\pm\sqrt{b^2-4ac}}{2a}`,
    String.raw`\int_0^1 x^2\,dx=\frac{1}{3}`,
    String.raw`\begin{pmatrix}1&2\\3&4\end{pmatrix}`,
  ]) {
    const result = renderMath(latex);
    assert.equal(result.latex, latex);
    assert.ok(result.width > 20 && result.height > 10);
    assert.match(result.svg, /<path/);
    assert.doesNotMatch(
      result.svg,
      /<(script|image|foreignObject|a)\b|(?:href|src)=/i,
    );
  }
});
test("invalid, external-content and oversized LaTeX are rejected", () => {
  for (const latex of [
    "",
    "x".repeat(2001),
    String.raw`\notACommand{x}`,
    String.raw`\href{https://example.com}{x}`,
    String.raw`\includegraphics{x}`,
  ])
    assert.throws(() => renderMath(latex));
  assert.ok(
    renderMath("x^2").width > 0,
    "A failed expression must not poison later rendering",
  );
});
