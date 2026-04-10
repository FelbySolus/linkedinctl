# Cover Debug Probe

Use this when the LinkedIn cover flow is flaky and you need hard evidence from Chromium console/network.

## Goal

- Reproduce cover mutation behavior (both add-cover and edit-cover branches).
- Capture request failures, 4xx/5xx responses, and save outcome.
- Keep all debug artifacts in one purgeable folder.

## Command

```bash
scripts/linkedinctl-cover-probe \
  --cover-file /absolute/path/to/cover.jpg \
  --profile-url "https://www.linkedin.com/in/<slug>/?isSelfProfile=true" \
  --headless
```

Use `--headed` when visual confirmation is needed.

## Output Location

- `state/debug/cover-probe/<run-id>/probe.json`
- `state/debug/cover-probe/<run-id>/01-profile.png`
- `state/debug/cover-probe/<run-id>/02-after-save.png`
- `state/debug/cover-probe/<run-id>/03-final.png`

## Triage Checklist

1. Check `probe.json.steps`:
   - `click_cover_entry`
   - `click_add_cover` or `click_edit_cover`
   - `file_attached_*`
   - `save_result`
2. Check `hasSaveError` and `hasSavedToast`.
3. Inspect `responses` and `requestFailed` around save.
4. If `cannot_click_change_photo` appears with spinner, classify as UI loading flake.

## Cleanup

Delete stale probes after analysis:

```bash
rm -rf state/debug/cover-probe/*
```
