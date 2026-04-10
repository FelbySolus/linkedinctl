import { ensureLoggedIn, withSession } from '../core/session.js';
import { extractProfileTexts } from '../actions/text.js';
import { snap } from '../actions/helpers.js';
import type { PullResult, RuntimeConfig } from '../core/runtime-types.js';
import type { RunLog } from '../core/runlog.js';

export async function runPull(config: RuntimeConfig, runLog: RunLog): Promise<PullResult> {
  return withSession(config, runLog, async ({ page }) => {
    await ensureLoggedIn(page, runLog);

    await page.goto(config.targetProfileUrl, { waitUntil: 'domcontentloaded' });
    runLog.event('profile_opened', { url: page.url() });
    await snap(page, runLog, 'pull-profile');

    const profileText = await extractProfileTexts(page);
    const payload: PullResult = {
      ok: true,
      profile_url: page.url(),
      headline: profileText.headline,
      about: profileText.about,
    };

    runLog.event('pull_complete', { headline_length: payload.headline.length, about_length: payload.about.length });
    return payload;
  });
}
