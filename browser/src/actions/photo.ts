import fs from 'node:fs';

import { RunnerError } from '../core/errors.js';
import { PHOTO_EDIT_BUTTON_PATTERNS, SAVE_BUTTON_PATTERNS } from '../selectors/profile.js';

import { clickButtonByPatterns, clickSaveButton, clickSelectorList, snap, waitShort } from './helpers.js';
import type { Page } from 'patchright';
import type { RunLog } from '../core/runlog.js';

const PHOTO_EDIT_FALLBACK_SELECTORS = [
  'button[aria-label*="Edit photo"]',
  'button[aria-label*="profile photo"]',
  'a[href*="overlay/edit-photo"]',
  'button[aria-label*="Adicionar foto"]',
];

const FILE_INPUT_SELECTORS = [
  'input[type="file"]',
  'input[accept*="image"]',
];

const AVATAR_OPEN_SELECTORS = [
  '[aria-label="Foto do perfil"]',
  '[aria-label="Profile photo"]',
  '[aria-label="Imagem do perfil"]',
];

const UPDATE_DIALOG_UPLOAD_PATTERNS = [/carregar foto/i, /upload photo/i];

async function attachFileFromInputSelectors(page: Page, runLog: RunLog, filePath: string): Promise<boolean> {
  for (const selector of FILE_INPUT_SELECTORS) {
    const input = page.locator(selector).first();
    if (await input.count()) {
      await input.setInputFiles(filePath, { timeout: 8000 });
      runLog.event('photo_file_attached', { selector, file_path: filePath });
      return true;
    }
  }
  return false;
}

async function openAvatarPhotoDialog(page: Page, runLog: RunLog): Promise<boolean> {
  for (const selector of AVATAR_OPEN_SELECTORS) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) {
      continue;
    }
    if (!(await locator.isVisible().catch(() => false))) {
      continue;
    }
    await locator.click({ timeout: 5000 });
    runLog.event('photo_avatar_click', { selector });
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('dialog[open]')).some((dialog) =>
          /foto do perfil|profile photo/i.test((dialog.textContent || '').trim()),
        ),
      { timeout: 15000 },
    );
    return true;
  }
  return false;
}

async function openPhotoUploadDialog(page: Page, runLog: RunLog): Promise<boolean> {
  await page.waitForFunction(
    () => {
      const dialog = Array.from(document.querySelectorAll('dialog[open]')).find((item) =>
        /foto do perfil|profile photo/i.test((item.textContent || '').trim()),
      );
      if (!dialog) {
        return false;
      }
      const text = (dialog.textContent || '').trim();
      return Boolean(dialog.querySelector('svg#camera-medium')) || /atualizar|update/i.test(text);
    },
    { timeout: 15000 },
  );

  const cameraByIcon = page.locator('dialog[open] a:has(svg#camera-medium)').first();
  if ((await cameraByIcon.count()) && (await cameraByIcon.isVisible().catch(() => false))) {
    await cameraByIcon.click({ timeout: 5000 });
    runLog.event('photo_update_click', { selector: 'dialog[open] a:has(svg#camera-medium)' });
  } else {
    const updateByText = page.getByRole('link', { name: /Atualizar|Update/i }).first();
    if ((await updateByText.count()) && (await updateByText.isVisible().catch(() => false))) {
      await updateByText.click({ timeout: 5000 });
      runLog.event('photo_update_click', { selector: 'getByRole(link, Atualizar|Update)' });
    } else {
      return false;
    }
  }

  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('dialog[open]')).some((dialog) =>
        /atualizar|update/i.test((dialog.textContent || '').trim()),
      ),
    { timeout: 15000 },
  );
  return true;
}

async function attachFileViaUploadButton(page: Page, runLog: RunLog, filePath: string): Promise<boolean> {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('dialog[open]')).some((dialog) =>
        /carregar foto|upload photo/i.test((dialog.textContent || '').trim()),
      ),
    { timeout: 15000 },
  );

  const candidates = [
    page.locator('dialog[open] button:has-text("Carregar foto")').first(),
    page.locator('dialog[open] button:has-text("Upload photo")').first(),
    page.getByRole('button', { name: /Carregar foto|Upload photo/i }).first(),
  ];

  for (const uploadButton of candidates) {
    if (!(await uploadButton.count())) {
      continue;
    }
    if (!(await uploadButton.isVisible().catch(() => false))) {
      continue;
    }

    try {
      runLog.event('photo_upload_click_attempt');
      const chooserPromise = page.waitForEvent('filechooser', { timeout: 6000 });
      await uploadButton.click({ timeout: 5000 });
      const chooser = await chooserPromise;
      await chooser.setFiles(filePath);
      runLog.event('photo_filechooser_attached', { file_path: filePath });
      return true;
    } catch {
      await waitShort(page, 500);
      const attachedFromInput = await attachFileFromInputSelectors(page, runLog, filePath);
      if (attachedFromInput) {
        runLog.event('photo_file_input_attached_after_upload_click', { file_path: filePath });
        return true;
      }
    }
  }

  return attachFileFromInputSelectors(page, runLog, filePath);
}

export async function setProfilePhoto(
  page: Page,
  runLog: RunLog,
  filePath: string,
): Promise<{ changed: boolean; uploaded_file: string }> {
  if (!fs.existsSync(filePath)) {
    throw new RunnerError(`Photo file does not exist: ${filePath}`, 'photo_file_missing', { file_path: filePath });
  }

  await snap(page, runLog, 'photo-before');

  const clicked =
    (await clickButtonByPatterns(page, PHOTO_EDIT_BUTTON_PATTERNS, runLog, 'photo_edit')) ||
    (await clickSelectorList(page, PHOTO_EDIT_FALLBACK_SELECTORS, runLog, 'photo_edit_fallback'));

  let attached = false;
  if (clicked) {
    attached = await attachFileFromInputSelectors(page, runLog, filePath);
  }

  if (!attached) {
    const openedAvatarDialog = await openAvatarPhotoDialog(page, runLog);
    if (!openedAvatarDialog) {
      throw new RunnerError('Could not open photo editor.', 'photo_editor_not_found');
    }
    const openedUploadDialog = await openPhotoUploadDialog(page, runLog);
    if (!openedUploadDialog) {
      throw new RunnerError('Could not open photo upload dialog.', 'photo_upload_dialog_not_found');
    }
    attached = await attachFileViaUploadButton(page, runLog, filePath);
  }

  if (!attached) {
    throw new RunnerError('Could not locate file input for profile photo upload.', 'photo_input_not_found');
  }

  await waitShort(page, 1200);
  await clickSaveButton(page, SAVE_BUTTON_PATTERNS, runLog);
  await waitShort(page, 2200);
  await snap(page, runLog, 'photo-after');

  return {
    changed: true,
    uploaded_file: filePath,
  };
}
