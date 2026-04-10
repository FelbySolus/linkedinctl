#!/usr/bin/env node
import { buildRuntimeConfig } from './core/config.js';
import { RunnerError } from './core/errors.js';
import { readJsonFile } from './core/io.js';
import { normalizePayloadForCommand, parseCliArgs } from './core/protocol.js';
import { RunLog } from './core/runlog.js';
import { runApplyOperation } from './commands/apply-operation.js';
import { runLogin } from './commands/login.js';
import { runPull } from './commands/pull.js';
import { runReadiness } from './commands/readiness.js';
import type {
  CommandResult,
  CommandResponse,
  JsonObject,
} from './core/runtime-types.js';

async function run() {
  const args = parseCliArgs(process.argv);
  const payload = normalizePayloadForCommand(args.command, readJsonFile(args.payloadFile));
  const config = buildRuntimeConfig(payload);
  const runLog = new RunLog(config, args.command);

  runLog.event('command_start', { command: args.command });

  let result: CommandResult;
  if (args.command === 'readiness') {
    result = await runReadiness(config, runLog);
  } else if (args.command === 'login') {
    result = await runLogin(config, runLog, payload);
  } else if (args.command === 'pull') {
    result = await runPull(config, runLog);
  } else if (args.command === 'apply-operation') {
    result = await runApplyOperation(config, runLog, payload);
  } else {
    throw new RunnerError(`Unsupported command: ${args.command}`, 'unsupported_command', {
      command: args.command,
    });
  }

  const response: CommandResponse = {
    ...result,
    run: {
      id: runLog.runId,
      dir: runLog.runDir,
      events_file: runLog.eventsFile,
      summary_file: runLog.summaryFile,
      retained: config.retainRunArtifacts,
    },
  };

  runLog.event('command_complete', { ok: Boolean(response.ok) });
  runLog.saveSummary(response);
  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);

  if (!config.retainRunArtifacts) {
    runLog.purge();
  }
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error instanceof RunnerError ? error.code : 'runner_unhandled_error';
  const details: JsonObject = error instanceof RunnerError ? error.details : {};
  process.stdout.write(
    `${JSON.stringify({ ok: false, error: message, code, details }, null, 2)}\n`,
  );
  process.exitCode = 2;
});
