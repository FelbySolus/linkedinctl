import type { BrowserContext, Locator, Page } from 'patchright';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type Pattern = RegExp | string;

export type CommandName = 'readiness' | 'login' | 'pull' | 'apply-operation';

export type LiveTextOperation = {
  op: 'set_headline' | 'set_about';
  value: string;
  idempotency_key?: string;
};

export type LivePhotoOperation = {
  op: 'set_profile_photo' | 'set_cover_photo';
  file: string;
  idempotency_key?: string;
};

export type LiveOperation = LiveTextOperation | LivePhotoOperation;

export type RuntimePayload = {
  workspace_root?: string;
  timeout_ms?: number;
  headless?: boolean;
  retain_run_artifacts?: boolean;
  user_data_dir?: string;
  target_profile_url?: string;
  locale?: string;
  operation?: LiveOperation;
  login_wait_ms?: number;
};

export type RuntimeConfig = {
  workspaceRoot: string;
  stateDir: string;
  runRoot: string;
  userDataDir: string;
  timeoutMs: number;
  headless: boolean;
  retainRunArtifacts: boolean;
  targetProfileUrl: string;
  locale: string;
};

export type SessionContext = {
  context: BrowserContext;
  page: Page;
};

export type PageLike = Page | Locator;

export type ReadinessResult = {
  ok: true;
  headless: boolean;
  user_data_dir: string;
  user_data_dir_exists: boolean;
  target_profile_url: string;
  note: string;
};

export type PullResult = {
  ok: true;
  profile_url: string;
  headline: string;
  about: string;
};

export type LoginSuccessResult = {
  ok: true;
  authenticated: true;
  profile_hint_url: string;
};

export type LoginTimeoutResult = {
  ok: false;
  authenticated: false;
  error: string;
  current_url: string;
};

export type LoginResult = LoginSuccessResult | LoginTimeoutResult;

export type ApplyOperationResult = {
  ok: true;
  op: LiveOperation['op'];
  changed: boolean;
  details: JsonObject;
};

export type CommandResult = ReadinessResult | PullResult | LoginResult | ApplyOperationResult;

export type RunMetadata = {
  run: {
    id: string;
    dir: string;
    events_file: string;
    summary_file: string;
    retained: boolean;
  };
};

export type CommandResponse = CommandResult & RunMetadata;
