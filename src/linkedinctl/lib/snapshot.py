from __future__ import annotations

from datetime import datetime, timezone

from .types import JsonDict


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _normalize_experience(experience: JsonDict) -> JsonDict:
    return {
        "id": str(experience.get("id") or "").strip(),
        "title": str(experience.get("title") or "").strip(),
        "company": str(experience.get("company") or "").strip(),
        "start": str(experience.get("start") or "").strip(),
        "end": str(experience.get("end") or "").strip(),
        "description": str(experience.get("description") or "").strip(),
    }


def empty_snapshot(target_profile: str = "self") -> JsonDict:
    return {
        "target_profile": target_profile,
        "headline": "",
        "about": "",
        "profile_photo_path": "",
        "cover_photo_path": "",
        "experiences": [],
        "skills": [],
        "updated_at": utc_now_iso(),
    }


def normalize_snapshot(raw: JsonDict, *, target_profile: str = "self") -> JsonDict:
    if not isinstance(raw, dict):
        return empty_snapshot(target_profile)

    experiences_raw = raw.get("experiences")
    if not isinstance(experiences_raw, list):
        experiences_raw = []

    skills_raw = raw.get("skills")
    if not isinstance(skills_raw, list):
        skills_raw = []

    normalized = {
        "target_profile": str(raw.get("target_profile") or target_profile),
        "headline": str(raw.get("headline") or ""),
        "about": str(raw.get("about") or ""),
        "profile_photo_path": str(raw.get("profile_photo_path") or ""),
        "cover_photo_path": str(raw.get("cover_photo_path") or ""),
        "experiences": [_normalize_experience(item) for item in experiences_raw if isinstance(item, dict)],
        "skills": [str(item).strip() for item in skills_raw if str(item).strip()],
        "updated_at": str(raw.get("updated_at") or utc_now_iso()),
    }

    deduped_skills: list[str] = []
    seen_skill_keys: set[str] = set()
    for skill in normalized["skills"]:
        key = skill.casefold()
        if key in seen_skill_keys:
            continue
        seen_skill_keys.add(key)
        deduped_skills.append(skill)
    normalized["skills"] = deduped_skills

    return normalized
