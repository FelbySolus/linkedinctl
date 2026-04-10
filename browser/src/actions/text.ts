import {
  ABOUT_SECTION_PICKER_PATTERNS,
  ABOUT_EDIT_BUTTON_PATTERNS,
  ABOUT_TEXT_SELECTORS,
  ABOUT_TEXTAREA_SELECTORS,
  ADD_SECTION_BUTTON_PATTERNS,
  HEADLINE_INPUT_SELECTORS,
  HEADLINE_TEXT_SELECTORS,
  INTRO_EDIT_BUTTON_PATTERNS,
  SAVE_BUTTON_PATTERNS,
} from '../selectors/profile.js';

import {
  clickButtonByPatterns,
  clickSaveButton,
  clickSelectorList,
  fillFirstVisible,
  readFirstText,
  snap,
  waitShort,
} from './helpers.js';
import type { Page, Locator } from 'patchright';
import type { Pattern } from '../core/runtime-types.js';
import type { RunLog } from '../core/runlog.js';

const INTRO_FALLBACK_SELECTORS: readonly string[] = [
  'button[aria-label*="Edit intro"]',
  'a[href*="edit/topcard"]',
  'a[href*="/edit/intro"]',
];

const ABOUT_FALLBACK_SELECTORS: readonly string[] = [
  'section:has(#about) button[aria-label*="Edit"]',
  'a[href*="overlay/edit-about"]',
  'button[aria-label*="Edit about"]',
];

const ADD_SECTION_FALLBACK_SELECTORS: readonly string[] = [
  'button:has-text("Add section")',
  'button:has-text("Add profile section")',
  'button:has-text("Adicionar seção")',
  'button:has-text("Adicionar secção")',
];

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function fillLocatorValue(
  page: Page,
  locator: Locator,
  value: string,
  runLog: RunLog,
  meta: { label: string; selector: string },
): Promise<boolean> {
  if (!(await locator.count())) {
    return false;
  }

  const target = locator.first();
  await target.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});

  const role = (await target.getAttribute('role')) || '';
  const tagName = (await target.evaluate((el) => el.tagName).catch(() => '')) || '';
  if (tagName === 'SELECT') {
    return false;
  }
  const isContentEditable = await target
    .evaluate((el) => (el as HTMLElement).isContentEditable)
    .catch(() => false);
  const richText = isContentEditable || role === 'textbox' || tagName === 'DIV';

  if (richText) {
    await target.click({ timeout: 5000 });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(value);
    runLog.event('fill_selector', { label: meta.label, selector: meta.selector, length: value.length, mode: 'richtext' });
    return true;
  }

  await target.fill(value, { timeout: 7000 });
  runLog.event('fill_selector', { label: meta.label, selector: meta.selector, length: value.length, mode: 'input' });
  return true;
}

export async function getProfileBaseUrl(page: Page): Promise<string> {
  const currentUrl = page.url();
  const currentMatch = currentUrl.match(/^https:\/\/www\.linkedin\.com\/in\/[^/?#]+/i);
  if (currentMatch) {
    return currentMatch[0];
  }

  const introLink = page.locator('a[href*="/edit/intro"]').first();
  if (await introLink.count()) {
    const href = await introLink.getAttribute('href');
    if (href) {
      const absolute = new URL(href, currentUrl).toString();
      return absolute.replace(/\/edit\/intro\/?.*$/i, '');
    }
  }

  return '';
}

async function resolveIntroEditUrl(page: Page, profileBaseUrl: string): Promise<string> {
  const introLink = page.locator('a[href*="/edit/intro"]').first();
  if (await introLink.count()) {
    const href = await introLink.getAttribute('href');
    if (href) {
      return new URL(href, page.url()).toString();
    }
  }
  if (profileBaseUrl) {
    return `${profileBaseUrl}/edit/intro/`;
  }
  return '';
}

async function resolveSummaryEditUrl(page: Page, profileBaseUrl: string): Promise<string> {
  const summaryLink = page.locator('a[href*="/edit/forms/summary/"]').first();
  if (await summaryLink.count()) {
    const href = await summaryLink.getAttribute('href');
    if (href) {
      return new URL(href, page.url()).toString();
    }
  }
  if (profileBaseUrl) {
    return `${profileBaseUrl}/edit/forms/summary/new/`;
  }
  return '';
}

async function waitForIntroEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const labels = Array.from(document.querySelectorAll('label'))
        .map((node) => (node.textContent || '').trim())
        .join(' ');
      const hasHeadlineLabel = /cargo|título|headline|title/i.test(labels);
      const hasTextbox = Boolean(document.querySelector('div[role="textbox"], textarea, input[aria-label*="Cargo"]'));
      const hasSave = Boolean(
        Array.from(document.querySelectorAll('button')).some((button) => /save|salvar|guardar|concluir/i.test((button.textContent || '').trim())),
      );
      return hasHeadlineLabel || (hasTextbox && hasSave);
    },
    { timeout: 90000 },
  );
}

async function waitForAboutEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const hasTextbox = Boolean(document.querySelector('div[role="textbox"], textarea'));
      const hasSave = Boolean(
        Array.from(document.querySelectorAll('button')).some((button) => /save|salvar|guardar|concluir/i.test((button.textContent || '').trim())),
      );
      return hasTextbox && hasSave;
    },
    { timeout: 90000 },
  );
}

async function fillHeadlineField(page: Page, runLog: RunLog, value: string): Promise<void> {
  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;

  const cargoLabeled = root.getByLabel(/Cargo|Título|Headline/i).first();
  if (await fillLocatorValue(page, cargoLabeled, value, runLog, { label: 'headline', selector: 'getByLabel(Cargo|Título|Headline)' })) {
    return;
  }

  const roleTextbox = root.locator('div[role="textbox"]').first();
  if (await fillLocatorValue(page, roleTextbox, value, runLog, { label: 'headline', selector: 'div[role="textbox"]' })) {
    return;
  }

  const titleLabel = root.locator('label:has-text("Cargo"), label:has-text("Título"), label:has-text("Headline"), label:has-text("Title")').first();
  if (await titleLabel.count()) {
    const id = await titleLabel.getAttribute('for');
    if (id) {
      const safeId = String(id).replace(/"/g, '\\"');
      const byFor = root.locator(`[id="${safeId}"]`).first();
      if (await fillLocatorValue(page, byFor, value, runLog, { label: 'headline', selector: `#${id}` })) {
        return;
      }
    }
    const nearby = titleLabel
      .locator('xpath=following::*[self::div[@role="textbox"] or self::textarea or (self::input and (not(@type) or @type="text"))][1]')
      .first();
    if (await fillLocatorValue(page, nearby, value, runLog, { label: 'headline', selector: 'label->following field' })) {
      return;
    }
  }

  await fillFirstVisible(root, HEADLINE_INPUT_SELECTORS, value, runLog, 'headline', page);
}

async function fillAboutField(page: Page, runLog: RunLog, value: string): Promise<void> {
  const textBox = page.locator('div[role="textbox"]').first();
  if (await fillLocatorValue(page, textBox, value, runLog, { label: 'about', selector: 'div[role="textbox"]' })) {
    return;
  }
  await fillFirstVisible(page, ABOUT_TEXTAREA_SELECTORS, value, runLog, 'about', page);
}

async function readHeadlineEditorValue(page: Page): Promise<string> {
  const labeled = page.getByLabel(/Cargo|Título|Headline|Title/i).first();
  if (await labeled.count()) {
    const value = await labeled.inputValue().catch(() => '');
    if (normalizeText(value)) {
      return normalizeText(value);
    }
    const text = await labeled.innerText().catch(() => '');
    if (normalizeText(text)) {
      return normalizeText(text);
    }
  }

  const box = page.locator('div[role="textbox"], textarea, input[aria-label*="Cargo"]').first();
  if (await box.count()) {
    const value = await box.inputValue().catch(() => '');
    if (normalizeText(value)) {
      return normalizeText(value);
    }
    const text = await box.innerText().catch(() => '');
    if (normalizeText(text)) {
      return normalizeText(text);
    }
    const content = await box.textContent().catch(() => '');
    return normalizeText(content || '');
  }

  return '';
}

async function readAboutEditorValue(page: Page): Promise<string> {
  const box = page.locator('div[role="textbox"], textarea').first();
  if (!(await box.count())) {
    return '';
  }
  const value = await box.inputValue().catch(() => '');
  if (normalizeText(value)) {
    return normalizeText(value);
  }
  const text = await box.innerText().catch(() => '');
  if (normalizeText(text)) {
    return normalizeText(text);
  }
  const content = await box.textContent().catch(() => '');
  return normalizeText(content || '');
}

export async function extractProfileTexts(page: Page): Promise<{ headline: string; about: string }> {
  let headline = await readFirstText(page, HEADLINE_TEXT_SELECTORS);
  let about = await readFirstText(page, ABOUT_TEXT_SELECTORS);

  if (!headline) {
    headline = await page.evaluate(() => {
      const section =
        document.querySelector('a[href*="overlay/contact-info"]')?.closest('section') ||
        document.querySelector('a[href*="overlay/contact-info"]')?.closest('main');
      if (!section) {
        return '';
      }

      const lines = section.innerText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

      if (!lines.length) {
        return '';
      }

      const titleName = (document.title || '').split('|')[0].trim();
      const startIndex = lines.findIndex((line) => line === titleName);
      const from = startIndex >= 0 ? startIndex + 1 : 1;

      for (let i = from; i < Math.min(from + 8, lines.length); i += 1) {
        const line = lines[i];
        if (!line) {
          continue;
        }
        if (/^(adicionar selo de verificação|dados de contato|disponível para|adicionar seção|aprimorar perfil|recursos|\d+\s+conexões|·)$/i.test(line)) {
          continue;
        }
        if (line.includes('·') && !/developer|desenvolvedor|engenheiro|engineer|full[- ]?stack|frontend|backend|software/i.test(line)) {
          continue;
        }
        if (line.includes(',') && /brasil|portugal|spain|espanha|rio|lisboa|london|amsterdam/i.test(line)) {
          continue;
        }
        return line;
      }
      return '';
    });
  }

  if (!about) {
    about = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h2, h3, span, div')).filter((el) =>
        /^sobre$|^about$/i.test((el.textContent || '').trim()),
      );
      for (const heading of headings) {
        const section = heading.closest('section');
        if (!section) {
          continue;
        }
        const lines = section.innerText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .filter((line) => !/^sobre$|^about$|^mostrar mais$|^show more$/i.test(line));
        const long = lines.find((line) => line.length > 40);
        if (long) {
          return long;
        }
      }
      return '';
    });
  }

  return { headline, about };
}

export async function setHeadline(
  page: Page,
  runLog: RunLog,
  value: string,
): Promise<{ changed: boolean; observed_headline: string }> {
  await snap(page, runLog, 'headline-before');

  const profileBaseUrl = await getProfileBaseUrl(page);
  const introUrl = await resolveIntroEditUrl(page, profileBaseUrl);
  let opened = false;

  if (introUrl) {
    await page.goto(introUrl, { waitUntil: 'domcontentloaded' });
    runLog.event('navigate_intro_edit', { target: introUrl });
    opened = true;
  }

  if (!opened) {
    opened = await clickButtonByPatterns(page, INTRO_EDIT_BUTTON_PATTERNS, runLog, 'intro_edit');
  }

  if (!opened) {
    opened = await clickSelectorList(page, INTRO_FALLBACK_SELECTORS, runLog, 'intro_edit_fallback');
  }

  if (!opened) {
    throw new Error('Could not open intro editor.');
  }

  await waitForIntroEditor(page);
  runLog.event('intro_form_ready', { url: page.url() });

  await fillHeadlineField(page, runLog, value);
  await clickSaveButton(page, SAVE_BUTTON_PATTERNS, runLog);
  await waitShort(page, 1800);

  let observedHeadline = await readHeadlineEditorValue(page);
  if (!observedHeadline && introUrl) {
    await page.goto(introUrl, { waitUntil: 'domcontentloaded' });
    await waitForIntroEditor(page);
    observedHeadline = await readHeadlineEditorValue(page);
  }

  if (profileBaseUrl) {
    try {
      await page.goto(`${profileBaseUrl}/`, { waitUntil: 'domcontentloaded' });
      await waitShort(page, 1200);
    } catch (error) {
      runLog.event('profile_return_failed', { op: 'set_headline', url: `${profileBaseUrl}/`, message: String(error) });
    }
  }
  await snap(page, runLog, 'headline-after');

  const { headline: profileHeadline } = await extractProfileTexts(page);
  const finalHeadline = normalizeText(profileHeadline || observedHeadline);
  const expected = normalizeText(value);
  return {
    changed: finalHeadline === expected,
    observed_headline: profileHeadline || observedHeadline,
  };
}

export async function setAbout(
  page: Page,
  runLog: RunLog,
  value: string,
): Promise<{ changed: boolean; observed_about: string }> {
  await snap(page, runLog, 'about-before');

  const profileBaseUrl = await getProfileBaseUrl(page);
  const summaryUrl = await resolveSummaryEditUrl(page, profileBaseUrl);
  let opened = false;

  if (summaryUrl) {
    await page.goto(summaryUrl, { waitUntil: 'domcontentloaded' });
    runLog.event('navigate_about_edit', { target: summaryUrl });
    opened = true;
  }

  let clicked = opened;
  if (!clicked) {
    clicked =
      (await clickButtonByPatterns(page, ABOUT_EDIT_BUTTON_PATTERNS, runLog, 'about_edit')) ||
      (await clickSelectorList(page, ABOUT_FALLBACK_SELECTORS, runLog, 'about_edit_fallback'));
  }

  if (!clicked) {
    const addSectionClicked =
      (await clickButtonByPatterns(page, ADD_SECTION_BUTTON_PATTERNS, runLog, 'add_section')) ||
      (await clickSelectorList(page, ADD_SECTION_FALLBACK_SELECTORS, runLog, 'add_section_fallback'));
    if (addSectionClicked) {
      await waitShort(page, 500);
      for (const pattern of ABOUT_SECTION_PICKER_PATTERNS as readonly Pattern[]) {
        const button = page.getByRole('button', { name: pattern }).first();
        if (await button.count()) {
          await button.click({ timeout: 4000 });
          runLog.event('about_section_add_click', { pattern: String(pattern) });
          clicked = true;
          break;
        }
        const textNode = page.getByText(pattern).first();
        if (await textNode.count()) {
          await textNode.click({ timeout: 4000 });
          runLog.event('about_section_add_text_click', { pattern: String(pattern) });
          clicked = true;
          break;
        }
      }
    }
  }

  if (!clicked) {
    throw new Error('Could not open about editor.');
  }

  await waitForAboutEditor(page);
  await waitShort(page, 700);
  await fillAboutField(page, runLog, value);
  await clickSaveButton(page, SAVE_BUTTON_PATTERNS, runLog);
  await waitShort(page, 1800);

  let observedAbout = await readAboutEditorValue(page);
  if (!observedAbout && summaryUrl) {
    await page.goto(summaryUrl, { waitUntil: 'domcontentloaded' });
    await waitForAboutEditor(page);
    observedAbout = await readAboutEditorValue(page);
  }

  if (profileBaseUrl) {
    try {
      await page.goto(`${profileBaseUrl}/`, { waitUntil: 'domcontentloaded' });
      await waitShort(page, 1200);
    } catch (error) {
      runLog.event('profile_return_failed', { op: 'set_about', url: `${profileBaseUrl}/`, message: String(error) });
    }
  }
  await snap(page, runLog, 'about-after');

  const { about: profileAbout } = await extractProfileTexts(page);
  const finalAbout = normalizeText(profileAbout || observedAbout);
  const normalizedExpected = normalizeText(value);

  return {
    changed: finalAbout.includes(normalizedExpected) || normalizedExpected.includes(finalAbout),
    observed_about: profileAbout || observedAbout,
  };
}
