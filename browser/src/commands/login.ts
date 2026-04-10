import { withSession } from '../core/session.js';
import { snap, waitShort } from '../actions/helpers.js';
import type { LoginResult, RuntimeConfig, RuntimePayload } from '../core/runtime-types.js';
import type { RunLog } from '../core/runlog.js';

function isLoggedInUrl(url: string): boolean {
  return url.includes('linkedin.com') && !url.includes('/login') && !url.includes('/checkpoint/');
}

export async function runLogin(
  config: RuntimeConfig,
  runLog: RunLog,
  payload: RuntimePayload,
): Promise<LoginResult> {
  const waitMs = payload.login_wait_ms ?? 300000;
  const deadline = Date.now() + waitMs;

  return withSession(config, runLog, async ({ page }) => {
    await page.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded' });
    runLog.event('login_page_opened', { url: page.url() });
    await snap(page, runLog, 'login-page');

    while (Date.now() < deadline) {
      const currentUrl = page.url();
      if (isLoggedInUrl(currentUrl)) {
        await snap(page, runLog, 'login-success');
        return {
          ok: true,
          authenticated: true,
          profile_hint_url: currentUrl,
        };
      }
      await waitShort(page, 1000);
    }

    return {
      ok: false,
      authenticated: false,
      error: 'Login timeout reached before authentication completed.',
      current_url: page.url(),
    };
  });
}
