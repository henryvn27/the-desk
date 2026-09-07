import { evaluateExpression, formatNumber } from "./semantic-math";

export type GraphViewport = {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
};
export type GraphPoint = { x: number; y: number };

function validViewport(viewport: GraphViewport) {
  return Number.isFinite(viewport.xMin) && Number.isFinite(viewport.xMax) &&
    Number.isFinite(viewport.yMin) && Number.isFinite(viewport.yMax) &&
    viewport.xMax > viewport.xMin && viewport.yMax > viewport.yMin;
}

/** Deterministic sampling used by the Notes graph block and its tests. */
export function sampleGraph(
  expression: string,
  viewport: GraphViewport,
  samples = 240,
  scope: Record<string, unknown> = {},
): Array<GraphPoint | null> {
  if (!validViewport(viewport)) throw Error("Graph viewport is invalid.");
  const count = Math.max(8, Math.min(800, Math.floor(samples)));
  const points: Array<GraphPoint | null> = [];
  for (let index = 0; index < count; index += 1) {
    const x = viewport.xMin + (viewport.xMax - viewport.xMin) * index / (count - 1);
    const result = evaluateExpression(expression, { ...scope, x });
    const y = result?.value;
    points.push(y !== undefined && Number.isFinite(y) ? { x, y } : null);
  }
  return points;
}

export function roots(
  expression: string,
  viewport: GraphViewport,
  scope: Record<string, unknown> = {},
) {
  const points = sampleGraph(expression, viewport, 600, scope);
  const values: number[] = [];
  const add = (value: number) => values.push(Number(value.toPrecision(8)));
  if (points[0]?.y === 0) add(points[0].x);
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    if (previous.y === 0) add(previous.x);
    if (previous.y * current.y < 0) {
      const ratio = Math.abs(previous.y) / (Math.abs(previous.y) + Math.abs(current.y));
      add(previous.x + (current.x - previous.x) * ratio);
    }
  }
  if (points.at(-1)?.y === 0) add(points.at(-1)!.x);
  return [...new Set(values)];
}

/** Approximate intersections for two linked expressions in the current viewport. */
export function intersections(
  left: string,
  right: string,
  viewport: GraphViewport,
  scope: Record<string, unknown> = {},
) {
  const first = sampleGraph(left, viewport, 600, scope);
  const second = sampleGraph(right, viewport, 600, scope);
  const values: GraphPoint[] = [];
  const firstPoint = first[0];
  const secondPoint = second[0];
  if (firstPoint && secondPoint && firstPoint.y === secondPoint.y)
    values.push({ x: firstPoint.x, y: firstPoint.y });
  for (let index = 1; index < first.length; index += 1) {
    const previousLeft = first[index - 1];
    const currentLeft = first[index];
    const previousRight = second[index - 1];
    const currentRight = second[index];
    if (!previousLeft || !currentLeft || !previousRight || !currentRight) continue;
    const previous = previousLeft.y - previousRight.y;
    const current = currentLeft.y - currentRight.y;
    if (previous === 0) values.push({ x: previousLeft.x, y: previousLeft.y });
    if (previous * current < 0) {
      const ratio = Math.abs(previous) / (Math.abs(previous) + Math.abs(current));
      const x = previousLeft.x + (currentLeft.x - previousLeft.x) * ratio;
      const y = previousLeft.y + (currentLeft.y - previousLeft.y) * ratio;
      values.push({ x, y });
    }
  }
  const lastLeft = first.at(-1);
  const lastRight = second.at(-1);
  if (lastLeft && lastRight && lastLeft.y === lastRight.y)
    values.push({ x: lastLeft.x, y: lastLeft.y });
  return values.filter((point, index) => index === 0 || Math.abs(point.x - values[index - 1]!.x) > 1e-6);
}

export function zoomViewport(viewport: GraphViewport, factor: number): GraphViewport {
  if (!Number.isFinite(factor) || factor <= 0) throw Error("Graph zoom must be positive.");
  const xCenter = (viewport.xMin + viewport.xMax) / 2;
  const yCenter = (viewport.yMin + viewport.yMax) / 2;
  const xHalf = (viewport.xMax - viewport.xMin) / 2 * factor;
  const yHalf = (viewport.yMax - viewport.yMin) / 2 * factor;
  return { xMin: xCenter - xHalf, xMax: xCenter + xHalf, yMin: yCenter - yHalf, yMax: yCenter + yHalf };
}

export function panViewport(viewport: GraphViewport, dx: number, dy: number): GraphViewport {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw Error("Graph pan must be finite.");
  return { xMin: viewport.xMin + dx, xMax: viewport.xMax + dx, yMin: viewport.yMin + dy, yMax: viewport.yMax + dy };
}

export function graphPath(
  points: Array<GraphPoint | null>,
  viewport: GraphViewport,
  width: number,
  height: number,
) {
  let path = "";
  let connected = false;
  for (const point of points) {
    if (!point || point.y < viewport.yMin - (viewport.yMax - viewport.yMin) * 2 || point.y > viewport.yMax + (viewport.yMax - viewport.yMin) * 2) {
      connected = false;
      continue;
    }
    const x = ((point.x - viewport.xMin) / (viewport.xMax - viewport.xMin)) * width;
    const y = height - ((point.y - viewport.yMin) / (viewport.yMax - viewport.yMin)) * height;
    path += `${connected ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)} `;
    connected = true;
  }
  return path.trim();
}

export function formatGraphValue(value: number) {
  return formatNumber(value);
}
