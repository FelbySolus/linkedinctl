import { setAbout, setHeadline } from '../actions/text.js';
import { setProfilePhoto } from '../actions/photo.js';
import { setCoverPhoto } from '../actions/banner.js';
import { addSkill, removeSkill } from '../actions/skills.js';
import {
  addExperience,
  removeExperience,
  updateExperience,
} from '../actions/experience.js';
import { RunnerError } from '../core/errors.js';
import { resolveMaybeRelative } from '../core/io.js';
import { ensureLoggedIn, withSession } from '../core/session.js';
import type {
  ApplyOperationResult,
  RuntimeConfig,
  RuntimePayload,
} from '../core/runtime-types.js';
import type { RunLog } from '../core/runlog.js';

export async function runApplyOperation(
  config: RuntimeConfig,
  runLog: RunLog,
  payload: RuntimePayload,
): Promise<ApplyOperationResult> {
  const operation = payload.operation;
  if (!operation) {
    throw new RunnerError('Missing operation payload.', 'missing_operation');
  }

  return withSession(config, runLog, async ({ page }) => {
    await ensureLoggedIn(page, runLog);

    await page.goto(config.targetProfileUrl, { waitUntil: 'domcontentloaded' });
    runLog.event('profile_opened', { url: page.url(), op: operation.op });

    if (operation.op === 'set_headline') {
      const result = await setHeadline(page, runLog, operation.value);
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'set_about') {
      const result = await setAbout(page, runLog, operation.value);
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'set_profile_photo') {
      const filePath = resolveMaybeRelative(config.workspaceRoot, operation.file);
      const result = await setProfilePhoto(page, runLog, filePath);
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'set_cover_photo') {
      const filePath = resolveMaybeRelative(config.workspaceRoot, operation.file);
      const result = await setCoverPhoto(page, runLog, filePath);
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'add_skill') {
      const result = await addSkill(page, runLog, operation.name);
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'remove_skill') {
      const result = await removeSkill(page, runLog, operation.name);
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'add_experience') {
      const result = await addExperience(page, runLog, operation.experience);
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'update_experience') {
      const result = await updateExperience(
        page,
        runLog,
        operation.id,
        operation.patch,
        operation.experience,
      );
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    if (operation.op === 'remove_experience') {
      const result = await removeExperience(
        page,
        runLog,
        operation.id,
        operation.experience,
      );
      return {
        ok: true,
        op: operation.op,
        changed: Boolean(result.changed),
        details: result,
      };
    }

    throw new RunnerError('Unsupported live operation payload.', 'unsupported_live_operation', {
      supported: [
        'set_headline',
        'set_about',
        'set_profile_photo',
        'set_cover_photo',
        'add_skill',
        'remove_skill',
        'add_experience',
        'update_experience',
        'remove_experience',
      ],
    });
  });
}
