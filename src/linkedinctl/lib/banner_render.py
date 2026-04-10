from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from .errors import SpecValidationError
from .types import JsonDict


DEFAULT_WIDTH = 1584
DEFAULT_HEIGHT = 396

DEFAULT_FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)


@dataclass(frozen=True)
class CoverRenderSpec:
    output: Path
    title: str
    subtitle: str
    bg_color: str
    text_color: str
    width: int
    height: int
    safe_zone_left: int
    title_x: int
    title_y: int
    title_size: int
    subtitle_x: int
    subtitle_y: int
    subtitle_size: int
    max_text_width: int
    font_path: str


def render_cover(spec: CoverRenderSpec) -> JsonDict:
    title = spec.title.strip()
    subtitle = spec.subtitle.strip()
    if not title:
        raise SpecValidationError("cover title cannot be empty.")
    if spec.width < 1200 or spec.height < 300:
        raise SpecValidationError("cover dimensions are too small for LinkedIn background.")
    if spec.safe_zone_left < 0:
        raise SpecValidationError("safe_zone_left must be >= 0.")
    if spec.max_text_width <= 80:
        raise SpecValidationError("max_text_width must be > 80.")

    output = spec.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    title_x = max(spec.title_x, spec.safe_zone_left)
    subtitle_x = max(spec.subtitle_x, spec.safe_zone_left)

    image = Image.new("RGB", (spec.width, spec.height), color=spec.bg_color)
    draw = ImageDraw.Draw(image)
    title_font = _load_font(spec.font_path, spec.title_size)
    subtitle_font = _load_font(spec.font_path, spec.subtitle_size)

    title_lines = _wrap_text(draw, title, title_font, spec.max_text_width)
    subtitle_lines = _wrap_text(draw, subtitle, subtitle_font, spec.max_text_width) if subtitle else []

    _draw_lines(
        draw=draw,
        lines=title_lines,
        font=title_font,
        x=title_x,
        y=spec.title_y,
        color=spec.text_color,
        line_spacing=12,
    )
    if subtitle_lines:
        _draw_lines(
            draw=draw,
            lines=subtitle_lines,
            font=subtitle_font,
            x=subtitle_x,
            y=spec.subtitle_y,
            color=spec.text_color,
            line_spacing=10,
        )

    suffix = output.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        image.save(output, quality=95)
    else:
        image.save(output)

    return {
        "ok": True,
        "output": str(output),
        "size": {"width": spec.width, "height": spec.height},
        "safe_zone_left": spec.safe_zone_left,
        "title_position": {"x": title_x, "y": spec.title_y},
        "subtitle_position": {"x": subtitle_x, "y": spec.subtitle_y},
        "title_lines": title_lines,
        "subtitle_lines": subtitle_lines,
    }


def _draw_lines(
    *,
    draw: ImageDraw.ImageDraw,
    lines: list[str],
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    x: int,
    y: int,
    color: str,
    line_spacing: int,
) -> None:
    current_y = y
    for line in lines:
        draw.text((x, current_y), line, fill=color, font=font)
        _, top, _, bottom = draw.textbbox((x, current_y), line, font=font)
        current_y += (bottom - top) + line_spacing


def _load_font(font_path: str, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if size <= 0:
        raise SpecValidationError("font size must be > 0.")
    if font_path.strip():
        path = Path(font_path).expanduser().resolve()
        if not path.exists():
            raise SpecValidationError(f"font_path not found: {path}")
        return ImageFont.truetype(str(path), size=size)

    for candidate in DEFAULT_FONT_CANDIDATES:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def _wrap_text(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    words = [part for part in text.split() if part]
    if not words:
        return []

    lines: list[str] = []
    current = words[0]

    for word in words[1:]:
        candidate = f"{current} {word}"
        if _text_width(draw, candidate, font) <= max_width:
            current = candidate
            continue
        lines.append(current)
        current = word

    lines.append(current)
    return lines


def _text_width(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
) -> int:
    left, _, right, _ = draw.textbbox((0, 0), text, font=font)
    return max(0, right - left)
