from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from linkedinctl.lib.banner_render import CoverRenderSpec, render_cover
from linkedinctl.lib.errors import SpecValidationError


class BannerRenderTest(unittest.TestCase):
    def test_render_cover_clamps_text_to_safe_zone(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "cover.jpg"
            payload = render_cover(
                CoverRenderSpec(
                    output=output,
                    title="Your Name",
                    subtitle="Software Developer",
                    bg_color="#000000",
                    text_color="#FFFFFF",
                    width=1584,
                    height=396,
                    safe_zone_left=320,
                    title_x=120,
                    title_y=118,
                    title_size=56,
                    subtitle_x=120,
                    subtitle_y=202,
                    subtitle_size=24,
                    max_text_width=1120,
                    font_path="",
                )
            )

            self.assertTrue(output.exists())
            self.assertEqual(payload["title_position"]["x"], 320)
            self.assertEqual(payload["subtitle_position"]["x"], 320)

    def test_render_cover_requires_title(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            output = Path(temp_dir) / "cover.jpg"
            with self.assertRaises(SpecValidationError):
                render_cover(
                    CoverRenderSpec(
                        output=output,
                        title="",
                        subtitle="",
                        bg_color="#000000",
                        text_color="#FFFFFF",
                        width=1584,
                        height=396,
                        safe_zone_left=320,
                        title_x=360,
                        title_y=118,
                        title_size=56,
                        subtitle_x=360,
                        subtitle_y=202,
                        subtitle_size=24,
                        max_text_width=1120,
                        font_path="",
                    )
                )


if __name__ == "__main__":
    unittest.main()
