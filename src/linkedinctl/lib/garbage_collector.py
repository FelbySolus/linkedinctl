from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import shutil

from .types import JsonDict

PROFILE_CACHE_PATHS = (
    "Default/Cache",
    "Default/Code Cache",
    "Default/GPUCache",
    "Default/DawnCache",
    "Default/Service Worker/CacheStorage",
    "Default/Service Worker/ScriptCache",
    "Default/Shared Dictionary",
    "GrShaderCache",
    "ShaderCache",
    "Crashpad/completed",
    "Crashpad/pending",
)

DEFAULT_KEEP_RECENT_RUNS = 12
DEFAULT_MAX_RUN_AGE_DAYS = 14


def run_garbage_collection(
    *,
    workspace_root: Path,
    user_data_dir: str,
    keep_recent_runs: int = DEFAULT_KEEP_RECENT_RUNS,
    max_run_age_days: int = DEFAULT_MAX_RUN_AGE_DAYS,
) -> JsonDict:
    state_dir = workspace_root / "state"
    runs_root = state_dir / "runs"
    gc_dir = state_dir / "gc"
    gc_log_path = gc_dir / "events.jsonl"

    profile_root = Path(user_data_dir).expanduser().resolve()
    deleted_profile_paths: list[str] = []
    deleted_run_dirs: list[str] = []

    for relative in PROFILE_CACHE_PATHS:
        target = profile_root / relative
        if _remove_tree_if_exists(target):
            deleted_profile_paths.append(str(target))

    cutoff = datetime.now(timezone.utc) - timedelta(days=max(1, int(max_run_age_days)))
    for command_dir in _iter_dirs(runs_root):
        run_dirs = sorted(_iter_dirs(command_dir), key=lambda item: item.stat().st_mtime, reverse=True)
        for index, run_dir in enumerate(run_dirs):
            is_old = datetime.fromtimestamp(run_dir.stat().st_mtime, timezone.utc) < cutoff
            over_keep_count = index >= max(1, int(keep_recent_runs))
            if not (is_old or over_keep_count):
                continue
            if _remove_tree_if_exists(run_dir):
                deleted_run_dirs.append(str(run_dir))

    event: JsonDict = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "ok": True,
        "profile_cache_paths_removed": len(deleted_profile_paths),
        "run_dirs_removed": len(deleted_run_dirs),
    }
    _append_jsonl(gc_log_path, event)
    return event


def _iter_dirs(root: Path) -> list[Path]:
    if not root.exists() or not root.is_dir():
        return []
    return [item for item in root.iterdir() if item.is_dir()]


def _remove_tree_if_exists(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        shutil.rmtree(path, ignore_errors=False)
        return True
    except Exception:
        return False


def _append_jsonl(path: Path, payload: JsonDict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False))
        handle.write("\n")

