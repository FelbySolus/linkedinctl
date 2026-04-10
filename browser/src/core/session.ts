import path from 'node:path';

import { chromium } from 'patchright';
import type { Page } from 'patchright';

import { RunnerError } from './errors.js';
import type { RuntimeConfig, SessionContext } from './runtime-types.js';
import type { RunLog } from './runlog.js';

export async function withSession<T>(
  config: RuntimeConfig,
  runLog: RunLog,
  fn: (ctx: SessionContext) => Promise<T>,
): Promise<T> {
  runLog.event('session_start', {
    headless: config.headless,
    user_data_dir: config.userDataDir,
    target_profile_url: config.targetProfileUrl,
  });

  const context = await chromium.launchPersistentContext(config.userDataDir, {
    channel: 'chrome',
    headless: config.headless,
    viewport: { width: 1440, height: 1200 },
    locale: config.locale,
  });

  context.setDefaultTimeout(config.timeoutMs);
  context.setDefaultNavigationTimeout(config.timeoutMs);

  let page = context.pages()[0] || null;
  if (!page) {
    page = await context.newPage();
  }

  try {
    const value = await fn({ context, page });
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    runLog.event('session_error', { message });
    throw error;
  } finally {
    try {
      const shot = path.join(runLog.screenshotDir, 'final.png');
      await page.screenshot({ path: shot, fullPage: true });
      runLog.event('screenshot', { path: shot });
    } catch {
      runLog.event('screenshot_skipped');
    }
    await context.close();
    runLog.event('session_closed');
  }
}

export async function ensureLoggedIn(page: Page, runLog: RunLog): Promise<void> {
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
  const currentUrl = page.url();
  runLog.event('auth_probe', { current_url: currentUrl });
  if (currentUrl.includes('/login') || currentUrl.includes('/checkpoint/')) {
    throw new RunnerError(
      'LinkedIn session is not authenticated. Run in headed mode and log in first.',
      'not_authenticated',
      { current_url: currentUrl },
    );
  }
}
