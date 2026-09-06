import { safeStorage } from "electron";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parseEnv } from "node:util";
export class ProviderCredentials {
  private path: string;
  constructor(
    directory: string,
    private developmentPath?: string,
  ) {
    this.path = join(directory, "openrouter-key.enc");
  }
  status() {
    const source = this.developmentKey()
      ? ("development-env" as const)
      : existsSync(this.path)
        ? ("saved-user-key" as const)
        : null;
    return {
      source,
      configured: source !== null,
      secureStorage: safeStorage.isEncryptionAvailable(),
    };
  }
  save(raw: unknown) {
    const key = parseKey(raw);
    if (!safeStorage.isEncryptionAvailable())
      throw Error(
        "Secure credential storage is unavailable. The key was not saved.",
      );
    const temporary = this.path + ".tmp";
    writeFileSync(temporary, safeStorage.encryptString(key), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
  read() {
    const developmentKey = this.developmentKey();
    if (developmentKey) return developmentKey;
    if (!safeStorage.isEncryptionAvailable() || !existsSync(this.path))
      throw Error("Connect an AI provider in Settings first.");
    try {
      return parseKey(safeStorage.decryptString(readFileSync(this.path)));
    } catch {
      throw Error(
        "The stored provider key could not be unlocked. Reconnect it in Settings.",
      );
    }
  }
  importFile(path: string) {
    this.save(readKeyFile(path));
  }
  private developmentKey() {
    if (!this.developmentPath || !existsSync(this.developmentPath))
      return undefined;
    return readKeyFile(this.developmentPath, true);
  }
  remove() {
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}

function parseKey(raw: unknown) {
  const parsed = z
    .string()
    .trim()
    .max(500)
    .regex(/^sk-or-v1-[A-Za-z0-9_-]{20,}$/)
    .safeParse(raw);
  if (!parsed.success) throw Error("A valid OpenRouter key is required.");
  return parsed.data;
}
function readKeyFile(path: string, optional = false) {
  try {
    if (statSync(path).size > 20000) throw Error();
    const text = readFileSync(path, "utf8").trim();
    const value = text.startsWith("sk-or-v1-")
      ? text
      : parseEnv(text).OPENROUTER_API_KEY;
    if (optional && !value) return undefined;
    return parseKey(value);
  } catch {
    throw Error("Could not read an OpenRouter key from this file.");
  }
}
