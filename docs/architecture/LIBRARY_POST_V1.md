# Library / Source Reading post-V1

The post-V1 Library work extends the shipped `sources` table and global search path. It does not introduce a second source database or replace the V1 Source identity, class/task links, authority field, or revision check.

## Reader boundary

`apps/desktop/src/SourceReader.tsx` is a renderer presentation over one `Source` record. It provides:

- a source outline derived from the captured text without rewriting it;
- bounded in-source search with source-relative offsets;
- exact browser selection capture for annotations;
- source representation and original-URL metadata for text, PDF, slides, transcript, and web captures;
- annotation and revision sidecars that mark anchors stale when a newer source revision no longer matches;
- backlinks from a passage annotation to the Note block that used it.

The reader does not silently move an uncertain anchor. A stale annotation remains attached to its original revision and location for review.

## Passage provenance

Source annotations are stored in the existing `sources` row as a bounded JSON envelope. Each annotation keeps the source ID, source revision, text, and page/time/offset/region location. Note blocks use the same source ID and revision plus an annotation ID, so a Source → Note action is a linked artifact rather than a copy/paste operation.

Saving a Note with a passage provenance envelope updates the annotation's `noteRefs` in the same local SQLite transaction boundary. The existing sync payload carries the updated Source row; there is no annotation store or parallel source identity.

## Migration and compatibility

Schema 42 adds only `format`, `sourceUrl`, `annotations`, and `revisionHistory` columns to `sources`. Existing rows default to a text representation, no URL, and empty connected metadata. Source identity and text are preserved. The migration is idempotent for older development databases that were temporarily returned to a previous user-version during recovery tests.

Legacy Canvas scenes remain valid. Note provenance is optional and is validated only when present. A saved Note may reference a source annotation, but a stale source revision is retained instead of being rewritten.

## Search and evidence

The existing `DeskStore.search` remains the only search path. It now returns annotation results with `sourceId`, source revision, and exact location; Source text matches include the first exact text offset when one exists. Existing Note OCR, transcript, math, handwriting, and block deep-links remain in the same result set.

The Source authority and source-kind fields are unchanged. This reader does not add a synthesis provider or alter Lens routing. Gemini Notebook remains an optional integration catalog entry.

Library also passes an explicit selected-source scope into the existing Lens transport for compare, synthesis, study-guide, and quiz requests. The scope carries source IDs, titles, kinds, authority, and revisions so the response remains inspectable and bounded to the student's selection.

## Verification

- `packages/sources/reader.test.ts` covers stable offsets, bounded matching, excerpts, and anchor labels.
- `packages/domain/source-reading.test.ts` covers annotation persistence, Source → Note provenance, backlinks, unified annotation search, revision history, and restart recovery.
- `scripts/benchmark-library.mjs` exercises a 174k-character, 1,800-section source with 500 annotations and records reader/index timings.
- `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` run against the complete repository.
- The desktop smoke path renders the reader, a real text selection, selected-source workspace, and Lens scope in `artifacts/library-reader/reader-v2.png`, `reader-selection-v2.png`, `library-scope-selected.png`, and `lens-source-scope.png`.
