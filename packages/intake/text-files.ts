import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, extname } from "node:path";
const MAX_BYTES = 80_000;
/** Native-picker paths only. No path or file contents are included in errors. */
export async function readCaptureTextFiles(paths: readonly string[]) {
  if (!paths.length || paths.length > 10)
    throw Error("Choose between 1 and 10 text or Markdown files.");
  const files: { name: string; text: string }[] = [];
  for (const path of paths) {
    const name = basename(path);
    if (
      ![".txt", ".md"].includes(extname(name).toLowerCase()) ||
      name.startsWith(".") ||
      name.length > 255
    )
      throw Error("Import supports visible .txt and .md files only.");
    let file;
    try {
      file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) throw Error();
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const result = await file.read(
          bytes,
          length,
          bytes.length - length,
          length,
        );
        if (!result.bytesRead) break;
        length += result.bytesRead;
      }
      if (length > MAX_BYTES) throw Error();
      const text = new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, length),
      );
      if (!text.trim() || text.length > 20_000 || text.includes("\0"))
        throw Error();
      // Academic intake must not turn a credential file into renderer content.
      if (
        /sk-or-v1-[a-z\d_-]+|sb_secret_[a-z\d_-]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|(?:OPENROUTER_API_KEY|SUPABASE_PUBLISHABLE_KEY)\s*=/i.test(
          text,
        )
      )
        throw Error();
      files.push({ name, text });
    } catch {
      throw Error(
        "No files were imported. Use UTF-8 academic text, up to 20,000 characters per file, without credentials or binary content.",
      );
    } finally {
      await file?.close();
    }
  }
  return files;
}
