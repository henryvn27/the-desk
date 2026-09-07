import { z } from "zod";

/** A stable, source-relative location. Unknown anchors stay unknown. */
export const sourceLocation = z
  .object({
    page: z.number().int().positive().optional(),
    startMs: z.number().int().min(0).optional(),
    endMs: z.number().int().min(0).optional(),
    startOffset: z.number().int().min(0).optional(),
    endOffset: z.number().int().min(0).optional(),
    region: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1),
      })
      .optional(),
    label: z.string().trim().max(200).optional(),
  })
  .superRefine((location, context) => {
    if (
      location.endOffset !== undefined &&
      location.startOffset !== undefined &&
      location.endOffset < location.startOffset
    )
      context.addIssue({
        code: "custom",
        path: ["endOffset"],
        message: "Source end offset must follow its start offset.",
      });
    if (
      location.endMs !== undefined &&
      location.startMs !== undefined &&
      location.endMs < location.startMs
    )
      context.addIssue({
        code: "custom",
        path: ["endMs"],
        message: "Source end time must follow its start time.",
      });
    if (
      location.region &&
      (location.region.x + location.region.width > 1 ||
        location.region.y + location.region.height > 1)
    )
      context.addIssue({
        code: "custom",
        path: ["region"],
        message: "Source region must stay inside the page.",
      });
  });
export type SourceLocation = z.infer<typeof sourceLocation>;

export const sourceProvenance = z.object({
  sourceId: z.string().uuid(),
  sourceRevision: z.number().int().nonnegative(),
  excerpt: z.string().trim().min(1).max(20_000),
  location: sourceLocation,
  annotationId: z.string().uuid().optional(),
});
export type SourceProvenance = z.infer<typeof sourceProvenance>;

export const sourceAnnotationInput = z.object({
  sourceRevision: z.number().int().nonnegative(),
  text: z.string().trim().min(1).max(20_000),
  comment: z.string().trim().max(5_000).default(""),
  location: sourceLocation,
});
export type SourceAnnotationInput = z.infer<typeof sourceAnnotationInput>;

export const sourceNoteRef = z.object({
  canvasId: z.string().uuid(),
  blockId: z.string().min(1).max(120),
});
export type SourceNoteRef = z.infer<typeof sourceNoteRef>;

export const sourceAnnotation = sourceAnnotationInput.extend({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  noteRefs: z.array(sourceNoteRef).max(100).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  revision: z.number().int().nonnegative(),
});
export type SourceAnnotation = z.infer<typeof sourceAnnotation>;

export const sourceRevisionSummary = z.object({
  revision: z.number().int().nonnegative(),
  capturedAt: z.string().datetime(),
  textLength: z.number().int().nonnegative(),
  textHash: z.string().regex(/^[a-f0-9]{64}$/),
  excerpt: z.string().max(240),
});
export type SourceRevisionSummary = z.infer<typeof sourceRevisionSummary>;
