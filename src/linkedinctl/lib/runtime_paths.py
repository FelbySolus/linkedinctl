from __future__ import annotations

import os
from pathlib import Path


DEFAULT_USER_DATA_DIR = str(Path.home() / ".linkedinctl" / "browser-profile")


def resolve_user_data_dir(raw_value: str) -> str:
    clean = str(raw_value or "").strip()
    if not clean:
        return DEFAULT_USER_DATA_DIR
    if clean.startswith("~"):
        return str(Path(clean).expanduser())
    env_key = clean.startswith("$")
    if env_key:
        expanded = os.path.expandvars(clean)
        if expanded.startswith("~"):
            return str(Path(expanded).expanduser())
        return expanded
    return clean
