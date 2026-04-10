import { RunnerError } from './errors.js';
import type {
  CommandName,
  JsonObject,
  JsonValue,
  LiveOperation,
  RuntimePayload,
} from './runtime-types.js';

const BASE_PAYLOAD_FIELDS = [
  'workspace_root',
  'timeout_ms',
  'headless',
  'retain_run_artifacts',
  'user_data_dir',
  'target_profile_url',
  'locale',
] as const;

const LOGIN_EXTRA_FIELDS = ['login_wait_ms'] as const;
const APPLY_EXTRA_FIELDS = ['operation'] as const;

export type CliArgs = {
  command: CommandName;
  payloadFile: string;
};

function isJsonObject(value: JsonValue | object | null): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value: JsonValue | object | null, context: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new RunnerError(`${context} must be a JSON object.`, 'invalid_payload_shape', { context });
  }
  return value;
}

function rejectUnknownKeys(payload: JsonObject, allowedKeys: readonly string[], context: string): void {
  const allowed = new Set(allowedKeys);
  const unsupportedFields = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unsupportedFields.length > 0) {
    throw new RunnerError(
      `${context} contains unsupported fields: ${unsupportedFields.join(', ')}`,
      'unsupported_payload_fields',
      { context, unsupported_fields: unsupportedFields, allowed: [...allowed] },
    );
  }
}

function optionalString(payload: JsonObject, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new RunnerError(`${key} must be a string.`, 'invalid_payload_type', { key, actual_type: typeof value });
  }
  return value;
}

function optionalBoolean(payload: JsonObject, key: string): boolean | undefined {
  const value = payload[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new RunnerError(`${key} must be a boolean.`, 'invalid_payload_type', { key, actual_type: typeof value });
  }
  return value;
}

function optionalNumber(
  payload: JsonObject,
  key: string,
  options?: { min?: number },
): number | undefined {
  const min = options?.min ?? 1;
  const value = payload[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value < min) {
    throw new RunnerError(`${key} must be an integer >= ${min}.`, 'invalid_payload_type', {
      key,
      value,
      min,
    });
  }
  return value;
}

function parseLiveOperation(raw: JsonValue | object | null): LiveOperation {
  const operation = asObject(raw, 'operation');
  const op = optionalString(operation, 'op') || '';

  if (op === 'set_headline' || op === 'set_about') {
    rejectUnknownKeys(operation, ['op', 'value', 'idempotency_key'], 'operation');
    const value = optionalString(operation, 'value') || '';
    if (!value.trim()) {
      throw new RunnerError('operation.value must be non-empty.', 'invalid_operation_payload', {
        op,
      });
    }

    const idempotencyKey = optionalString(operation, 'idempotency_key');
    if (idempotencyKey !== undefined && !idempotencyKey.trim()) {
      throw new RunnerError('operation.idempotency_key cannot be blank.', 'invalid_operation_payload', {
        op,
      });
    }

    return idempotencyKey
      ? { op, value: value.trim(), idempotency_key: idempotencyKey.trim() }
      : { op, value: value.trim() };
  }

  if (op === 'set_profile_photo' || op === 'set_cover_photo') {
    rejectUnknownKeys(operation, ['op', 'file', 'idempotency_key'], 'operation');
    const file = optionalString(operation, 'file') || '';
    if (!file.trim()) {
      throw new RunnerError('operation.file must be non-empty.', 'invalid_operation_payload', {
        op,
      });
    }

    const idempotencyKey = optionalString(operation, 'idempotency_key');
    if (idempotencyKey !== undefined && !idempotencyKey.trim()) {
      throw new RunnerError('operation.idempotency_key cannot be blank.', 'invalid_operation_payload', {
        op,
      });
    }

    return idempotencyKey
      ? { op, file: file.trim(), idempotency_key: idempotencyKey.trim() }
      : { op, file: file.trim() };
  }

  throw new RunnerError('operation.op is invalid.', 'invalid_operation_payload', {
    op,
    allowed: ['set_headline', 'set_about', 'set_profile_photo', 'set_cover_photo'],
  });
}

function parseCommandName(value: string): CommandName {
  if (value === 'readiness' || value === 'login' || value === 'pull' || value === 'apply-operation') {
    return value;
  }
  throw new RunnerError(`Unsupported command: ${value}`, 'unsupported_command', {
    command: value,
  });
}

export function parseCliArgs(argv: string[]): CliArgs {
  let command = '';
  let payloadFile = '';

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--command') {
      command = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    if (token === '--payload-file') {
      payloadFile = String(argv[index + 1] || '');
      index += 1;
      continue;
    }
    throw new RunnerError(`Unsupported CLI argument: ${token}`, 'unsupported_cli_argument', {
      token,
      allowed: ['--command', '--payload-file'],
    });
  }

  if (!command) {
    throw new RunnerError('Missing required --command.', 'missing_command');
  }
  if (!payloadFile) {
    throw new RunnerError('Missing required --payload-file.', 'missing_payload_file');
  }

  return {
    command: parseCommandName(command),
    payloadFile,
  };
}

export function normalizePayloadForCommand(command: CommandName, rawPayload: JsonValue | object | null): RuntimePayload {
  const payload = asObject(rawPayload, 'payload');

  const allowedTopLevel: string[] = [...BASE_PAYLOAD_FIELDS];
  if (command === 'login') {
    allowedTopLevel.push(...LOGIN_EXTRA_FIELDS);
  }
  if (command === 'apply-operation') {
    allowedTopLevel.push(...APPLY_EXTRA_FIELDS);
  }
  rejectUnknownKeys(payload, allowedTopLevel, 'payload');

  const normalized: RuntimePayload = {
    workspace_root: optionalString(payload, 'workspace_root'),
    timeout_ms: optionalNumber(payload, 'timeout_ms', { min: 1000 }),
    headless: optionalBoolean(payload, 'headless'),
    retain_run_artifacts: optionalBoolean(payload, 'retain_run_artifacts'),
    user_data_dir: optionalString(payload, 'user_data_dir'),
    target_profile_url: optionalString(payload, 'target_profile_url'),
    locale: optionalString(payload, 'locale'),
  };

  if (command === 'login') {
    normalized.login_wait_ms = optionalNumber(payload, 'login_wait_ms', { min: 1000 });
  }

  if (command === 'apply-operation') {
    const operationValue = payload.operation;
    if (operationValue === undefined) {
      throw new RunnerError('payload.operation is required for apply-operation.', 'missing_operation');
    }
    normalized.operation = parseLiveOperation(operationValue);
  }

  return normalized;
}
