# Next Agents Maintenance Guide

This project is intentionally hardened. Keep it strict and predictable.

## Non-Negotiable Rules

- Never introduce ad-hoc payload fields.
- Never bypass `validate_spec()` in `src/linkedinctl/lib/contracts.py`.
- Keep `spec.pipeline.strict_mode` enforced as `true`.
- Keep unknown-field rejection active in both:
  - Python spec contract layer.
  - Browser runtime payload parser (`browser/src/core/protocol.ts`).
- Keep `idempotency_key` mandatory for every operation.
- Keep live operation allowlist explicit (`set_headline`, `set_about`, `set_profile_photo`, `set_cover_photo`, `add_skill`, `remove_skill`, `add_experience`, `update_experience`, `remove_experience`) unless intentionally expanded end-to-end.

## Code Hygiene Standards

- No deep nested functions.
- No files above 800 lines.
- No broad ad-hoc typing (`Any`, `unknown`, `Record<string, unknown>` in core paths).
- Reuse shared JSON aliases in `src/linkedinctl/lib/types.py`.
- Keep run artifacts and state writes deterministic and auditable.
- Default behavior purges per-run artifacts; retained runs must be opt-in (`--keep-run-artifacts`).
- Keep post-run GC active: browser-backed commands must clear ephemeral profile caches and prune stale retained run dirs (see `state/gc/events.jsonl`).

Debug skill location:

- `skills/cover-debug/SKILL.md`

## Required Checks Before Merge

Run all of these from repo root (`linkedinctl/`):

```bash
npm run build
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py'
```

Then execute core CLI surfaces:

```bash
PYTHONPATH=src python3 -m linkedinctl.cli --workspace-root . readiness --json
PYTHONPATH=src python3 -m linkedinctl.cli --workspace-root . profile pull --json
PYTHONPATH=src python3 -m linkedinctl.cli --workspace-root . profile plan --spec <spec.json> --json
PYTHONPATH=src python3 -m linkedinctl.cli --workspace-root . profile apply --spec <spec.json> --json
PYTHONPATH=src python3 -m linkedinctl.cli --workspace-root . profile verify --json
```

Auth command behavior note:

- `auth login` requires a user to complete login in browser session.
- In automated checks, a short timeout is expected to return `ok: false` and non-zero exit.

## Pipeline Behavior You Must Preserve

- `apply` should fail closed if audit writing fails.
- `apply` should fail closed if auto-commit fails.
- Auto-commit must only stage scoped state/audit files.
- Audit reports must remain generated under `state/audits/`.
- Cover live path must support both:
  - no existing banner (`Adicionar imagem de capa`)
  - existing banner (`Editar imagem de capa` -> `Alterar foto`)

## Safe Change Procedure

1. Add/adjust contract validation first.
2. Mirror the same constraints in browser runtime protocol parsing.
3. Add tests (contract + engine behavior).
4. Run full checks.
5. Update `README.md` if user-facing behavior changed.

## If Expanding Live Surface

If you add a new live operation, update all of the following together:

- `SUPPORTED_OPERATIONS` and validation logic in `contracts.py`.
- `LIVE_SUPPORTED_OPERATIONS` and policy in `engine.py`.
- Operation parser in `browser/src/core/protocol.ts`.
- Browser command handling in `browser/src/commands/apply-operation.ts`.
- Tests covering invalid/unknown fields and success path.

Do not merge partial support.
