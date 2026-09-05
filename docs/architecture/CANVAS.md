# Canvas

The Desk owns canvas identity, assignment association, timestamps and optimistic revisions in SQLite schema 5. `packages/canvas/scene.ts` is the versioned scene boundary; the initial renderer adapter uses Excalidraw 0.18.1. This scene format preserves engine fields and original ink, but a future renderer replacement will require an explicit conversion, not a package swap.

The renderer loads on demand. Fonts are packaged locally. Embedded web content and Excalidraw AI are disabled; browser navigation remains denied by the desktop shell. Scene validation bounds element count and serialized bytes, rejects embedded content and validates supported raster data URLs. Main validates commands again. Full scenes are fetched separately from the frequently refreshed snapshot.

Edits debounce into serialized writes. Saves compare revisions and fail on a stale version. Close waits for pending writes; validation errors keep the editor open. Native process termination during the debounce interval can lose the most recent unsaved action; crash-recovery journaling is not implemented.

Verified scope: desktop ink, arrow, rectangle, undo/redo, close/reopen, exact stored scene through app restart; domain tests cover stale-write rejection and scene validation. Image files have codec tests only. Export, PDF annotation, paged mode, LaTeX blocks, handwriting recognition, source links, shared Lens primitives, additional Canvas tool behavior and interactive Windows parity remain unverified or unimplemented. The upstream toolbar is not blanket acceptance evidence.

Dependency overrides update vulnerable pinned nanoid/lodash-es versions; npm audit reports zero vulnerabilities after the overrides. Upstream Radix peer ranges emit React 19 warnings despite Excalidraw's React 19 peer support; local runtime checks pass, and broader regression coverage remains required.
