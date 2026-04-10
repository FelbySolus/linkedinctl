import path from 'node:path';

import { resolveMaybeRelative } from './io.js';
import type { RuntimeConfig, RuntimePayload } from './runtime-types.js';

export function buildRuntimeConfig(payload: RuntimePayload): RuntimeConfig {
  const workspaceRoot = path.resolve(payload.workspace_root ?? process.cwd());
  const timeoutMs = payload.timeout_ms ?? 30000;
  const headless = payload.headless !== false;
  const retainRunArtifacts = payload.retain_run_artifacts === true;

  const stateDir = path.resolve(workspaceRoot, 'state');
  const runRoot = path.resolve(stateDir, 'runs');
  const userDataDir = resolveMaybeRelative(workspaceRoot, payload.user_data_dir ?? path.join('state', 'browser-profile'));

  return {
    workspaceRoot,
    stateDir,
    runRoot,
    userDataDir,
    timeoutMs,
    headless,
    retainRunArtifacts,
    targetProfileUrl: payload.target_profile_url ?? process.env.LINKEDIN_PROFILE_URL ?? 'https://www.linkedin.com/in/me/',
    locale: payload.locale ?? 'en-US',
  };
}
