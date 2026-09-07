import type { LensPoint, LensSelection } from "./lens-provider";

export type LensSelectionBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LensViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MIN_SPAN = 0.012;
const DEFAULT_PADDING = 0.035;

export function selectionBounds(
  selection: LensSelection | undefined,
  padding = DEFAULT_PADDING,
): LensSelectionBounds | null {
  const points: LensPoint[] = [];
  if (selection?.points) points.push(...selection.points);
  for (const path of selection?.paths ?? []) points.push(...path.points);
  if (!points.length) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const raw = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
  const pad = Math.max(0, Math.min(0.2, padding));
  const xSpan = Math.max(MIN_SPAN, raw.width);
  const ySpan = Math.max(MIN_SPAN, raw.height);
  const x = Math.max(0, raw.x - Math.max(pad, (xSpan - raw.width) / 2));
  const y = Math.max(0, raw.y - Math.max(pad, (ySpan - raw.height) / 2));
  const right = Math.min(1, raw.x + raw.width + Math.max(pad, (xSpan - raw.width) / 2));
  const bottom = Math.min(1, raw.y + raw.height + Math.max(pad, (ySpan - raw.height) / 2));
  return {
    x,
    y,
    width: Math.max(MIN_SPAN, right - x),
    height: Math.max(MIN_SPAN, bottom - y),
  };
}

export function selectionHasContent(selection: LensSelection | undefined) {
  return Boolean(
    selection &&
      ((selection.points?.length ?? 0) > 0 ||
        selection.paths?.some((path) => path.points.length > 0)),
  );
}

/** Map a normalized Lens selection into a virtual desktop or display space. */
export function absoluteSelectionBounds(
  selection: LensSelection | undefined,
  viewport: LensViewport,
  padding = DEFAULT_PADDING,
): LensSelectionBounds | null {
  const normalized = selectionBounds(selection, padding);
  if (!normalized) return null;
  return {
    x: viewport.x + normalized.x * viewport.width,
    y: viewport.y + normalized.y * viewport.height,
    width: normalized.width * viewport.width,
    height: normalized.height * viewport.height,
  };
}
