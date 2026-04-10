#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium } from 'patchright';

type ProbeEvent = {
  ts: string;
  status: number;
  method: string;
  url: string;
  contentType: string;
  postDataPreview: string;
  bodyPreview: string | null;
};

type ProbePayload = {
  runId: string;
  runDir: string;
  coverFile: string;
  startedAt: string;
  steps: Array<{ ts: string; name: string; [key: string]: unknown }>;
  console: Array<{ ts: string; type: string; text: string; location: unknown }>;
  pageErrors: Array<{ ts: string; message: string }>;
  requestFailed: Array<{ ts: string; method: string; url: string; failure: unknown; postDataPreview: string }>;
  responses: ProbeEvent[];
  interestingResponses: ProbeEvent[];
  error?: string;
  finishedAt?: string;
  counts?: {
    console: number;
    pageErrors: number;
    requestFailed: number;
    responses4xx: number;
    interestingResponses: number;
  };
  hasSaveError?: boolean;
  hasSavedToast?: boolean;
};

const INTERESTING_URL = /voyager|identity|profile|media|upload|background|cover|edit|graphql|rsc-action|dms/i;

function clip(value: string, max = 1400): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}...[truncated]`;
}

function parseArgs(argv: string[]) {
  const options = {
    workspaceRoot: process.cwd(),
    headless: true,
    coverFile: '',
    profileUrl: 'https://www.linkedin.com/in/me/?isSelfProfile=true',
    userDataDir: path.join(os.homedir(), '.linkedinctl', 'browser-profile'),
  };

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--workspace-root') {
      options.workspaceRoot = String(argv[i + 1] || options.workspaceRoot);
      i += 1;
      continue;
    }
    if (token === '--cover-file') {
      options.coverFile = String(argv[i + 1] || '');
      i += 1;
      continue;
    }
    if (token === '--user-data-dir') {
      options.userDataDir = String(argv[i + 1] || options.userDataDir);
      i += 1;
      continue;
    }
    if (token === '--profile-url') {
      options.profileUrl = String(argv[i + 1] || options.profileUrl);
      i += 1;
      continue;
    }
    if (token === '--headed') {
      options.headless = false;
      continue;
    }
    if (token === '--headless') {
      options.headless = true;
      continue;
    }
    throw new Error(`Unsupported arg: ${token}`);
  }

  if (!options.coverFile) {
    throw new Error('Missing required --cover-file');
  }

  return options;
}

async function main() {
  const args = parseArgs(process.argv);
  const workspaceRoot = path.resolve(args.workspaceRoot);
  const stateDir = path.join(workspaceRoot, 'state');
  const userDataDir = path.resolve(args.userDataDir);
  const runId = `cover-probe-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const runDir = path.join(stateDir, 'debug', 'cover-probe', runId);

  const payload: ProbePayload = {
    runId,
    runDir,
    coverFile: path.resolve(args.coverFile),
    startedAt: new Date().toISOString(),
    steps: [],
    console: [],
    pageErrors: [],
    requestFailed: [],
    responses: [],
    interestingResponses: [],
  };

  await fs.mkdir(runDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: args.headless,
    viewport: { width: 1440, height: 1200 },
    locale: 'pt-BR',
  });
  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(30000);

  const page = context.pages()[0] || (await context.newPage());

  const step = (name: string, extra: Record<string, unknown> = {}) => {
    payload.steps.push({ ts: new Date().toISOString(), name, ...extra });
  };

  const safeBodyPreview = async (response: import('patchright').Response): Promise<string | null> => {
    const headers = (await response.allHeaders().catch(() => ({}))) as Record<string, string>;
    const contentType = String(headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('json') && !contentType.includes('text') && !contentType.includes('javascript') && !contentType.includes('xml')) {
      return null;
    }
    const text = await response.text().catch(() => '');
    return clip(text, 1800);
  };

  const clickFirstVisible = async (targets: import('patchright').Locator[], name: string): Promise<boolean> => {
    for (const target of targets) {
      try {
        if (!(await target.count())) {
          continue;
        }
        if (!(await target.first().isVisible().catch(() => false))) {
          continue;
        }
        await target.first().click({ timeout: 4500, force: true });
        step(name, { ok: true });
        return true;
      } catch {
        continue;
      }
    }
    step(name, { ok: false });
    return false;
  };

  page.on('console', (message) => {
    payload.console.push({
      ts: new Date().toISOString(),
      type: message.type(),
      text: clip(message.text(), 900),
      location: message.location(),
    });
  });

  page.on('pageerror', (error) => {
    payload.pageErrors.push({
      ts: new Date().toISOString(),
      message: clip(String(error?.message || error), 1000),
    });
  });

  page.on('requestfailed', (request) => {
    payload.requestFailed.push({
      ts: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      failure: request.failure(),
      postDataPreview: clip(request.postData() || '', 900),
    });
  });

  page.on('response', async (response) => {
    const request = response.request();
    const status = response.status();
    const headers = (await response.allHeaders().catch(() => ({}))) as Record<string, string>;
    const event: ProbeEvent = {
      ts: new Date().toISOString(),
      status,
      method: request.method(),
      url: response.url(),
      contentType: String(headers['content-type'] || ''),
      postDataPreview: clip(request.postData() || '', 700),
      bodyPreview: null,
    };

    if (status >= 400) {
      event.bodyPreview = await safeBodyPreview(response);
      payload.responses.push(event);
    }

    if (INTERESTING_URL.test(event.url)) {
      if (status >= 300) {
        event.bodyPreview = event.bodyPreview ?? (await safeBodyPreview(response));
      }
      payload.interestingResponses.push(event);
    }
  });

  try {
    await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded' });
    step('auth_probe', { url: page.url() });
    if (page.url().includes('/login') || page.url().includes('/checkpoint/')) {
      throw new Error('not_authenticated');
    }

    await page.goto(args.profileUrl, { waitUntil: 'domcontentloaded' });
    step('profile_opened', { url: page.url() });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(runDir, '01-profile.png'), fullPage: true });

    const opened = await clickFirstVisible(
      [
        page.locator('button[aria-label*="Adicionar imagem de fundo"], button[aria-label*="Editar imagem de fundo"], button[aria-label*="Add background photo"], button[aria-label*="Edit background photo"]').first(),
        page.getByRole('button', { name: /Adicionar imagem de fundo|Editar imagem de fundo|Add background photo|Edit background photo/i }).first(),
      ],
      'click_cover_entry',
    );
    if (!opened) {
      throw new Error('cannot_open_cover_entry');
    }
    await page.waitForTimeout(700);

    let attached = false;
    const directChangePhotoClicked = await clickFirstVisible(
      [
        page.getByRole('button', { name: /Alterar foto|Change photo/i }).first(),
        page.getByRole('link', { name: /Alterar foto|Change photo/i }).first(),
        page.getByText(/Alterar foto|Change photo/i).first(),
      ],
      'click_change_photo_direct',
    );

    if (directChangePhotoClicked) {
      await page.waitForTimeout(700);
      const directUploadTargets = [
        page.getByRole('button', { name: /Carregar foto única|Upload single photo|Carregar foto|Upload photo/i }).first(),
        page.getByText(/Carregar foto única|Upload single photo|Carregar foto|Upload photo/i).first(),
      ];
      for (const target of directUploadTargets) {
        if (!(await target.count())) {
          continue;
        }
        if (!(await target.isVisible().catch(() => false))) {
          continue;
        }
        try {
          const chooserPromise = page.waitForEvent('filechooser', { timeout: 3500 });
          await target.click({ timeout: 4500, force: true });
          const chooser = await chooserPromise;
          await chooser.setFiles(payload.coverFile);
          step('file_attached_via_direct_upload');
          attached = true;
          break;
        } catch {
          continue;
        }
      }
    }

    const addCoverTargets = [
      page.locator('[aria-label*="Adicionar imagem de capa"], [aria-label*="Add cover photo"]').first(),
      page.getByText(/Adicionar imagem de capa|Add cover photo/i).first(),
    ];
    for (const target of addCoverTargets) {
      if (attached) {
        break;
      }
      if (!(await target.count())) {
        continue;
      }
      if (!(await target.isVisible().catch(() => false))) {
        continue;
      }
      try {
        const chooserPromise = page.waitForEvent('filechooser', { timeout: 3500 });
        await target.click({ timeout: 4500, force: true });
        step('click_add_cover');
        const chooser = await chooserPromise;
        await chooser.setFiles(payload.coverFile);
        step('file_attached_via_add_cover');
        attached = true;
        break;
      } catch {
        continue;
      }
    }

    if (!attached) {
      await clickFirstVisible(
        [
          page.getByRole('link', { name: /Editar imagem de capa|Edit cover photo/i }).first(),
          page.getByText(/Editar imagem de capa|Edit cover photo/i).first(),
        ],
        'click_edit_cover',
      );
      await page.waitForTimeout(800);
      await clickFirstVisible(
        [
          page.getByRole('button', { name: /Alterar foto|Change photo/i }).first(),
          page.getByRole('link', { name: /Alterar foto|Change photo/i }).first(),
          page.getByText(/Alterar foto|Change photo/i).first(),
        ],
        'click_change_photo',
      );
      await page.waitForTimeout(800);

      const uploadTargets = [
        page.getByRole('button', { name: /Carregar foto única|Upload single photo|Carregar foto|Upload photo/i }).first(),
        page.getByText(/Carregar foto única|Upload single photo|Carregar foto|Upload photo/i).first(),
      ];
      for (const target of uploadTargets) {
        if (!(await target.count())) {
          continue;
        }
        if (!(await target.isVisible().catch(() => false))) {
          continue;
        }
        try {
          const chooserPromise = page.waitForEvent('filechooser', { timeout: 3500 });
          await target.click({ timeout: 4500, force: true });
          const chooser = await chooserPromise;
          await chooser.setFiles(payload.coverFile);
          step('file_attached_via_upload');
          attached = true;
          break;
        } catch {
          continue;
        }
      }
    }

    if (!attached) {
      const input = page.locator('input[type="file"]').last();
      if (await input.count()) {
        await input.setInputFiles(payload.coverFile);
        step('file_attached_via_input');
        attached = true;
      }
    }

    if (!attached) {
      throw new Error('cover_input_not_found');
    }

    await page.waitForTimeout(5000);

    const saveButton = page.getByRole('button', { name: /Salvar altera|Save changes/i }).first();
    if (!(await saveButton.count()) || !(await saveButton.isVisible().catch(() => false))) {
      throw new Error('save_button_not_found');
    }
    if (!(await saveButton.isEnabled().catch(() => false))) {
      throw new Error('save_button_disabled');
    }
    await saveButton.click({ timeout: 5000 });
    step('save_clicked');

    await page.waitForTimeout(9000);
    payload.hasSaveError = (await page.getByText(/Erro ao salvar|Error saving|Não foi possível salvar/i).count()) > 0;
    payload.hasSavedToast = (await page.getByText(/Salvo|Saved/i).count()) > 0;
    step('save_result', { hasSaveError: payload.hasSaveError, hasSavedToast: payload.hasSavedToast });

    await page.screenshot({ path: path.join(runDir, '02-after-save.png'), fullPage: true });
  } catch (error) {
    payload.error = String(error instanceof Error ? error.message : error);
  } finally {
    try {
      await page.screenshot({ path: path.join(runDir, '03-final.png'), fullPage: true });
    } catch {}
    payload.finishedAt = new Date().toISOString();
    payload.counts = {
      console: payload.console.length,
      pageErrors: payload.pageErrors.length,
      requestFailed: payload.requestFailed.length,
      responses4xx: payload.responses.length,
      interestingResponses: payload.interestingResponses.length,
    };
    await fs.writeFile(path.join(runDir, 'probe.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await context.close();
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: !payload.error,
        run_id: runId,
        run_dir: runDir,
        error: payload.error || null,
        hasSaveError: payload.hasSaveError ?? null,
        hasSavedToast: payload.hasSavedToast ?? null,
        counts: payload.counts,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: String(error instanceof Error ? error.message : error) }, null, 2)}\n`);
  process.exitCode = 2;
});
