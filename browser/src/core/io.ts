import fs from 'node:fs';
import path from 'node:path';
import type { JsonObject } from './runtime-types.js';

export function ensureDir(dirPath: string): string {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

export function readJsonFile(filePath: string): JsonObject {
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as JsonObject;
}

export function writeJsonFile(filePath: string, payload: JsonObject): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export function appendJsonl(filePath: string, row: JsonObject): void {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(row)}\n`, 'utf8');
}

export function nowStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function resolveMaybeRelative(workspaceRoot: string, inputPath: string): string {
  if (!inputPath) {
    return '';
  }
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(workspaceRoot, inputPath);
}
