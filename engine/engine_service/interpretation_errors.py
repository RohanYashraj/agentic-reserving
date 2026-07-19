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


class ModelUnavailableError(RuntimeError):
    """A LIVE model-plane outage (``copilot_agent.ModelCallError``) that
    persisted across the whole attempt budget (Story 5.6 review F16).

    Mapped by ``errors.py`` to the SAME 503 ``model_unavailable`` envelope as
    ``ModelNotConfiguredError``, so a genuine RUNTIME outage — not only
    misconfiguration — makes ``callEngine`` surface ``engine.model_unavailable``
    and Convex enter the workspace-global Engine-Only Mode (AC-1).

    ``attempts`` carries the JSON-serialized transcripts of the attempts that
    COMPLETED before the outage, so those already-happened LLM interactions are
    still audit-logged rather than lost when the request fails closed (review
    F6). Empty when the model was down from the first call. This module stays
    dependency-free (no FastAPI, no pydantic import) — the flow serializes the
    transcripts before raising."""

    def __init__(self, message: str, *, attempts: tuple[object, ...] = ()) -> None:
        super().__init__(message)
        self.attempts = attempts
