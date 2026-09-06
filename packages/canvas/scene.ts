import { z } from "zod";

const MAX_SCENE_BYTES = 20 * 1024 * 1024;
const id = z.string().min(1).max(500);
const imageMimeType = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

export const mathSource = z.object({
  latex: z.string().trim().min(1).max(2000),
});

const element = z.looseObject({
  customData: z.looseObject({ deskMath: mathSource.optional() }).optional(),
  id,
  type: z.enum([
    "rectangle",
    "diamond",
    "ellipse",
    "arrow",
    "line",
    "freedraw",
    "text",
    "image",
    "frame",
  ]),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
});

const binaryFile = z
  .looseObject({
    id,
    mimeType: imageMimeType,
    dataURL: z.string().max(MAX_SCENE_BYTES),
    created: z.number(),
    lastRetrieved: z.number().optional(),
  })
  .superRefine((file, context) => {
    const match = /^data:([^;,]+);base64,[A-Za-z0-9+/]+={0,2}$/.exec(
      file.dataURL,
    );
    const payload = file.dataURL.slice(file.dataURL.indexOf(",") + 1);
    if (!match || match[1] !== file.mimeType || payload.length % 4 !== 0) {
      context.addIssue({
        code: "custom",
        path: ["dataURL"],
        message: "Image data URL must be base64 and match its MIME type",
      });
    }
  });

export const canvasScene = z
  .strictObject({
    engine: z.literal("excalidraw"),
    version: z.literal(1),
    sourceIds: z.array(z.string().uuid()).max(100).optional(),
    elements: z.array(element).max(10_000),
    files: z.record(id, binaryFile),
    viewBackgroundColor: z.string(),
  })
  .superRefine((scene, context) => {
    for (const [key, file] of Object.entries(scene.files)) {
      if (file.id !== key) {
        context.addIssue({
          code: "custom",
          path: ["files", key, "id"],
          message: "File id must match its record key",
        });
      }
    }

    try {
      if (
        new TextEncoder().encode(JSON.stringify(scene)).byteLength >
        MAX_SCENE_BYTES
      ) {
        context.addIssue({
          code: "custom",
          message: "Canvas scene must be at most 20 MB",
        });
      }
    } catch {
      context.addIssue({
        code: "custom",
        message: "Canvas scene must be JSON serializable",
      });
    }
  });

export type CanvasScene = z.infer<typeof canvasScene>;
