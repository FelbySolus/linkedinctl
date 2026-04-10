# LinkedIn Post - v0.0.1

I just open-sourced **linkedinctl v0.0.1**: a strict JSON-driven CLI for LinkedIn profile automation.

What it does:
- Strong schema contract with fail-closed validation.
- Headless Patchwright adapter for reliable browser execution.
- Deterministic cover renderer with safe-zone text placement.
- Strict pipeline (`plan -> apply -> verify`) with audit + safe commit controls.

Proof from this release run:
- TypeScript build passed.
- 8 Python tests passed.
- Plan/apply pipeline executed successfully (4 operations applied).
- Cover renderer generated deterministic 1584x396 output.

Built and shipped in a focused **3-4 prompt workflow**, then hardened for maintainability.

Repo: https://github.com/FelbySolus/linkedinctl
Release: https://github.com/FelbySolus/linkedinctl/releases/tag/v0.0.1
Proof: https://github.com/FelbySolus/linkedinctl/blob/main/PROOF_v0.0.1.md

If you want to test edge cases (selector drift, localization variants, modal hydration flakiness), open an issue/PR.

#automation #cli #typescript #python #patchwright #opensource

## First Comment (optional)

If you want, I can post a short follow-up with the exact 4-prompt launch sequence I used (`LINKEDIN_LAUNCH_PROMPTS.md`) so others can reproduce this workflow quickly.
