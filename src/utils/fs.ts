import { mkdir, access } from "fs/promises";
import { constants } from "fs";

export async function ensureDir(path: string) {
  try {
    await access(path, constants.F_OK);
  } catch {
    await mkdir(path, { recursive: true });
  }
}
