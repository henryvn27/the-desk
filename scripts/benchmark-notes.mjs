import { performance } from "node:perf_hooks";
import { canvasScene } from "../packages/canvas/scene.ts";
import { noteDocumentText } from "../packages/canvas/notes.ts";
import { sampleGraph } from "../packages/canvas/graph.ts";

const paragraphBlocks = Array.from({ length: 600 }, (_, index) => ({
  id: `lecture-${index}`,
  type: "paragraph",
  text: `Lecture line ${index}: ${"calculus derivation and worked example ".repeat(12)}`,
}));
const ink = Array.from({ length: 2_000 }, (_, index) => ({
  id: `stroke-${index}`,
  type: "freedraw",
  x: index % 100,
  y: Math.floor(index / 100),
  width: 32,
  height: 12,
  points: Array.from({ length: 12 }, (_, point) => [point * 2, Math.sin(point / 2) * 4]),
  strokeColor: "#1f2326",
  strokeWidth: 2,
  opacity: 100,
  isDeleted: false,
}));
const scene = {
  engine: "excalidraw",
  version: 1,
  elements: ink,
  files: {},
  viewBackgroundColor: "#fffdfa",
  document: { version: 1, blocks: paragraphBlocks },
};
const timed = (work) => {
  const start = performance.now();
  const value = work();
  return { value, ms: performance.now() - start };
};
const parsed = timed(() => canvasScene.parse(scene));
const indexed = timed(() => noteDocumentText(parsed.value.document));
const graph = timed(() => sampleGraph("sin(x) + 0.25 * cos(3*x)", { xMin: -12, xMax: 12, yMin: -2, yMax: 2 }, 800));
const result = {
  sceneBytes: Buffer.byteLength(JSON.stringify(scene)),
  blocks: paragraphBlocks.length,
  inkStrokes: ink.length,
  graphSamples: graph.value.length,
  parseMs: Number(parsed.ms.toFixed(2)),
  indexMs: Number(indexed.ms.toFixed(2)),
  graphMs: Number(graph.ms.toFixed(2)),
};
if (result.sceneBytes >= 20 * 1024 * 1024 || result.parseMs > 2_000 || result.indexMs > 1_000 || result.graphMs > 1_000)
  throw Error(`Notes benchmark exceeded its bounded thresholds: ${JSON.stringify(result)}`);
console.log(JSON.stringify({ result: "PASS", benchmark: result }));
