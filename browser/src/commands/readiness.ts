import fs from 'node:fs';

import type { ReadinessResult, RuntimeConfig } from '../core/runtime-types.js';
import type { RunLog } from '../core/runlog.js';

export async function runReadiness(config: RuntimeConfig, runLog: RunLog): Promise<ReadinessResult> {
  const result: ReadinessResult = {
    ok: true,
    headless: config.headless,
    user_data_dir: config.userDataDir,
    user_data_dir_exists: fs.existsSync(config.userDataDir),
    target_profile_url: config.targetProfileUrl,
    note: 'Patchwright runtime available. Use headed mode once to establish LinkedIn session if needed.',
  };

  runLog.event('readiness', result);
  return result;
}
