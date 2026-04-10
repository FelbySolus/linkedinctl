import { ensureLoggedIn, withSession } from '../core/session.js';
import { extractProfileTexts } from '../actions/text.js';
import { extractSkills } from '../actions/skills.js';
import { extractExperiences } from '../actions/experience.js';
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
    const skills = await extractSkills(page, runLog).catch(() => [] as string[]);
    const experiences = await extractExperiences(page, runLog).catch(
      () => [] as NonNullable<PullResult['experiences']>,
    );
    const payload: PullResult = {
      ok: true,
      profile_url: page.url(),
      headline: profileText.headline,
      about: profileText.about,
      skills,
      experiences,
    };

    runLog.event('pull_complete', {
      headline_length: payload.headline.length,
      about_length: payload.about.length,
      skills_count: skills.length,
      experiences_count: experiences.length,
    });
    return payload;
  });
}
