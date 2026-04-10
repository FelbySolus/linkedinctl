from __future__ import annotations

import subprocess
from pathlib import Path

from .types import JsonDict


def safe_auto_commit(
    *,
    workspace_root: Path,
    files: list[Path],
    commit_message: str,
) -> JsonDict:
    try:
        top = subprocess.run(
            ["git", "-C", str(workspace_root), "rev-parse", "--show-toplevel"],
            text=True,
            capture_output=True,
            timeout=10,
        )
    except Exception as exc:  # pragma: no cover - defensive boundary
        return {
            "ok": False,
            "committed": False,
            "reason": "git_probe_failed",
            "error": str(exc),
        }

    if top.returncode != 0:
        return {
            "ok": True,
            "committed": False,
            "reason": "not_a_git_repo",
        }

    git_root = Path((top.stdout or "").strip()).resolve()
    stage_candidates: list[str] = []
    for file_path in files:
        try:
            resolved = file_path.resolve()
            if not resolved.exists():
                continue
            rel = resolved.relative_to(git_root)
        except Exception:
            continue
        stage_candidates.append(str(rel))

    if not stage_candidates:
        return {
            "ok": True,
            "committed": False,
            "reason": "no_files_to_stage",
            "git_root": str(git_root),
        }

    stage = subprocess.run(
        ["git", "-C", str(git_root), "add", "--", *stage_candidates],
        text=True,
        capture_output=True,
        timeout=20,
    )
    if stage.returncode != 0 and "ignored by one of your .gitignore files" in (stage.stderr or ""):
        stage = subprocess.run(
            ["git", "-C", str(git_root), "add", "-f", "--", *stage_candidates],
            text=True,
            capture_output=True,
            timeout=20,
        )
    if stage.returncode != 0:
        return {
            "ok": False,
            "committed": False,
            "reason": "git_add_failed",
            "git_root": str(git_root),
            "stderr": (stage.stderr or "").strip(),
        }

    staged = subprocess.run(
        ["git", "-C", str(git_root), "diff", "--cached", "--name-only", "--", *stage_candidates],
        text=True,
        capture_output=True,
        timeout=20,
    )
    if staged.returncode != 0:
        return {
            "ok": False,
            "committed": False,
            "reason": "git_diff_cached_failed",
            "git_root": str(git_root),
            "stderr": (staged.stderr or "").strip(),
        }

    staged_files = [line.strip() for line in (staged.stdout or "").splitlines() if line.strip()]
    if not staged_files:
        return {
            "ok": True,
            "committed": False,
            "reason": "no_staged_changes",
            "git_root": str(git_root),
        }

    commit = subprocess.run(
        ["git", "-C", str(git_root), "commit", "-m", commit_message, "--", *stage_candidates],
        text=True,
        capture_output=True,
        timeout=30,
    )
    if commit.returncode != 0:
        return {
            "ok": False,
            "committed": False,
            "reason": "git_commit_failed",
            "git_root": str(git_root),
            "stderr": (commit.stderr or "").strip(),
            "stdout": (commit.stdout or "").strip(),
            "staged_files": staged_files,
        }

    head = subprocess.run(
        ["git", "-C", str(git_root), "rev-parse", "HEAD"],
        text=True,
        capture_output=True,
        timeout=10,
    )
    commit_sha = (head.stdout or "").strip() if head.returncode == 0 else ""

    return {
        "ok": True,
        "committed": True,
        "reason": "committed",
        "git_root": str(git_root),
        "commit_sha": commit_sha,
        "commit_message": commit_message,
        "staged_files": staged_files,
    }
