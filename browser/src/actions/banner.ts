import fs from 'node:fs';

import { RunnerError } from '../core/errors.js';
import { COVER_EDIT_BUTTON_PATTERNS, SAVE_BUTTON_PATTERNS } from '../selectors/profile.js';

import { clickButtonByPatterns, clickSelectorList, snap, waitShort } from './helpers.js';
import type { Locator, Page } from 'patchright';
import type { RunLog } from '../core/runlog.js';

const COVER_ENTRY_FALLBACK_SELECTORS = [
  'button[aria-label*="Adicionar imagem de fundo"]',
  'button[aria-label*="Editar imagem de fundo"]',
  'button[aria-label*="Add background photo"]',
  'button[aria-label*="Edit background photo"]',
  'button[aria-label*="Edit cover photo"]',
  'button[aria-label*="Editar foto de fundo"]',
  'button[aria-label*="Editar foto de capa"]',
  'a[href*="overlay/edit-cover-image"]',
];

const FILE_INPUT_SELECTORS = [
  'input[type="file"]',
  'input[accept*="image"]',
];

const COVER_MENU_OPEN_SELECTORS = [
  '[aria-label*="Editar imagem de capa"]',
  'a:has-text("Editar imagem de capa")',
  '[aria-label*="Edit cover photo"]',
  'a:has-text("Edit cover photo")',
];

const ADD_COVER_MENU_SELECTORS = [
  '[aria-label*="Adicionar imagem de capa"]',
  'button:has-text("Adicionar imagem de capa")',
  'div[role="menuitem"]:has-text("Adicionar imagem de capa")',
  '[aria-label*="Add cover photo"]',
  'button:has-text("Add cover photo")',
  'div[role="menuitem"]:has-text("Add cover photo")',
];

const ADD_COVER_MODAL_PATTERNS = [/adicionar imagem de capa/i, /add cover image/i];
const SAVE_ERROR_PATTERNS = [/erro ao salvar/i, /error saving/i];
const COVER_ACTIONABLE_LABEL_PATTERN =
  /adicionar imagem de capa|add cover photo|alterar foto|change photo|carregar foto|upload photo|upload single photo|editar imagem de capa|edit cover photo|excluir|delete|remover|remove|substituir|replace/i;

function getCoverDialog(page: Page): Locator {
  return page
    .locator('[role="dialog"], dialog')
    .filter({ hasText: /adicionar imagem de capa|add cover image|editar imagem de capa|edit cover photo|foto de capa|cover photo|editar imagem|edit image/i })
    .last();
}

async function openCoverControls(page: Page, runLog: RunLog): Promise<boolean> {
  let clickedPattern = await clickButtonByPatterns(page, COVER_EDIT_BUTTON_PATTERNS, runLog, 'cover_edit');
  if (!clickedPattern) {
    await waitShort(page, 1000);
    clickedPattern = await clickButtonByPatterns(page, COVER_EDIT_BUTTON_PATTERNS, runLog, 'cover_edit_retry');
  }
  if (clickedPattern) {
    return true;
  }
  return clickSelectorList(page, COVER_ENTRY_FALLBACK_SELECTORS, runLog, 'cover_edit_fallback');
}

async function waitForCoverActionables(
  page: Page,
  runLog: RunLog,
  phase: string,
  timeoutMs = 12000,
): Promise<boolean> {
  const ready = await page
    .waitForFunction((patternSource) => {
      const pattern = new RegExp(patternSource, 'i');
      if (document.querySelector('input[type="file"], input[accept*="image"]')) {
        return true;
      }
      const candidates = Array.from(document.querySelectorAll('button,a,[role="button"],[role="menuitem"]'));
      return candidates.some((element) => {
        const text = (element.textContent || '').trim();
        const aria = (element.getAttribute('aria-label') || '').trim();
        const label = `${aria} ${text}`.trim();
        return Boolean(label) && pattern.test(label);
      });
    }, COVER_ACTIONABLE_LABEL_PATTERN.source, { timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
  runLog.event('cover_controls_ready', { phase, ready, timeout_ms: timeoutMs });
  return ready;
}

async function attachFromInputs(page: Page, runLog: RunLog, filePath: string): Promise<boolean> {
  for (const selector of FILE_INPUT_SELECTORS) {
    const input = page.locator(selector).first();
    if (await input.count()) {
      await input.setInputFiles(filePath, { timeout: 10000 });
      runLog.event('cover_file_attached', { selector, file_path: filePath });
      return true;
    }
  }
  return false;
}

async function tryClickLocator(
  locator: Locator,
  runLog: RunLog,
  label: string,
  meta: string,
): Promise<boolean> {
  if (!(await locator.count())) {
    return false;
  }
  if (!(await locator.isVisible().catch(() => false))) {
    return false;
  }
  await locator.click({ timeout: 5000, force: true });
  runLog.event('cover_click', { label, target: meta });
  return true;
}

async function openCoverEditMenu(page: Page, runLog: RunLog): Promise<boolean> {
  for (const selector of COVER_MENU_OPEN_SELECTORS) {
    const clicked = await tryClickLocator(page.locator(selector).first(), runLog, 'cover_menu_open', selector).catch(() => false);
    if (clicked) {
      await waitShort(page, 600);
      return true;
    }
  }

  const byText = page.getByText(/Editar imagem de capa|Edit cover photo/i).first();
  const clicked = await tryClickLocator(byText, runLog, 'cover_menu_open_text', 'getByText(Edit cover photo)').catch(() => false);
  if (clicked) {
    await waitShort(page, 600);
    return true;
  }

  return false;
}

async function triggerUploadChooser(page: Page, runLog: RunLog, filePath: string): Promise<boolean> {
  const coverDialog = getCoverDialog(page);
  await waitForCoverActionables(page, runLog, 'before_change_photo_targets', 12000);

  const changePhotoTargets: Array<{ locator: Locator; name: string }> = [
    { locator: coverDialog.locator('a:has-text("Alterar foto"), a:has-text("Change photo")').first(), name: 'cover dialog change photo link' },
    { locator: coverDialog.getByRole('button', { name: /Alterar foto|Change photo/i }).first(), name: 'cover dialog change photo button' },
    {
      locator: coverDialog.locator('button:has-text("Alterar foto"), button:has-text("Change photo"), [role="menuitem"]:has-text("Alterar foto"), [role="menuitem"]:has-text("Change photo")').first(),
      name: 'cover dialog change photo generic',
    },
    { locator: page.getByText(/^Alterar foto$|^Change photo$/i).first(), name: 'global change photo text' },
    { locator: coverDialog.getByRole('button', { name: /Editar|Edit/i }).first(), name: 'cover dialog edit button' },
    { locator: coverDialog.locator('button:has-text("Editar"), button:has-text("Edit"), [role="menuitem"]:has-text("Editar"), [role="menuitem"]:has-text("Edit")').first(), name: 'cover dialog edit generic' },
  ];

  for (const target of changePhotoTargets) {
    if (!(await target.locator.count())) {
      continue;
    }
    if (!(await target.locator.isVisible().catch(() => false))) {
      continue;
    }
    await target.locator.click({ timeout: 5000, force: true }).catch(() => {});
    runLog.event('cover_click', { label: 'cover_change_photo_open', target: target.name });
    await waitShort(page, 900);
    await waitForCoverActionables(page, runLog, `after_${target.name.replace(/\s+/g, '_')}`, 10000);
    break;
  }

  await page
    .waitForFunction(() => {
      const text = (document.body?.innerText || '').toLowerCase();
      const hasUploadCTA =
        text.includes('carregar foto única') ||
        text.includes('upload single photo') ||
        text.includes('carregar foto') ||
        text.includes('upload photo');
      const hasFileInput = Boolean(document.querySelector('input[type="file"], input[accept*="image"]'));
      const hasCoverActions = text.includes('alterar foto') || text.includes('change photo');
      const isAddCoverLoading = text.includes('adicionar imagem de capa') && !hasUploadCTA && !hasFileInput;
      return hasUploadCTA || hasFileInput || hasCoverActions || !isAddCoverLoading;
    }, { timeout: 26000 })
    .catch(() => {});
  await waitShort(page, 500);

  const uploadTargets: Array<{ locator: Locator; name: string }> = [
    { locator: getCoverDialog(page).getByRole('button', { name: /Carregar foto única|Upload single photo/i }).first(), name: 'cover dialog single upload' },
    { locator: getCoverDialog(page).locator('button:has-text("Carregar foto única"), button:has-text("Upload single photo")').first(), name: 'cover dialog single upload text button' },
    { locator: page.getByRole('button', { name: /Carregar foto única|Upload single photo|Carregar foto|Upload photo/i }).first(), name: 'global upload button' },
    { locator: page.getByText(/Carregar foto única|Upload single photo|Carregar foto|Upload photo/i).first(), name: 'global upload text' },
    { locator: page.locator('[aria-label*="Carregar foto"], [aria-label*="Upload"]').first(), name: 'aria upload' },
  ];

  for (const target of uploadTargets) {
    if (!(await target.locator.count())) {
      continue;
    }
    if (!(await target.locator.isVisible().catch(() => false))) {
      continue;
    }
    try {
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 3500 });
      await target.locator.click({ timeout: 5000, force: true });
      const chooser = await chooserPromise;
      await chooser.setFiles(filePath);
      runLog.event('cover_filechooser_attached', { selector: target.name, file_path: filePath });
      return true;
    } catch {
      const attachedByInput = await attachFromInputs(page, runLog, filePath);
      if (attachedByInput) {
        runLog.event('cover_file_attached_after_trigger', { selector: target.name, file_path: filePath });
        return true;
      }
    }
  }

  const attachedByInput = await attachFromInputs(page, runLog, filePath);
  if (attachedByInput) {
    runLog.event('cover_file_attached_after_trigger', { selector: 'final-input-fallback', file_path: filePath });
    return true;
  }
  return false;
}

async function tryAttachViaAddCoverMenu(page: Page, runLog: RunLog, filePath: string): Promise<boolean> {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    for (const selector of ADD_COVER_MENU_SELECTORS) {
      const target = page.locator(selector).first();
      if (!(await target.count())) {
        continue;
      }
      if (!(await target.isVisible().catch(() => false))) {
        continue;
      }
      try {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 3500 });
        await target.click({ timeout: 5000, force: true });
        const chooser = await chooserPromise;
        await chooser.setFiles(filePath);
        runLog.event('cover_filechooser_attached', { selector, file_path: filePath, flow: 'add_cover_menu' });
        return true;
      } catch {
        const attachedByInput = await attachFromInputs(page, runLog, filePath);
        if (attachedByInput) {
          runLog.event('cover_file_attached_after_trigger', { selector, file_path: filePath, flow: 'add_cover_menu' });
          return true;
        }
      }
    }
    await waitShort(page, 350);
  }
  return false;
}

async function clickEnabledSaveByPattern(
  page: Page,
  pattern: string | RegExp,
  runLog: RunLog,
  scope?: Locator,
): Promise<boolean> {
  const root = scope ?? page;
  const locator = root.getByRole('button', { name: pattern }).first();
  if (!(await locator.count())) {
    return false;
  }
  if (!(await locator.isVisible().catch(() => false))) {
    return false;
  }
  if (!(await locator.isEnabled().catch(() => false))) {
    return false;
  }
  await locator.click({ timeout: 6000 });
  runLog.event('cover_save_click', { target: String(pattern) });
  return true;
}

async function waitForCoverUploadReady(page: Page, runLog: RunLog): Promise<boolean> {
  const ready = await page
    .waitForFunction(() => {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"], dialog')) as HTMLElement[];
      const coverDialogs = dialogs.filter((el) => {
        const text = (el.textContent || '').toLowerCase();
        const isVisible = Boolean(el.offsetParent || el.getClientRects().length);
        return (
          isVisible &&
          (text.includes('adicionar imagem de capa') ||
            text.includes('add cover image') ||
            text.includes('editar imagem de capa') ||
            text.includes('edit cover photo') ||
            text.includes('foto de capa') ||
            text.includes('cover photo') ||
            text.includes('editar imagem') ||
            text.includes('edit image'))
        );
      });
      const coverDialog = coverDialogs.length ? coverDialogs[coverDialogs.length - 1] : null;
      if (!coverDialog) {
        const pageText = (document.body?.innerText || '').toLowerCase();
        const inCoverFlow =
          pageText.includes('adicionar imagem de capa') ||
          pageText.includes('add cover image') ||
          pageText.includes('foto de capa') ||
          pageText.includes('cover photo') ||
          pageText.includes('editar imagem') ||
          pageText.includes('edit image');
        if (!inCoverFlow) {
          return false;
        }

        const buttons = Array.from(document.querySelectorAll('button')) as HTMLButtonElement[];
        return buttons.some((button) => {
          const buttonText = (button.textContent || '').trim().toLowerCase();
          const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
          const label = `${buttonText} ${ariaLabel}`.trim();
          const isSaveChanges = label.includes('salvar altera') || label.includes('save changes');
          return isSaveChanges && !button.disabled;
        });
      }

      const saveLabels = ['salvar alterações', 'save changes', 'salvar', 'save'];
      const buttons = Array.from(coverDialog.querySelectorAll('button')) as HTMLButtonElement[];
      return buttons.some((button) => {
        const buttonText = (button.textContent || '').trim().toLowerCase();
        const ariaLabel = (button.getAttribute('aria-label') || '').toLowerCase();
        const label = `${buttonText} ${ariaLabel}`.trim();
        return saveLabels.some((saveLabel) => label.includes(saveLabel)) && !button.disabled;
      });
    }, { timeout: 18000 })
    .then(() => true)
    .catch(() => false);
  runLog.event('cover_upload_ready', { ready });
  return ready;
}

async function detectCoverSaveError(page: Page): Promise<boolean> {
  for (const pattern of SAVE_ERROR_PATTERNS) {
    const locator = page.getByText(pattern).first();
    if ((await locator.count()) && (await locator.isVisible().catch(() => false))) {
      return true;
    }
  }
  return false;
}

async function isAddCoverModalStillOpen(page: Page): Promise<boolean> {
  for (const pattern of ADD_COVER_MODAL_PATTERNS) {
    const dialog = page.locator('[role="dialog"], dialog').filter({ hasText: pattern }).first();
    if (!(await dialog.count())) {
      continue;
    }
    if (await dialog.isVisible().catch(() => false)) {
      return true;
    }
  }
  return false;
}

async function clickCoverSave(page: Page, runLog: RunLog): Promise<void> {
  const coverDialog = getCoverDialog(page);
  const preferredSaves: Array<{ locator: Locator; label: string }> = [
    { locator: coverDialog.getByRole('button', { name: /Salvar altera|Save changes/i }).first(), label: 'save_changes_role' },
    { locator: coverDialog.locator('button:has-text("Salvar alterações")').first(), label: 'save_changes_dialog_pt' },
    { locator: coverDialog.locator('button:has-text("Save changes")').first(), label: 'save_changes_dialog_en' },
  ];

  for (const target of preferredSaves) {
    if (!(await target.locator.count())) {
      continue;
    }
    await target.locator.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    const enabled = await target.locator.isEnabled().catch(() => false);
    if (!enabled) {
      continue;
    }
    await target.locator.click({ timeout: 6000 });
    runLog.event('cover_save_click', { target: target.label });
    return;
  }

  for (const pattern of SAVE_BUTTON_PATTERNS) {
    const clicked = await clickEnabledSaveByPattern(page, pattern, runLog, coverDialog);
    if (clicked) {
      return;
    }
  }

  const fallbackPatterns: Array<string | RegExp> = [/Salvar altera|Save changes/i];
  for (const pattern of fallbackPatterns) {
    const clicked = await clickEnabledSaveByPattern(page, pattern, runLog);
    if (clicked) {
      return;
    }
  }

  throw new RunnerError('Cover save button is not enabled yet.', 'cover_save_not_ready');
}

async function clickSecondarySaveIfPresent(page: Page, runLog: RunLog): Promise<void> {
  const secondarySave = getCoverDialog(page).getByRole('button', { name: /^Salvar$/i }).first();
  if (!(await secondarySave.count())) {
    return;
  }

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await secondarySave.isEnabled().catch(() => false)) {
      await secondarySave.click({ timeout: 5000 });
      runLog.event('cover_save_click', { target: 'secondary_save' });
      return;
    }
    await waitShort(page, 500);
  }
}

export async function setCoverPhoto(
  page: Page,
  runLog: RunLog,
  filePath: string,
): Promise<{ changed: boolean; uploaded_file: string }> {
  if (!fs.existsSync(filePath)) {
    throw new RunnerError(`Cover file does not exist: ${filePath}`, 'cover_file_missing', { file_path: filePath });
  }

  await snap(page, runLog, 'cover-before');

  const controlsOpened = await openCoverControls(page, runLog);
  if (!controlsOpened) {
    throw new RunnerError('Could not open cover editor controls.', 'cover_controls_not_found');
  }

  await waitForCoverActionables(page, runLog, 'after_cover_controls_open', 14000);
  let attached = await tryAttachViaAddCoverMenu(page, runLog, filePath);
  if (!attached) {
    await openCoverEditMenu(page, runLog);
    await waitForCoverActionables(page, runLog, 'after_cover_menu_open', 22000);
  }

  if (!attached) {
    attached = await attachFromInputs(page, runLog, filePath);
  }
  if (!attached) {
    attached = await triggerUploadChooser(page, runLog, filePath);
  }

  if (!attached) {
    throw new RunnerError('Could not locate file input or upload trigger for cover upload.', 'cover_input_not_found');
  }

  const uploadReady = await waitForCoverUploadReady(page, runLog);
  if (!uploadReady) {
    throw new RunnerError('Cover upload did not reach a savable state.', 'cover_upload_not_ready');
  }

  await waitShort(page, 1200);
  await clickCoverSave(page, runLog);
  await waitShort(page, 1800);
  await clickSecondarySaveIfPresent(page, runLog);
  await waitShort(page, 4200);

  if (await detectCoverSaveError(page)) {
    throw new RunnerError('LinkedIn reported a cover save error.', 'cover_save_failed');
  }
  if (await isAddCoverModalStillOpen(page)) {
    throw new RunnerError('Cover editor did not close after save.', 'cover_save_not_committed');
  }
  await snap(page, runLog, 'cover-after');

  return {
    changed: true,
    uploaded_file: filePath,
  };
}
