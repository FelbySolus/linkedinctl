# linkedinctl

Core library and CLI for JSON-driven LinkedIn profile automation.

## Architecture

- `src/linkedinctl/lib/contracts.py`: JSON spec contract + validation.
- `src/linkedinctl/lib/engine.py`: plan/apply/verify orchestration.
- `src/linkedinctl/lib/adapters/patchwright.py`: Python-to-Patchwright bridge.
- `src/linkedinctl/lib/banner_render.py`: deterministic LinkedIn cover renderer with safe-zone controls.
- `browser/src/main.ts`: TypeScript Patchwright command runner.
- `browser/dist/main.js`: compiled runtime entry used by the adapter.
- `src/linkedinctl/lib/store.py`: durable local state (`state/`).

## Local Commands

```bash
scripts/linkedinctl readiness --json
scripts/linkedinctl profile pull --json
scripts/linkedinctl profile plan --spec examples/profile-changes.sample.json --json
scripts/linkedinctl profile apply --spec examples/profile-changes.sample.json --json
scripts/linkedinctl profile verify --json
scripts/linkedinctl assets render-cover --output assets/cover.jpg --title "Name" --json
```

## Live (Patchwright) Commands

First-time login bootstrap (headed):

```bash
scripts/linkedinctl auth login --headed --login-wait-ms 300000 --json
```

After that, run headless by default:

```bash
scripts/linkedinctl readiness --live --json
scripts/linkedinctl profile pull --live --json
scripts/linkedinctl profile apply --live --spec examples/profile-live-text-photo.sample.json --json
scripts/linkedinctl profile apply --live --spec examples/profile-live-experiences-batch.sample.json --json
scripts/linkedinctl profile verify --live --json
```

Useful options:

- `--headless` / `--headed`
- `--keep-run-artifacts` (default is auto-purge)
- `--target-profile-url "https://www.linkedin.com/in/<your-slug>/"`
- `--user-data-dir ~/.linkedinctl/browser-profile` (default; outside repo)
- `--timeout-ms 45000`

Supported live ops:

- `set_headline`
- `set_about`
- `set_profile_photo`
- `set_cover_photo`
- `add_skill`
- `remove_skill`
- `add_experience`
- `update_experience`
- `remove_experience`

## Debuggability

Live runs are always organized under command-specific folders:

- `state/runs/<command>/<run-id>/meta/events.jsonl`
- `state/runs/<command>/<run-id>/meta/summary.json`
- `state/runs/<command>/<run-id>/artifacts/screenshots/*.png`

Default behavior auto-purges run folders after each command. Use `--keep-run-artifacts` to retain them.

Additionally, every browser-backed run performs a quiet post-run garbage collection pass:

- clears ephemeral Chromium cache folders inside `--user-data-dir` (without touching auth/session cookies)
- prunes stale retained run folders under `state/runs/`
- appends GC audit lines to `state/gc/events.jsonl`

Dedicated cover probe tool (keeps artifacts by design):

```bash
scripts/linkedinctl-cover-probe \
  --cover-file /absolute/path/to/banner.jpg \
  --profile-url "https://www.linkedin.com/in/<your-slug>/?isSelfProfile=true" \
  --headless
```

Probe outputs go to `state/debug/cover-probe/<run-id>/`.

## Cover Template Control

Render a safe-zone-aware cover image with controlled text placement:

```bash
scripts/linkedinctl assets render-cover \
  --output assets/linkedin-cover-custom.jpg \
  --title "Your Name" \
  --subtitle "Software Developer | Next.js | TypeScript | Python" \
  --safe-zone-left 320 \
  --title-x 360 \
  --title-y 118 \
  --subtitle-x 360 \
  --subtitle-y 202 \
  --max-text-width 1120 \
  --json
```

## Strict Pipeline Guarantees

- Unknown fields are rejected in both Python spec validation and browser runtime payload parsing.
- `spec.pipeline.strict_mode` cannot be disabled.
- Every operation requires `idempotency_key` and duplicate keys are rejected.
- Live mode blocks unsupported operations (allowed: `set_headline`, `set_about`, `set_profile_photo`, `set_cover_photo`, `add_skill`, `remove_skill`, `add_experience`, `update_experience`, `remove_experience`).
- `auto_audit` writes immutable audit artifacts in `state/audits/`.
- `auto_commit` stages only scoped state/audit files and commits safely; apply now fails if commit automation fails.

## Local Test Command

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py'
```
