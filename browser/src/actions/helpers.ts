import path from 'node:path';

import { RunnerError } from '../core/errors.js';
import type { Page, Locator } from 'patchright';
import type { PageLike, Pattern } from '../core/runtime-types.js';
import type { RunLog } from '../core/runlog.js';

function hasKeyboard(root: PageLike): root is Page {
  return 'keyboard' in root;
}

async function fillLocator(page: Page, locator: Locator, value: string): Promise<'richtext' | 'input'> {
  const tagName = (await locator.evaluate((el) => el.tagName).catch(() => '')) || '';
  const role = (await locator.getAttribute('role')) || '';
  const isContentEditable = await locator
    .evaluate((el) => (el as HTMLElement).isContentEditable)
    .catch(() => false);
  const isRichText = isContentEditable || role === 'textbox' || tagName === 'DIV';

  if (isRichText) {
    await locator.click({ timeout: 5000 });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(value);
    return 'richtext';
  }

  await locator.fill(value, { timeout: 5000 });
  return 'input';
}

export async function clickButtonByPatterns(
  page: PageLike,
  patterns: readonly Pattern[],
  runLog: RunLog,
  label: string,
): Promise<boolean> {
  for (const pattern of patterns) {
    const locator = page.getByRole('button', { name: pattern });
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      await candidate.click({ timeout: 4000 });
      runLog.event('click_button', { label, pattern: String(pattern), index });
      return true;
    }
  }
  return false;
}

export async function clickSelectorList(
  page: PageLike,
  selectors: readonly string[],
  runLog: RunLog,
  label: string,
): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector);
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (!(await candidate.isVisible().catch(() => false))) {
        continue;
      }
      await candidate.click({ timeout: 4000 });
      runLog.event('click_selector', { label, selector, index });
      return true;
    }
  }
  return false;
}

export async function fillFirstVisible(
  page: PageLike,
  selectors: readonly string[],
  value: string,
  runLog: RunLog,
  label: string,
  keyboardPage?: Page,
): Promise<string> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (!(await locator.count())) {
        continue;
      }
      await locator.waitFor({ state: 'visible', timeout: 10000 });
      const keyPage = keyboardPage || (hasKeyboard(page) ? page : null);
      if (!keyPage) {
        await locator.fill(value, { timeout: 5000 });
        runLog.event('fill_selector', { label, selector, length: value.length, mode: 'input' });
        return selector;
      }
      const mode = await fillLocator(keyPage, locator, value);
      runLog.event('fill_selector', { label, selector, length: value.length, mode });
      return selector;
    } catch {
      continue;
    }
  }
  throw new RunnerError(`Could not locate input field for ${label}.`, 'input_not_found', {
    label,
    selectors: [...selectors],
  });
}

export async function readFirstText(page: PageLike, selectors: readonly string[]): Promise<string> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      const text = (await locator.innerText()).trim();
      if (text) {
        return text;
      }
    }
  }
  return '';
}

export async function clickSaveButton(
  page: PageLike,
  patterns: readonly Pattern[],
  runLog: RunLog,
): Promise<void> {
  for (const pattern of patterns) {
    const button = page.getByRole('button', { name: pattern }).first();
    if ((await button.count()) && (await button.isVisible().catch(() => false))) {
      await button.click({ timeout: 5000 });
      runLog.event('click_save', { pattern: String(pattern) });
      return;
    }
  }
  throw new RunnerError('Could not locate save button in editor modal.', 'save_button_not_found');
}

export async function snap(page: Page, runLog: RunLog, name: string): Promise<string> {
  const outputPath = path.join(runLog.screenshotDir, `${name}.png`);
  await page.screenshot({ path: outputPath, fullPage: true });
  runLog.event('screenshot', { path: outputPath, name });
  return outputPath;
}

export async function waitShort(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms);
}
