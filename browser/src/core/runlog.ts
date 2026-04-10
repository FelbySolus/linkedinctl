import fs from 'node:fs';
import path from 'node:path';

import { appendJsonl, ensureDir, nowStamp, writeJsonFile } from './io.js';
import type { JsonObject } from './runtime-types.js';

type RunLogConfig = {
  runRoot: string;
};

export class RunLog {
  runId: string;
  commandName: string;
  runDir: string;
  artifactDir: string;
  screenshotDir: string;
  eventsFile: string;
  summaryFile: string;

  constructor(config: RunLogConfig, commandName: string) {
    const runId = `${nowStamp()}-${Math.random().toString(36).slice(2, 8)}`;
    this.runId = runId;
    this.commandName = commandName;
    this.runDir = ensureDir(path.join(config.runRoot, commandName, runId));
    const metaDir = ensureDir(path.join(this.runDir, 'meta'));
    this.artifactDir = ensureDir(path.join(this.runDir, 'artifacts'));
    this.screenshotDir = ensureDir(path.join(this.artifactDir, 'screenshots'));
    this.eventsFile = path.join(metaDir, 'events.jsonl');
    this.summaryFile = path.join(metaDir, 'summary.json');
  }

  event(name: string, data: JsonObject = {}) {
    appendJsonl(this.eventsFile, {
      ts: new Date().toISOString(),
      event: name,
      ...data,
    });
  }

  saveSummary(payload: JsonObject) {
    writeJsonFile(this.summaryFile, payload);
  }

  purge(): boolean {
    try {
      fs.rmSync(this.runDir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
}
