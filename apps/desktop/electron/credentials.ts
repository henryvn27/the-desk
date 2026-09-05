import { safeStorage } from "electron";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { z } from "zod";
export class ProviderCredentials {
  private path: string;
  constructor(directory: string) {
    this.path = join(directory, "provider-key.enc");
  }
  status() {
    return {
      configured: existsSync(this.path),
      secureStorage: safeStorage.isEncryptionAvailable(),
    };
  }
  save(raw: unknown) {
    const key = z
      .string()
      .trim()
      .min(20)
      .max(500)
      .regex(/^[A-Za-z0-9_-]+$/)
      .parse(raw);
    if (!safeStorage.isEncryptionAvailable())
      throw Error(
        "Secure credential storage is unavailable. The key was not saved.",
      );
    const temporary = this.path + ".tmp";
    writeFileSync(temporary, safeStorage.encryptString(key), { mode: 0o600 });
    renameSync(temporary, this.path);
  }
  read() {
    if (!safeStorage.isEncryptionAvailable() || !existsSync(this.path))
      throw Error("Connect an AI provider in Settings first.");
    try {
      return safeStorage.decryptString(readFileSync(this.path));
    } catch {
      throw Error(
        "The stored provider key could not be unlocked. Reconnect it in Settings.",
      );
    }
  }
  remove() {
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}
