class LinkedInCtlError(RuntimeError):
    """Base exception for linkedinctl failures."""


class SpecValidationError(LinkedInCtlError):
    """Raised when a JSON change spec is invalid."""


class AdapterExecutionError(LinkedInCtlError):
    """Raised when the external browser adapter execution fails."""


class PipelineGuardError(LinkedInCtlError):
    """Raised when a pipeline guardrail blocks execution."""
