import { canvasScene, type CanvasScene } from "./scene";

// Page order and dimensions belong to Desk. The renderer receives one page's
// elements; shared binary files and source links remain in the whole document.
export function startNotebook(scene: CanvasScene, pageId: string): CanvasScene {
  if (scene.notebook) throw Error("This canvas is already a notebook.");
  return canvasScene.parse({
    ...scene,
    elements: [],
    notebook: {
      activePageId: pageId,
      pages: [
        {
          id: pageId,
          title: "Page 1",
          width: 794,
          height: 1123,
          elements: scene.elements,
        },
      ],
    },
  });
}

export function addNotebookPage(
  scene: CanvasScene,
  pageId: string,
): CanvasScene {
  if (!scene.notebook) throw Error("Open a notebook before adding a page.");
  const current = activeNotebookPage(scene);
  return canvasScene.parse({
    ...scene,
    notebook: {
      activePageId: pageId,
      pages: [
        ...scene.notebook.pages,
        {
          id: pageId,
          title: `Page ${scene.notebook.pages.length + 1}`,
          width: current.width,
          height: current.height,
          elements: [],
        },
      ],
    },
  });
}

export function activeNotebookPage(scene: CanvasScene) {
  const page = scene.notebook?.pages.find(
    (page) => page.id === scene.notebook?.activePageId,
  );
  if (!page) throw Error("The selected notebook page does not exist.");
  return page;
}

export function selectNotebookPage(
  scene: CanvasScene,
  pageId: string,
): CanvasScene {
  if (!scene.notebook) throw Error("This canvas is not a notebook.");
  return canvasScene.parse({
    ...scene,
    notebook: { ...scene.notebook, activePageId: pageId },
  });
}

export function replaceNotebookPage(
  scene: CanvasScene,
  pageId: string,
  elements: CanvasScene["elements"],
): CanvasScene {
  if (scene.notebook?.activePageId !== pageId)
    throw Error("The notebook page changed before this edit was saved.");
  return canvasScene.parse({
    ...scene,
    notebook: {
      ...scene.notebook,
      pages: scene.notebook.pages.map((page) =>
        page.id === pageId ? { ...page, elements } : page,
      ),
    },
  });
}
