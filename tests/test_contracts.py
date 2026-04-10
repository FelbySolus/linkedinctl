from __future__ import annotations

import unittest

from linkedinctl.lib.contracts import validate_spec
from linkedinctl.lib.errors import SpecValidationError


class ContractsTest(unittest.TestCase):
    def test_valid_spec_normalizes_pipeline_defaults(self) -> None:
        spec = {
            "version": "1",
            "target_profile": "self",
            "operations": [
                {
                    "op": "set_headline",
                    "value": "Developer",
                    "idempotency_key": "headline-v1-abc",
                }
            ],
        }

        normalized = validate_spec(spec)

        self.assertEqual(normalized["version"], "1")
        self.assertEqual(normalized["pipeline"]["strict_mode"], True)
        self.assertEqual(normalized["pipeline"]["auto_audit"], True)
        self.assertEqual(normalized["pipeline"]["auto_commit"], True)

    def test_rejects_unknown_top_level_fields(self) -> None:
        with self.assertRaises(SpecValidationError):
            validate_spec(
                {
                    "version": "1",
                    "target_profile": "self",
                    "operations": [
                        {
                            "op": "set_headline",
                            "value": "Developer",
                            "idempotency_key": "headline-v1-abc",
                        }
                    ],
                    "hacked": True,
                }
            )

    def test_rejects_non_boolean_pipeline_flags(self) -> None:
        with self.assertRaises(SpecValidationError):
            validate_spec(
                {
                    "version": "1",
                    "target_profile": "self",
                    "operations": [
                        {
                            "op": "set_headline",
                            "value": "Developer",
                            "idempotency_key": "headline-v1-abc",
                        }
                    ],
                    "pipeline": {
                        "strict_mode": "true",
                    },
                }
            )

    def test_rejects_bad_idempotency_key(self) -> None:
        with self.assertRaises(SpecValidationError):
            validate_spec(
                {
                    "version": "1",
                    "target_profile": "self",
                    "operations": [
                        {
                            "op": "set_headline",
                            "value": "Developer",
                            "idempotency_key": "BAD KEY",
                        }
                    ],
                }
            )


if __name__ == "__main__":
    unittest.main()
