import { mathjax } from "@mathjax/src/js/mathjax.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { MathJaxTexFont } from "@mathjax/mathjax-tex-font/js/svg.js";
import "@mathjax/src/js/input/tex/base/BaseConfiguration.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import { mathSource } from "./scene";
const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const document = mathjax.document("", {
  InputJax: new TeX({
    packages: ["base", "ams"],
    maxBuffer: 4000,
    maxMacros: 1000,
    formatError: (_jax: unknown, error: Error) => {
      throw Error(`Invalid LaTeX: ${error.message}`);
    },
  }),
  OutputJax: new SVG({ fontCache: "none", font: new MathJaxTexFont() }),
});
export function renderMath(latex: string) {
  const source = mathSource.parse({ latex });
  const node = document.convert(source.latex, {
    display: true,
    em: 32,
    ex: 16,
    containerWidth: 1280,
  });
  const svg = adaptor.tags(node, "svg")[0];
  if (!svg) throw Error("Unable to render this equation.");
  const width = Math.ceil(parseFloat(adaptor.getAttribute(svg, "width")) * 16);
  const height = Math.ceil(
    parseFloat(adaptor.getAttribute(svg, "height")) * 16,
  );
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 2048
  )
    throw Error(
      "This equation is too large to insert. Split it into smaller blocks.",
    );
  adaptor.setAttribute(svg, "width", String(width));
  adaptor.setAttribute(svg, "height", String(height));
  adaptor.setAttribute(svg, "color", "#1e1e1e");
  return { svg: adaptor.outerHTML(svg), width, height, latex: source.latex };
}
