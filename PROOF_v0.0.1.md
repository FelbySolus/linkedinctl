# v0.0.1 Proof of Execution

All checks below were run on this release branch before publishing.

## 1) Build Passed

```bash
npm run build
```

Result:

```text
> linkedinctl-browser@0.0.1 build
> tsc -p tsconfig.browser.json
```

## 2) Unit Tests Passed

```bash
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py'
```

Result:

```text
........
----------------------------------------------------------------------
Ran 8 tests in 0.134s

OK
```

## 3) Pipeline Plan/Apply Passed

```bash
scripts/linkedinctl profile plan --spec examples/profile-changes.sample.json --json
scripts/linkedinctl profile apply --spec examples/profile-changes.sample.json --json
```

Result snapshot:

```json
{
  "plan": {
    "ok": true,
    "mode": "plan",
    "operation_count": 4
  },
  "apply": {
    "ok": true,
    "mode": "apply",
    "counts": {
      "applied": 4,
      "skipped": 0,
      "failed": 0
    },
    "pipeline": {
      "strict_mode": true,
      "auto_audit": true,
      "auto_commit": true
    }
  }
}
```

## 4) Cover Renderer Passed

```bash
scripts/linkedinctl assets render-cover \
  --output assets/cover-v0.0.1.jpg \
  --title "Your Name" \
  --subtitle "Automation Engineer | LinkedIn CLI" \
  --json
```

Result snapshot:

```json
{
  "ok": true,
  "size": {
    "width": 1584,
    "height": 396
  },
  "safe_zone_left": 320,
  "title_position": {
    "x": 360,
    "y": 118
  },
  "subtitle_position": {
    "x": 360,
    "y": 202
  }
}
```
