import { createHash } from 'node:crypto';

import { RunnerError } from '../core/errors.js';
import { SAVE_BUTTON_PATTERNS } from '../selectors/profile.js';

import { clickSaveButton, fillFirstVisible, snap, waitShort } from './helpers.js';
import { getProfileBaseUrl } from './text.js';
import type { Page, Locator } from 'patchright';
import type { LiveExperience, LiveExperiencePatch } from '../core/runtime-types.js';
import type { RunLog } from '../core/runlog.js';

type ExperienceEntry = LiveExperience & {
  form_id: string;
  edit_url: string;
};

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseYearMonth(value: string): { year: string; month: string } | null {
  const match = String(value || '')
    .trim()
    .match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const year = match[1];
  const month = match[2] || '01';
  return { year, month };
}

function parseFormIdFromHref(value: string): string {
  const match = String(value || '').match(/\/details\/experience\/edit\/forms\/([^/?#]+)/i);
  return normalizeText(match?.[1] || '');
}

function parseFormIdFromId(value: string): string {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }
  const hrefMatch = parseFormIdFromHref(raw);
  if (hrefMatch) {
    return hrefMatch;
  }
  const explicit = raw.match(/^(?:li-form-|form-|exp-form-)(\d{5,})$/i);
  if (explicit && explicit[1]) {
    return explicit[1];
  }
  const plainNumeric = raw.match(/^(\d{5,})$/);
  return plainNumeric?.[1] || '';
}

function deriveExperienceId(title: string, company: string, start: string, rawId: string): string {
  const formId = parseFormIdFromId(rawId);
  if (formId) {
    return `li-form-${formId}`;
  }

  const seed = `${normalizeText(title)}|${normalizeText(company)}|${normalizeText(start)}`;
  return `exp-${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`;
}

function monthNameCandidates(month: string): string[] {
  const index = Math.max(1, Math.min(12, Number(month || 1)));
  const english = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const portuguese = [
    'janeiro',
    'fevereiro',
    'março',
    'abril',
    'maio',
    'junho',
    'julho',
    'agosto',
    'setembro',
    'outubro',
    'novembro',
    'dezembro',
  ];

  const en = english[index - 1] || '';
  const pt = portuguese[index - 1] || '';
  const two = month.padStart(2, '0');
  const one = String(Number(two));
  const out = [two, one, en, en.slice(0, 3), pt, pt.slice(0, 3)].filter(Boolean);
  return Array.from(new Set(out.map((item) => item.toLowerCase())));
}

async function gotoWithRetry(page: Page, target: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(target, { waitUntil: 'domcontentloaded' });
      return;
    } catch (error) {
      lastError = error;
      if (!String(error).includes('ERR_ABORTED') || attempt === 1) {
        throw error;
      }
      await waitShort(page, 600);
    }
  }
  if (lastError) {
    throw lastError;
  }
}

async function navigateToExperience(page: Page, runLog: RunLog, profileBase: string): Promise<void> {
  const target = `${profileBase}/details/experience/`;
  await gotoWithRetry(page, target);
  runLog.event('navigate_experience', { target });
  await page
    .waitForFunction(
      () => {
        const path = location.pathname || '';
        const onDetails = /\/details\/experience\/?$/i.test(path);
        if (!onDetails) {
          return false;
        }
        const hasEditLinks = Boolean(document.querySelector('a[href*="/details/experience/edit/forms/"]'));
        const hasAddControl = Boolean(
          document.querySelector(
            'button[aria-label*="Add a position"], button[aria-label*="Adicionar cargo"], a[href*="/details/experience/edit/forms/new/"]',
          ),
        );
        return hasEditLinks || hasAddControl;
      },
      { timeout: 30000 },
    )
    .catch(() => {});
  await waitShort(page, 400);
}

async function isExperienceEditorVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const path = location.pathname || '';
    if (!/\/details\/experience\/edit\/forms\//i.test(path)) {
      return false;
    }

    const root = document.querySelector('div[role="dialog"], .artdeco-modal') || document;

    const hasSave = Array.from(root.querySelectorAll('button')).some((button) => {
      const text = (button.textContent || '').trim();
      return /save|salvar|guardar|concluir|done/i.test(text);
    });

    const textInputCount = Array.from(root.querySelectorAll('input')).filter((input) => {
      const element = input as HTMLInputElement;
      if (!element.offsetParent) {
        return false;
      }
      const type = (element.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio' || type === 'hidden') {
        return false;
      }
      const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
      return !placeholder.includes('search');
    }).length;

    return hasSave && textInputCount >= 2;
  });
}

async function waitForExperienceEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const path = location.pathname || '';
      if (!/\/details\/experience\/edit\/forms\//i.test(path)) {
        return false;
      }

      const root = document.querySelector('div[role="dialog"], .artdeco-modal') || document;

      const hasSave = Array.from(root.querySelectorAll('button')).some((button) => {
        const text = (button.textContent || '').trim();
        return /save|salvar|guardar|concluir|done/i.test(text);
      });

      const textInputCount = Array.from(root.querySelectorAll('input')).filter((input) => {
        const element = input as HTMLInputElement;
        if (!element.offsetParent) {
          return false;
        }
        const type = (element.getAttribute('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio' || type === 'hidden') {
          return false;
        }
        const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
        return !placeholder.includes('search');
      }).length;

      return hasSave && textInputCount >= 2;
    },
    { timeout: 60000 },
  );
}

function cleanForSelector(value: string): string {
  return value.replace(/"/g, '\\"');
}

async function selectOptionByCandidates(
  select: Locator,
  candidates: readonly string[],
  runLog: RunLog,
  label: string,
): Promise<boolean> {
  const normalizedCandidates = candidates.map((item) => normalizeText(item).toLowerCase()).filter(Boolean);
  if (!normalizedCandidates.length) {
    return false;
  }

  for (const candidate of normalizedCandidates) {
    try {
      await select.selectOption({ value: candidate }, { timeout: 1200 });
      runLog.event('experience_select', { label, value: candidate, mode: 'value' });
      return true;
    } catch {
      continue;
    }
  }

  const options = await select
    .evaluate((node) =>
      Array.from((node as HTMLSelectElement).options).map((option) => ({
        value: String(option.value || ''),
        text: String(option.text || ''),
      })),
    )
    .catch(() => [] as Array<{ value: string; text: string }>);

  for (const option of options) {
    const optionValue = normalizeText(option.value).toLowerCase();
    const optionText = normalizeText(option.text).toLowerCase();
    if (!optionValue && !optionText) {
      continue;
    }

    const matched = normalizedCandidates.some(
      (candidate) =>
        candidate === optionValue ||
        candidate === optionText ||
        optionValue.includes(candidate) ||
        optionText.includes(candidate),
    );

    if (!matched) {
      continue;
    }

    try {
      await select.selectOption({ value: option.value }, { timeout: 1200 });
      runLog.event('experience_select', { label, value: option.value, mode: 'option' });
      return true;
    } catch {
      continue;
    }
  }

  return false;
}

async function selectDialogSelectByLabelOccurrence(
  page: Page,
  runLog: RunLog,
  labelMatcher: RegExp,
  occurrence: number,
  candidates: readonly string[],
  label: string,
): Promise<boolean> {
  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;

  const labels = root.locator('label');
  const count = await labels.count();
  const matching: Locator[] = [];

  for (let index = 0; index < count; index += 1) {
    const current = labels.nth(index);
    if (!(await current.isVisible().catch(() => false))) {
      continue;
    }
    const text = normalizeText((await current.innerText().catch(() => '')) || '');
    if (!labelMatcher.test(text)) {
      continue;
    }
    matching.push(current);
  }

  if (matching.length <= occurrence) {
    return false;
  }

  const target = matching[occurrence];
  const forId = normalizeText((await target.getAttribute('for')) || '');

  let select = root.locator('select').first();
  if (forId) {
    const safeId = cleanForSelector(forId);
    const direct = root.locator(`select[id="${safeId}"]`).first();
    if ((await direct.count()) && (await direct.isVisible().catch(() => false))) {
      select = direct;
    }
  }

  if (!(await select.count()) || !(await select.isVisible().catch(() => false))) {
    const nextSelect = target.locator('xpath=following::select[1]').first();
    if ((await nextSelect.count()) && (await nextSelect.isVisible().catch(() => false))) {
      select = nextSelect;
    }
  }

  if (!(await select.count()) || !(await select.isVisible().catch(() => false))) {
    return false;
  }

  return selectOptionByCandidates(select, candidates, runLog, label);
}

async function setDateFields(page: Page, runLog: RunLog, prefix: 'start' | 'end', value: string): Promise<void> {
  const parsed = parseYearMonth(value);
  if (!parsed) {
    return;
  }

  const occurrence = prefix === 'start' ? 0 : 1;
  const monthCandidates = monthNameCandidates(parsed.month);
  const yearCandidates = [parsed.year];

  const monthSet = await selectDialogSelectByLabelOccurrence(
    page,
    runLog,
    /month|m[eê]s/i,
    occurrence,
    monthCandidates,
    `${prefix}_month`,
  );

  const yearSet = await selectDialogSelectByLabelOccurrence(
    page,
    runLog,
    /year|ano/i,
    occurrence,
    yearCandidates,
    `${prefix}_year`,
  );

  runLog.event('experience_date_set', { prefix, month_set: monthSet, year_set: yearSet });
}

async function fillDialogInputByPosition(
  page: Page,
  runLog: RunLog,
  value: string,
  position: number,
  label: string,
): Promise<boolean> {
  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;
  const inputs = root.locator('input:not([type]), input[type="text"]');
  const count = await inputs.count();

  let visibleIndex = 0;
  for (let index = 0; index < count; index += 1) {
    const current = inputs.nth(index);
    if (!(await current.isVisible().catch(() => false))) {
      continue;
    }

    const placeholder = normalizeText((await current.getAttribute('placeholder')) || '').toLowerCase();
    if (placeholder.includes('search') || placeholder.includes('london') || placeholder.includes('software engineer')) {
      continue;
    }

    if (visibleIndex !== position) {
      visibleIndex += 1;
      continue;
    }

    await current.fill(value, { timeout: 6000 });
    runLog.event('fill_selector', { label, selector: `input_by_position_${position}`, length: value.length, mode: 'input' });
    return true;
  }

  return false;
}

async function fillPrimaryExperienceFields(
  page: Page,
  runLog: RunLog,
  title: string,
  company: string,
): Promise<void> {
  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;

  const titleSelectors = [
    'input[placeholder*="Retail Sales Manager"]',
    'input[placeholder*="Sales Manager"]',
    'input[placeholder*="Cargo"]',
    'input[placeholder*="Título"]',
    'input[placeholder*="Title"]',
  ];

  const companySelectors = [
    'input[placeholder*="Microsoft"]',
    'input[placeholder*="Empresa"]',
    'input[placeholder*="Company"]',
    'input[placeholder*="organization"]',
    'input[placeholder*="organização"]',
  ];

  try {
    await fillFirstVisible(root, titleSelectors, title, runLog, 'experience_title', page);
  } catch {
    const fallbackTitle = await fillDialogInputByPosition(page, runLog, title, 0, 'experience_title_fallback');
    if (!fallbackTitle) {
      throw new RunnerError('Could not locate experience title field.', 'experience_title_not_found');
    }
  }

  try {
    await fillFirstVisible(root, companySelectors, company, runLog, 'experience_company', page);
  } catch {
    const fallbackCompany = await fillDialogInputByPosition(page, runLog, company, 1, 'experience_company_fallback');
    if (!fallbackCompany) {
      throw new RunnerError('Could not locate experience company field.', 'experience_company_not_found');
    }
  }

  await waitShort(page, 250);
  await page.keyboard.press('Enter').catch(() => {});
}

async function fillDescriptionField(page: Page, runLog: RunLog, description: string): Promise<void> {
  if (!normalizeText(description)) {
    return;
  }

  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;
  await fillFirstVisible(
    root,
    [
      'textarea[aria-label*="Descrição"]',
      'textarea[aria-label*="Description"]',
      'textarea[placeholder*="Description"]',
      'textarea',
      '[role="textbox"][contenteditable="true"]',
    ],
    description,
    runLog,
    'experience_description',
    page,
  );
}

async function fillExperienceForm(
  page: Page,
  runLog: RunLog,
  experience: LiveExperience,
  patch?: LiveExperiencePatch,
): Promise<void> {
  const shouldSet = (key: keyof LiveExperience): boolean => {
    if (!patch) {
      return true;
    }
    return Object.prototype.hasOwnProperty.call(patch, key);
  };

  if (shouldSet('title') || shouldSet('company')) {
    const title = normalizeText(patch?.title ?? experience.title);
    const company = normalizeText(patch?.company ?? experience.company);

    if (!title || !company) {
      throw new RunnerError('Experience title and company are required.', 'experience_required_fields_missing', {
        title,
        company,
      });
    }

    await fillPrimaryExperienceFields(page, runLog, title, company);
  }

  if (shouldSet('description')) {
    await fillDescriptionField(page, runLog, normalizeText(patch?.description ?? experience.description));
  }

  if (shouldSet('start')) {
    await setDateFields(page, runLog, 'start', patch?.start ?? experience.start);
  }
  if (shouldSet('end')) {
    await setDateFields(page, runLog, 'end', patch?.end ?? experience.end);
  }
}

async function collectExperienceEntries(page: Page): Promise<ExperienceEntry[]> {
  const rows = await page.evaluate(() => {
    function clean(value: string): string {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function parseLabel(ariaLabel: string): { title: string; company: string } {
      const aria = clean(ariaLabel);
      if (!aria) {
        return { title: '', company: '' };
      }

      const en = aria.match(/^Edit\s+(.+?)\s+at\s+(.+)$/i);
      if (en && en[1] && en[2]) {
        return { title: clean(en[1]), company: clean(en[2]) };
      }

      const pt = aria.match(/^Editar\s+(.+?)\s+na empresa\s+(.+)$/i);
      if (pt && pt[1] && pt[2]) {
        return { title: clean(pt[1]), company: clean(pt[2]) };
      }

      return { title: '', company: '' };
    }

    function parseDateLine(lines: string[]): { start: string; end: string } {
      const dateLine = lines.find((line) => /\d{4}/.test(line) && /-|present|momento|at[eé]|o momento/i.test(line)) || '';
      const years = dateLine.match(/\d{4}/g) || [];
      return {
        start: years[0] ? `${years[0]}-01` : '',
        end: years[1] ? `${years[1]}-01` : '',
      };
    }

    const links = Array.from(document.querySelectorAll('a[href*="/details/experience/edit/forms/"]'));
    const payload: Array<{
      form_id: string;
      edit_url: string;
      title: string;
      company: string;
      start: string;
      end: string;
      description: string;
    }> = [];

    for (const link of links) {
      const anchor = link as HTMLAnchorElement;
      const href = anchor.href || anchor.getAttribute('href') || '';
      if (!href) {
        continue;
      }

      const formId = href.match(/\/details\/experience\/edit\/forms\/([^/?#]+)/i)?.[1] || '';
      if (!formId || /^new$/i.test(formId) || /career-break/i.test(formId)) {
        continue;
      }

      const parsed = parseLabel(anchor.getAttribute('aria-label') || '');
      let title = parsed.title;
      let company = parsed.company;

      const row = anchor.closest('li, .pvs-list__paged-list-item, .artdeco-list__item, .pvs-entity');
      const lines = clean((row as HTMLElement | null)?.innerText || '')
        .split('\n')
        .map((line) => clean(line))
        .filter(Boolean);

      if (!title && lines.length) {
        title = lines[0] || '';
      }

      if (!company) {
        const candidate = lines.find((line, index) => {
          if (index === 0) {
            return false;
          }
          if (/\d{4}/.test(line)) {
            return false;
          }
          if (/^edit\b|^editar\b/i.test(line)) {
            return false;
          }
          return true;
        });
        company = clean((candidate || '').split('·')[0] || '');
      }

      const dates = parseDateLine(lines);
      const description = lines.find((line) => line.length > 60 && line !== title && line !== company) || '';

      if (!title || !company) {
        continue;
      }

      payload.push({
        form_id: clean(formId),
        edit_url: href,
        title: clean(title),
        company: clean(company),
        start: clean(dates.start),
        end: clean(dates.end),
        description: clean(description),
      });
    }

    return payload;
  });

  const deduped: ExperienceEntry[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const formId = normalizeText(row.form_id);
    if (!formId || seen.has(formId)) {
      continue;
    }

    seen.add(formId);
    deduped.push({
      id: deriveExperienceId(row.title, row.company, row.start, `li-form-${formId}`),
      form_id: formId,
      edit_url: normalizeText(row.edit_url),
      title: normalizeText(row.title),
      company: normalizeText(row.company),
      start: normalizeText(row.start),
      end: normalizeText(row.end),
      description: normalizeText(row.description),
    });
  }

  return deduped;
}

async function experienceExists(page: Page, title: string, company: string): Promise<boolean> {
  const targetTitle = normalizeText(title).toLowerCase();
  const targetCompany = normalizeText(company).toLowerCase();

  if (!targetTitle && !targetCompany) {
    return false;
  }

  const entries = await collectExperienceEntries(page);
  return entries.some((entry) => {
    const titleOk = targetTitle ? entry.title.toLowerCase().includes(targetTitle) : true;
    const companyOk = targetCompany ? entry.company.toLowerCase().includes(targetCompany) : true;
    return titleOk && companyOk;
  });
}

async function resolveExperienceEditorUrl(
  page: Page,
  runLog: RunLog,
  profileBase: string,
  id: string,
  experienceHint?: LiveExperience,
): Promise<string> {
  const directFormId = parseFormIdFromId(id);
  if (directFormId) {
    return `${profileBase}/details/experience/edit/forms/${directFormId}/`;
  }

  await navigateToExperience(page, runLog, profileBase);
  await waitShort(page, 1000);
  const entries = await collectExperienceEntries(page);

  const byId = entries.find((entry) => entry.id === id);
  if (byId) {
    return byId.edit_url;
  }

  if (experienceHint) {
    const title = normalizeText(experienceHint.title).toLowerCase();
    const company = normalizeText(experienceHint.company).toLowerCase();
    const match = entries.find((entry) => entry.title.toLowerCase().includes(title) && entry.company.toLowerCase().includes(company));
    if (match) {
      return match.edit_url;
    }
  }

  return '';
}

async function openExperienceEditor(
  page: Page,
  runLog: RunLog,
  profileBase: string,
  id: string,
  experienceHint?: LiveExperience,
): Promise<void> {
  const target = await resolveExperienceEditorUrl(page, runLog, profileBase, id, experienceHint);
  if (!target) {
    throw new RunnerError('Could not resolve experience edit URL.', 'experience_edit_url_not_found', {
      id,
      title: experienceHint?.title || '',
      company: experienceHint?.company || '',
    });
  }

  await gotoWithRetry(page, target);
  runLog.event('navigate_experience_edit', { id, target });
  await waitForExperienceEditor(page);
}

export async function extractExperiences(page: Page, runLog: RunLog): Promise<LiveExperience[]> {
  const profileBase = await getProfileBaseUrl(page);
  if (!profileBase) {
    return [];
  }

  await navigateToExperience(page, runLog, profileBase);
  await waitShort(page, 1100);

  const rows = await collectExperienceEntries(page);
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    company: row.company,
    start: row.start,
    end: row.end,
    description: row.description,
  }));
}

export async function addExperience(
  page: Page,
  runLog: RunLog,
  experience: LiveExperience,
): Promise<{ changed: boolean; id: string; title: string; company: string }> {
  await snap(page, runLog, 'experience-add-before');
  const profileBase = await getProfileBaseUrl(page);
  if (!profileBase) {
    throw new RunnerError('Could not resolve LinkedIn profile base URL.', 'profile_base_not_found');
  }

  const target = `${profileBase}/details/experience/edit/forms/new/`;
  await gotoWithRetry(page, target);
  runLog.event('navigate_experience_add', { target });
  await waitForExperienceEditor(page);

  await fillExperienceForm(page, runLog, experience);
  await clickSaveButton(page, SAVE_BUTTON_PATTERNS, runLog);
  await waitShort(page, 1900);

  await navigateToExperience(page, runLog, profileBase);
  await waitShort(page, 1200);
  const changed = await experienceExists(page, experience.title, experience.company);
  await snap(page, runLog, 'experience-add-after');
  return {
    changed,
    id: experience.id,
    title: experience.title,
    company: experience.company,
  };
}

export async function updateExperience(
  page: Page,
  runLog: RunLog,
  id: string,
  patch: LiveExperiencePatch,
  experienceHint?: LiveExperience,
): Promise<{ changed: boolean; id: string }> {
  if (!experienceHint && !parseFormIdFromId(id)) {
    throw new RunnerError('update_experience requires experience hint or form-id based id.', 'experience_hint_missing', {
      id,
    });
  }

  await snap(page, runLog, 'experience-update-before');
  const profileBase = await getProfileBaseUrl(page);
  if (!profileBase) {
    throw new RunnerError('Could not resolve LinkedIn profile base URL.', 'profile_base_not_found');
  }

  await openExperienceEditor(page, runLog, profileBase, id, experienceHint);

  const baseline: LiveExperience =
    experienceHint ||
    ({
      id,
      title: normalizeText(patch.title || ''),
      company: normalizeText(patch.company || ''),
      start: normalizeText(patch.start || ''),
      end: normalizeText(patch.end || ''),
      description: normalizeText(patch.description || ''),
    } as LiveExperience);

  await fillExperienceForm(page, runLog, baseline, patch);
  await clickSaveButton(page, SAVE_BUTTON_PATTERNS, runLog);
  await waitShort(page, 1800);

  await navigateToExperience(page, runLog, profileBase);
  await waitShort(page, 1200);
  await snap(page, runLog, 'experience-update-after');
  return {
    changed: true,
    id,
  };
}

export async function removeExperience(
  page: Page,
  runLog: RunLog,
  id: string,
  experienceHint?: LiveExperience,
): Promise<{ changed: boolean; id: string }> {
  if (!experienceHint && !parseFormIdFromId(id)) {
    throw new RunnerError('remove_experience requires experience hint or form-id based id.', 'experience_hint_missing', {
      id,
    });
  }

  await snap(page, runLog, 'experience-remove-before');
  const profileBase = await getProfileBaseUrl(page);
  if (!profileBase) {
    throw new RunnerError('Could not resolve LinkedIn profile base URL.', 'profile_base_not_found');
  }

  await openExperienceEditor(page, runLog, profileBase, id, experienceHint);

  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;
  const deleteButton = root
    .locator(
      'button:has-text("Delete"), button:has-text("Remove"), button:has-text("Excluir"), button:has-text("Remover")',
    )
    .first();

  if (!(await deleteButton.count()) || !(await deleteButton.isVisible().catch(() => false))) {
    throw new RunnerError('Could not locate delete action in experience editor.', 'experience_delete_control_not_found', {
      id,
    });
  }

  await deleteButton.click({ timeout: 5000, force: true });
  runLog.event('experience_delete_click', { id });
  await waitShort(page, 600);

  const confirmDelete = page
    .locator(
      '[role="dialog"] button:has-text("Delete"), [role="dialog"] button:has-text("Remove"), [role="dialog"] button:has-text("Excluir"), [role="dialog"] button:has-text("Remover"), dialog button:has-text("Delete"), dialog button:has-text("Excluir")',
    );
  const confirmCount = await confirmDelete.count();
  for (let index = confirmCount - 1; index >= 0; index -= 1) {
    const candidate = confirmDelete.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    await candidate.click({ timeout: 5000, force: true });
    runLog.event('experience_delete_confirm', { id, index });
    break;
  }

  await waitShort(page, 1800);
  await navigateToExperience(page, runLog, profileBase);
  await waitShort(page, 1000);

  let changed = true;
  if (experienceHint) {
    const stillExists = await experienceExists(page, experienceHint.title, experienceHint.company);
    changed = !stillExists;
  } else {
    const formId = parseFormIdFromId(id);
    if (formId) {
      const rows = await collectExperienceEntries(page);
      changed = !rows.some((row) => row.form_id === formId);
    }
  }

  await snap(page, runLog, 'experience-remove-after');
  return {
    changed,
    id,
  };
}
