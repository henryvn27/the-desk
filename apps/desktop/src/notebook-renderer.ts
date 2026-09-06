import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { CanvasScene } from "../../../packages/canvas/scene";

type Page = NonNullable<CanvasScene["notebook"]>["pages"][number];
export function makePageFrame(page: Page) {
  const frame = convertToExcalidrawElements([
    {
      type: "frame",
      id: `desk-page-${page.id}`,
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
      name: page.title,
      locked: true,
      children: [],
    },
  ])[0];
  if (!frame || frame.type !== "frame")
    throw Error("Unable to create notebook page.");
  // The engine skeleton converter treats zero coordinates as absent when
  // deriving empty-frame bounds. Desk owns the fixed page origin and size.
  return {
    ...frame,
    x: 0,
    y: 0,
    width: page.width,
    height: page.height,
    locked: true,
  };
}
export function fitElementsToPage(
  elements: readonly ExcalidrawElement[],
  frame: ReturnType<typeof makePageFrame>,
) {
  return [
    ...elements
      .filter((element) => element.id !== frame.id)
      .map((element) => ({ ...element, frameId: frame.id })),
    frame,
  ];
}
export function pageNeedsRepair(
  elements: readonly ExcalidrawElement[],
  frame: ReturnType<typeof makePageFrame>,
) {
  const current = elements.find((element) => element.id === frame.id);
  return (
    !current ||
    current.isDeleted ||
    !current.locked ||
    current.x !== 0 ||
    current.y !== 0 ||
    current.width !== frame.width ||
    current.height !== frame.height ||
    elements.some(
      (element) => element.id !== frame.id && element.frameId !== frame.id,
    )
  );
}
