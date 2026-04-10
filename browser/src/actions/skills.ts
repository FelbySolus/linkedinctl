import { RunnerError } from '../core/errors.js';
import { SAVE_BUTTON_PATTERNS } from '../selectors/profile.js';

import { clickSaveButton, fillFirstVisible, snap, waitShort } from './helpers.js';
import { getProfileBaseUrl } from './text.js';
import type { Page } from 'patchright';
import type { RunLog } from '../core/runlog.js';

type SkillEntry = {
  name: string;
  edit_url: string;
};

function normalizeText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

async function navigateToSkills(page: Page, runLog: RunLog, profileBase: string): Promise<void> {
  const target = `${profileBase}/details/skills/`;
  await gotoWithRetry(page, target);
  runLog.event('navigate_skills', { target });
  await page
    .waitForFunction(
      () => {
        const path = location.pathname || '';
        const onDetails = /\/details\/skills\/?$/i.test(path);
        if (!onDetails) {
          return false;
        }
        const hasEditLinks = Boolean(document.querySelector('a[href*="/details/skills/edit/forms/"]'));
        const hasAddControl = Boolean(
          document.querySelector(
            'a[aria-label*="Add a skill"], a[aria-label*="Adicionar competência"], a[href*="/skills/edit/forms/new/"], button[aria-label*="Add a skill"], button[aria-label*="Adicionar competência"]',
          ),
        );
        return hasEditLinks || hasAddControl;
      },
      { timeout: 30000 },
    )
    .catch(() => {});
  await waitShort(page, 300);
}

async function isSkillEditorVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const path = location.pathname || '';
    const urlOk = /\/skills\/edit\/forms\//i.test(path);
    if (!urlOk) {
      return false;
    }

    const root = document.querySelector('div[role="dialog"], .artdeco-modal') || document;
    const hasInput = Array.from(root.querySelectorAll('input')).some((input) => {
      const element = input as HTMLInputElement;
      if (!element.offsetParent) {
        return false;
      }
      const type = (element.getAttribute('type') || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio' || type === 'hidden') {
        return false;
      }
      const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
      return placeholder.includes('skill') || placeholder.includes('compet') || (placeholder && !placeholder.includes('search'));
    });

    const hasSave = Array.from(root.querySelectorAll('button')).some((button) => {
      const text = (button.textContent || '').trim();
      return /save|salvar|guardar|concluir|done/i.test(text);
    });

    return hasInput && hasSave;
  });
}

async function waitForSkillEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const path = location.pathname || '';
      if (!/\/skills\/edit\/forms\//i.test(path)) {
        return false;
      }

      const root = document.querySelector('div[role="dialog"], .artdeco-modal') || document;
      const hasInput = Array.from(root.querySelectorAll('input')).some((input) => {
        const element = input as HTMLInputElement;
        if (!element.offsetParent) {
          return false;
        }
        const type = (element.getAttribute('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio' || type === 'hidden') {
          return false;
        }
        const placeholder = (element.getAttribute('placeholder') || '').toLowerCase();
        return placeholder.includes('skill') || placeholder.includes('compet') || (placeholder && !placeholder.includes('search'));
      });

      const hasSave = Array.from(root.querySelectorAll('button')).some((button) => {
        const text = (button.textContent || '').trim();
        return /save|salvar|guardar|concluir|done/i.test(text);
      });

      return hasInput && hasSave;
    },
    { timeout: 45000 },
  );
}

async function collectSkillEntries(page: Page): Promise<SkillEntry[]> {
  const rows = await page.evaluate(() => {
    function clean(value: string): string {
      return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function parseName(ariaLabel: string): string {
      const aria = clean(ariaLabel);
      if (!aria) {
        return '';
      }

      const english = aria.match(/^Edit\s+(.+?)\s+skill$/i);
      if (english && english[1]) {
        return clean(english[1]);
      }

      const englishAlt = aria.match(/^Edit\s+skill\s+(.+)$/i);
      if (englishAlt && englishAlt[1]) {
        return clean(englishAlt[1]);
      }

      const portuguese = aria.match(/^Editar\s+(.+?)\s+compet[êe]ncia$/i);
      if (portuguese && portuguese[1]) {
        return clean(portuguese[1]);
      }

      const portugueseAlt = aria.match(/^Editar\s+compet[êe]ncia\s+de\s+(.+)$/i);
      if (portugueseAlt && portugueseAlt[1]) {
        return clean(portugueseAlt[1]);
      }

      const fallbackPt = aria.match(/^Editar\s+(.+)$/i);
      if (fallbackPt && fallbackPt[1]) {
        return clean(fallbackPt[1])
          .replace(/\s+compet[êe]ncia$/i, '')
          .replace(/^compet[êe]ncia\s+de\s+/i, '')
          .trim();
      }

      return '';
    }

    const links = Array.from(document.querySelectorAll('a[href*="/details/skills/edit/forms/"]'));
    const payload: Array<{ name: string; edit_url: string }> = [];

    for (const link of links) {
      const anchor = link as HTMLAnchorElement;
      const href = anchor.href || anchor.getAttribute('href') || '';
      if (!href) {
        continue;
      }

      const aria = anchor.getAttribute('aria-label') || '';
      let name = parseName(aria);

      if (!name) {
        const row = anchor.closest('li, .pvs-list__paged-list-item, .artdeco-list__item, .pvs-entity');
        if (row) {
          const lines = clean((row as HTMLElement).innerText || '')
            .split('\n')
            .map((line) => clean(line))
            .filter(Boolean);
          if (lines.length) {
            name = clean(lines[0]).replace(/^compet[êe]ncia\s+de\s+/i, '').replace(/^skill:\s*/i, '');
          }
        }
      }

      if (!name || /^(all|todos|industry knowledge|tools|languages|interpersonal)/i.test(name)) {
        continue;
      }

      payload.push({ name: clean(name), edit_url: href });
    }

    return payload;
  });

  const deduped: SkillEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = normalizeText(row.name);
    const editUrl = normalizeText(row.edit_url);
    if (!name || !editUrl) {
      continue;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({ name, edit_url: editUrl });
  }
  return deduped;
}

async function readSkillList(page: Page): Promise<string[]> {
  const entries = await collectSkillEntries(page);
  return entries.map((entry) => entry.name);
}

async function openAddSkillEditor(page: Page, runLog: RunLog, profileBase: string): Promise<void> {
  const directUrl = `${profileBase}/skills/edit/forms/new/`;
  await gotoWithRetry(page, directUrl);
  runLog.event('navigate_skills_add', { target: directUrl });

  if (await isSkillEditorVisible(page)) {
    return;
  }

  await navigateToSkills(page, runLog, profileBase);
  await waitShort(page, 900);

  const addControl = page
    .locator(
      'a[aria-label*="Add a skill"], a[aria-label*="Adicionar competência"], button[aria-label*="Add a skill"], button[aria-label*="Adicionar competência"], a[href*="/skills/edit/forms/new/"]',
    )
    .first();

  if (!(await addControl.count()) || !(await addControl.isVisible().catch(() => false))) {
    throw new RunnerError('Could not locate Add Skill control.', 'skill_add_control_not_found');
  }

  await addControl.click({ timeout: 6000, force: true });
  runLog.event('skill_add_click');
}

async function fillSkillEditor(page: Page, runLog: RunLog, name: string): Promise<void> {
  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;

  const selectors = [
    'input[placeholder*="Compet"]',
    'input[placeholder*="compet"]',
    'input[placeholder*="Skill"]',
    'input[placeholder*="skill"]',
    'input[aria-label*="Compet"]',
    'input[aria-label*="Skill"]',
    'input:not([type])',
    'input[type="text"]',
  ];

  await fillFirstVisible(root, selectors, name, runLog, 'skill', page);
  await waitShort(page, 350);
  await page.keyboard.press('Enter').catch(() => {});
  runLog.event('skill_enter_pressed');
}

async function findSkillEditUrl(page: Page, name: string): Promise<string> {
  const entries = await collectSkillEntries(page);
  const target = normalizeText(name).toLowerCase();
  const exact = entries.find((entry) => entry.name.toLowerCase() === target);
  if (exact) {
    return exact.edit_url;
  }
  const partial = entries.find((entry) => entry.name.toLowerCase().includes(target) || target.includes(entry.name.toLowerCase()));
  return partial?.edit_url || '';
}

export async function addSkill(
  page: Page,
  runLog: RunLog,
  name: string,
): Promise<{ changed: boolean; skill: string; observed_skills: string[] }> {
  const skill = normalizeText(name);
  if (!skill) {
    throw new RunnerError('Skill name must be non-empty.', 'skill_name_invalid');
  }

  await snap(page, runLog, 'skill-add-before');
  const profileBase = await getProfileBaseUrl(page);
  if (!profileBase) {
    throw new RunnerError('Could not resolve LinkedIn profile base URL.', 'profile_base_not_found');
  }

  await openAddSkillEditor(page, runLog, profileBase);
  await waitForSkillEditor(page);
  await fillSkillEditor(page, runLog, skill);
  await clickSaveButton(page, SAVE_BUTTON_PATTERNS, runLog);
  await waitShort(page, 1700);

  await navigateToSkills(page, runLog, profileBase);
  await waitShort(page, 1100);
  const observedSkills = await readSkillList(page);
  await snap(page, runLog, 'skill-add-after');

  const changed = observedSkills.some((item) => item.toLowerCase() === skill.toLowerCase());
  return {
    changed,
    skill,
    observed_skills: observedSkills,
  };
}

export async function removeSkill(
  page: Page,
  runLog: RunLog,
  name: string,
): Promise<{ changed: boolean; skill: string; observed_skills: string[] }> {
  const skill = normalizeText(name);
  if (!skill) {
    throw new RunnerError('Skill name must be non-empty.', 'skill_name_invalid');
  }

  await snap(page, runLog, 'skill-remove-before');
  const profileBase = await getProfileBaseUrl(page);
  if (!profileBase) {
    throw new RunnerError('Could not resolve LinkedIn profile base URL.', 'profile_base_not_found');
  }

  await navigateToSkills(page, runLog, profileBase);
  await waitShort(page, 900);

  const editUrl = await findSkillEditUrl(page, skill);
  if (!editUrl) {
    return {
      changed: false,
      skill,
      observed_skills: await readSkillList(page),
    };
  }

  await gotoWithRetry(page, editUrl);
  runLog.event('navigate_skill_edit', { target: editUrl });
  await waitForSkillEditor(page);

  const modal = page.locator('div[role="dialog"], .artdeco-modal').first();
  const root = (await modal.count()) ? modal : page;
  const deleteButton = root
    .locator(
      'button:has-text("Delete"), button:has-text("Remove"), button:has-text("Excluir"), button:has-text("Exclua"), button:has-text("Remover")',
    )
    .first();

  if (!(await deleteButton.count()) || !(await deleteButton.isVisible().catch(() => false))) {
    throw new RunnerError('Could not locate delete control in skill editor.', 'skill_delete_control_not_found', {
      skill,
      edit_url: editUrl,
    });
  }

  await deleteButton.click({ timeout: 6000, force: true });
  runLog.event('skill_delete_click', { skill });
  await waitShort(page, 500);

  const confirm = page
    .locator(
      '[role="dialog"] button:has-text("Delete"), [role="dialog"] button:has-text("Remove"), [role="dialog"] button:has-text("Excluir"), [role="dialog"] button:has-text("Remover"), dialog button:has-text("Delete"), dialog button:has-text("Excluir")',
    );
  const confirmCount = await confirm.count();
  for (let index = confirmCount - 1; index >= 0; index -= 1) {
    const candidate = confirm.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    await candidate.click({ timeout: 5000, force: true });
    runLog.event('skill_delete_confirm', { skill, index });
    break;
  }

  await waitShort(page, 1600);
  await navigateToSkills(page, runLog, profileBase);
  await waitShort(page, 1000);
  const observedSkills = await readSkillList(page);
  await snap(page, runLog, 'skill-remove-after');

  const changed = !observedSkills.some((item) => item.toLowerCase() === skill.toLowerCase());
  return {
    changed,
    skill,
    observed_skills: observedSkills,
  };
}

export async function extractSkills(page: Page, runLog: RunLog): Promise<string[]> {
  const profileBase = await getProfileBaseUrl(page);
  if (!profileBase) {
    return [];
  }
  await navigateToSkills(page, runLog, profileBase);
  await waitShort(page, 900);
  return readSkillList(page);
}
