"""Fail-closed interpretation signals (Story 5.6, AD-9).

The bounded redraft loop (``recommendations_flow`` / ``report_flow``)
raises these when a per-Run budget is exhausted: the cumulative token
ceiling or the wall-clock timeout. They are DELIBERATE fail-closed
outcomes — like ``ModelNotConfiguredError`` — NOT redraftable gate
rejections and NOT bugs: ``errors.py`` maps each to a 503 envelope
(``cost_ceiling_exceeded`` / ``interpretation_timeout``), the same shape
as ``model_unavailable`` (decision #6 — a 503, never a 500).

They live in this tiny dependency-free module (no FastAPI, no clock, no
HTTP) so the flow modules can raise them without importing the HTTP
envelope layer and stay deterministic (AD-3). Each message is short and
NEVER echoes prompt content or the api key (AD-12)."""


class CostCeilingExceededError(RuntimeError):
    """The Run's cumulative interpretation token usage crossed the
    configured ``INTERPRETATION_TOKEN_CEILING`` (Story 5.6, AD-9)."""


class InterpretationTimeoutError(RuntimeError):
    """The interpretation redraft loop exceeded the configured
    ``INTERPRETATION_TIMEOUT_SECONDS`` deadline (Story 5.6, NFR-7)."""
