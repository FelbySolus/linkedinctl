from __future__ import annotations

import json
import re
from pathlib import Path

from .errors import SpecValidationError
from .types import JsonDict

SPEC_VERSION = "1"

SUPPORTED_OPERATIONS: tuple[str, ...] = (
    "set_headline",
    "set_about",
    "set_profile_photo",
    "set_cover_photo",
    "add_skill",
    "remove_skill",
    "reorder_skill",
    "add_experience",
    "update_experience",
    "remove_experience",
)

REQUIRED_FIELDS: dict[str, tuple[str, ...]] = {
    "set_headline": ("value",),
    "set_about": ("value",),
    "set_profile_photo": ("file",),
    "set_cover_photo": ("file",),
    "add_skill": ("name",),
    "remove_skill": ("name",),
    "reorder_skill": ("name", "index"),
    "add_experience": ("experience",),
    "update_experience": ("id", "patch"),
    "remove_experience": ("id",),
}

ALLOWED_OPERATION_FIELDS: dict[str, set[str]] = {
    op: {"op", "idempotency_key", *required} for op, required in REQUIRED_FIELDS.items()
}

TOP_LEVEL_FIELDS: set[str] = {"version", "target_profile", "operations", "pipeline"}
PIPELINE_FIELDS: set[str] = {"strict_mode", "auto_audit", "auto_commit", "commit_message"}
EXPERIENCE_FIELDS: set[str] = {"id", "title", "company", "start", "end", "description"}
EXPERIENCE_PATCH_FIELDS: set[str] = {"title", "company", "start", "end", "description"}

MAX_OPERATIONS = 25
MAX_HEADLINE_LENGTH = 220
MAX_ABOUT_LENGTH = 2600
MAX_SKILL_LENGTH = 80
MAX_COMMIT_MESSAGE_LENGTH = 180
IDEMPOTENCY_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._:-]{2,119}$")


def _expect(condition: bool, message: str) -> None:
    if not condition:
        raise SpecValidationError(message)


def _reject_unknown_fields(payload: JsonDict, allowed: set[str], *, context: str) -> None:
    unknown = sorted(key for key in payload if key not in allowed)
    _expect(
        not unknown,
        f"{context} contains unsupported fields {unknown}. Allowed fields: {sorted(allowed)}.",
    )


def _strict_string(value: object, *, context: str, allow_empty: bool = False) -> str:
    _expect(isinstance(value, str), f"{context} must be a string.")
    clean = value.strip()
    _expect(allow_empty or bool(clean), f"{context} must be non-empty.")
    return clean


def _optional_strict_string(value: object, *, context: str, default: str = "") -> str:
    if value is None:
        return default
    _expect(isinstance(value, str), f"{context} must be a string when provided.")
    return value.strip()


def _strict_bool(value: object, *, context: str, default: bool) -> bool:
    if value is None:
        return default
    _expect(isinstance(value, bool), f"{context} must be a boolean.")
    return value


def _normalize_pipeline(pipeline: JsonDict) -> JsonDict:
    _reject_unknown_fields(pipeline, PIPELINE_FIELDS, context="spec.pipeline")
    strict_mode = _strict_bool(pipeline.get("strict_mode"), context="spec.pipeline.strict_mode", default=True)
    _expect(strict_mode, "spec.pipeline.strict_mode must stay true. Ad-hoc mode is blocked.")

    auto_audit = _strict_bool(pipeline.get("auto_audit"), context="spec.pipeline.auto_audit", default=True)
    auto_commit = _strict_bool(pipeline.get("auto_commit"), context="spec.pipeline.auto_commit", default=True)
    commit_message = _optional_strict_string(
        pipeline.get("commit_message"),
        context="spec.pipeline.commit_message",
        default="",
    )
    _expect(
        len(commit_message) <= MAX_COMMIT_MESSAGE_LENGTH,
        f"spec.pipeline.commit_message must be <= {MAX_COMMIT_MESSAGE_LENGTH} chars.",
    )

    return {
        "strict_mode": strict_mode,
        "auto_audit": auto_audit,
        "auto_commit": auto_commit,
        "commit_message": commit_message,
    }


def _normalize_operation(operation: JsonDict, index: int) -> JsonDict:
    _expect(isinstance(operation, dict), f"operations[{index}] must be an object.")

    op = _optional_strict_string(operation.get("op"), context=f"operations[{index}].op", default="")
    _expect(
        op in SUPPORTED_OPERATIONS,
        (
            f"operations[{index}].op={op!r} is not supported. "
            f"Allowed ops: {SUPPORTED_OPERATIONS}. "
            "Use `profile plan` before `profile apply`."
        ),
    )

    _reject_unknown_fields(operation, ALLOWED_OPERATION_FIELDS[op], context=f"operations[{index}]")
    for field in REQUIRED_FIELDS[op]:
        _expect(field in operation, f"operations[{index}] missing required field {field!r}.")

    idempotency_key = _strict_string(
        operation.get("idempotency_key"),
        context=f"operations[{index}].idempotency_key",
    )
    _expect(
        IDEMPOTENCY_KEY_PATTERN.match(idempotency_key) is not None,
        (
            f"operations[{index}].idempotency_key must match "
            f"{IDEMPOTENCY_KEY_PATTERN.pattern!r}."
        ),
    )

    normalized: JsonDict = {"op": op, "idempotency_key": idempotency_key}

    if op == "set_headline":
        value = _strict_string(operation.get("value"), context=f"operations[{index}].value")
        _expect(
            len(value) <= MAX_HEADLINE_LENGTH,
            f"operations[{index}].value exceeds max headline length ({MAX_HEADLINE_LENGTH}).",
        )
        normalized["value"] = value
        return normalized

    if op == "set_about":
        value = _strict_string(operation.get("value"), context=f"operations[{index}].value")
        _expect(
            len(value) <= MAX_ABOUT_LENGTH,
            f"operations[{index}].value exceeds max about length ({MAX_ABOUT_LENGTH}).",
        )
        normalized["value"] = value
        return normalized

    if op in {"set_profile_photo", "set_cover_photo"}:
        file_path = _strict_string(operation.get("file"), context=f"operations[{index}].file")
        normalized["file"] = file_path
        return normalized

    if op in {"add_skill", "remove_skill"}:
        name = _strict_string(operation.get("name"), context=f"operations[{index}].name")
        _expect(
            len(name) <= MAX_SKILL_LENGTH,
            f"operations[{index}].name exceeds max skill length ({MAX_SKILL_LENGTH}).",
        )
        normalized["name"] = name
        return normalized

    if op == "reorder_skill":
        name = _strict_string(operation.get("name"), context=f"operations[{index}].name")
        idx = operation.get("index")
        _expect(
            isinstance(idx, int) and not isinstance(idx, bool) and idx >= 0,
            f"operations[{index}].index must be an integer >= 0.",
        )
        normalized["name"] = name
        normalized["index"] = int(idx)
        return normalized

    if op == "add_experience":
        exp = operation.get("experience")
        _expect(isinstance(exp, dict), f"operations[{index}].experience must be an object.")
        _reject_unknown_fields(exp, EXPERIENCE_FIELDS, context=f"operations[{index}].experience")
        title = _strict_string(exp.get("title"), context=f"operations[{index}].experience.title")
        company = _strict_string(exp.get("company"), context=f"operations[{index}].experience.company")
        normalized["experience"] = {
            "id": _optional_strict_string(exp.get("id"), context=f"operations[{index}].experience.id", default=""),
            "title": title,
            "company": company,
            "start": _optional_strict_string(
                exp.get("start"),
                context=f"operations[{index}].experience.start",
                default="",
            ),
            "end": _optional_strict_string(
                exp.get("end"),
                context=f"operations[{index}].experience.end",
                default="",
            ),
            "description": _optional_strict_string(
                exp.get("description"),
                context=f"operations[{index}].experience.description",
                default="",
            ),
        }
        return normalized

    if op == "update_experience":
        exp_id = _strict_string(operation.get("id"), context=f"operations[{index}].id")
        patch = operation.get("patch")
        _expect(isinstance(patch, dict) and bool(patch), f"operations[{index}].patch must be a non-empty object.")
        _reject_unknown_fields(patch, EXPERIENCE_PATCH_FIELDS, context=f"operations[{index}].patch")
        normalized["id"] = exp_id
        normalized_patch: dict[str, str] = {}
        for key, value in patch.items():
            _expect(
                isinstance(value, str),
                f"operations[{index}].patch.{key} must be a string.",
            )
            normalized_patch[key] = value.strip()
        normalized["patch"] = normalized_patch
        return normalized

    if op == "remove_experience":
        exp_id = _strict_string(operation.get("id"), context=f"operations[{index}].id")
        normalized["id"] = exp_id
        return normalized

    raise SpecValidationError(f"Unsupported operation {op!r}.")


def load_spec(spec_file: Path) -> JsonDict:
    try:
        raw = json.loads(Path(spec_file).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise SpecValidationError(f"Spec file does not exist: {spec_file}") from exc
    except json.JSONDecodeError as exc:
        raise SpecValidationError(f"Invalid JSON in spec file {spec_file}: {exc}") from exc
    return validate_spec(raw)


def validate_spec(spec: JsonDict) -> JsonDict:
    _expect(isinstance(spec, dict), "Spec must be a JSON object.")
    _reject_unknown_fields(spec, TOP_LEVEL_FIELDS, context="spec")

    version = spec.get("version")
    _expect(isinstance(version, str), "spec.version must be a string.")
    _expect(
        version == SPEC_VERSION,
        f"Unsupported spec version {version!r}; expected {SPEC_VERSION!r}.",
    )

    raw_target_profile = spec.get("target_profile", "self")
    _expect(isinstance(raw_target_profile, str), "spec.target_profile must be a string.")
    target_profile = raw_target_profile.strip()
    _expect(bool(target_profile), "spec.target_profile must be a non-empty string.")

    operations = spec.get("operations")
    _expect(isinstance(operations, list), "spec.operations must be an array.")
    _expect(bool(operations), "spec.operations must contain at least one operation.")
    _expect(len(operations) <= MAX_OPERATIONS, f"spec.operations exceeds max operations ({MAX_OPERATIONS}).")

    normalized_ops: list[JsonDict] = []
    seen_idempotency_keys: set[str] = set()
    for index, operation in enumerate(operations):
        _expect(isinstance(operation, dict), f"operations[{index}] must be an object.")
        normalized = _normalize_operation(operation, index)
        idem = str(normalized["idempotency_key"])
        _expect(
            idem not in seen_idempotency_keys,
            f"Duplicate idempotency_key in spec.operations: {idem!r}.",
        )
        seen_idempotency_keys.add(idem)
        normalized_ops.append(normalized)

    pipeline_raw = spec.get("pipeline")
    _expect(
        pipeline_raw is None or isinstance(pipeline_raw, dict),
        "spec.pipeline must be an object when provided.",
    )
    normalized_pipeline = _normalize_pipeline(dict(pipeline_raw or {}))

    return {
        "version": SPEC_VERSION,
        "target_profile": target_profile,
        "operations": normalized_ops,
        "pipeline": normalized_pipeline,
    }
