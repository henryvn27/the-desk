import type {
  LensOverlayMark,
  LensResponse,
} from "./lens-provider";

export type LensOverlayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
function mapX(value: number, bounds: LensOverlayBounds) {
  return clamp(bounds.x + value * bounds.width);
}

function mapY(value: number, bounds: LensOverlayBounds) {
  return clamp(bounds.y + value * bounds.height);
}

/**
 * Provider coordinates are relative to the image sent to the model. Lens
 * sends a crop for a freeform selection, so map semantic marks back into the
 * virtual desktop before the renderer draws them. Keeping this transformation
 * in the trusted boundary prevents every renderer from inventing its own
 * Retina or multi-monitor math.
 */
export function mapLensOverlayMarkToViewport(
  mark: LensOverlayMark,
  bounds: LensOverlayBounds | undefined,
): LensOverlayMark {
  if (!bounds) return mark;
  return {
    ...mark,
    x: mapX(mark.x, bounds),
    y: mapY(mark.y, bounds),
    ...(mark.x2 == null ? { x2: mark.x2 } : { x2: mapX(mark.x2, bounds) }),
    ...(mark.y2 == null ? { y2: mark.y2 } : { y2: mapY(mark.y2, bounds) }),
  };
}

export function mapLensResponseToViewport(
  response: LensResponse,
  bounds: LensOverlayBounds | undefined,
): LensResponse {
  if (!bounds || response.overlays.length === 0) return response;
  return {
    ...response,
    overlays: response.overlays.map((mark) =>
      mapLensOverlayMarkToViewport(mark, bounds),
    ),
  };
}
