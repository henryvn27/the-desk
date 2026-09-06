import { createHash } from "node:crypto";
import { z } from "zod";
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export function pdfMetadata(fileName: string, bytes: Uint8Array) {
  const name = z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/^[^/\\]+$/)
    .parse(fileName);
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 8 ||
    bytes.byteLength > MAX_PDF_BYTES ||
    Buffer.from(bytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
  )
    throw Error("Choose a PDF file no larger than 20 MB.");
  return {
    fileName: name,
    byteLength: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
