import type { JsonObject } from './runtime-types.js';

export class RunnerError extends Error {
  code: string;
  details: JsonObject;

  constructor(message: string, code = 'runner_error', details: JsonObject = {}) {
    super(message);
    this.name = 'RunnerError';
    this.code = code;
    this.details = details;
  }
}
