"""Agno-hosted Gemini agent construction and one interpretation run (AD-8).

The model is reached ONLY through Agno's abstraction over the official
``google-genai`` SDK — never raw REST — so Gemini 3.x thought-signature
handling in the tool loop is the SDK's job, not ours. ``build_gemini_model``
is the single place a provider-specific class is named (the AD-8 seam
lives here, never in ``engine_service``); the model ID is config, so a
model swap stays a contained change.

The agent is constructed with ``telemetry=False`` (no analytics egress
beyond the model plane) and NO durable store (``db``/session) — its
conversation state is transient per request and reconstructable only from
the returned :class:`~copilot_agent.transcript.Transcript` (AD-3).
"""

from dataclasses import dataclass

from agno.agent import Agent
from agno.exceptions import ModelProviderError
from agno.models.base import Model
from agno.models.google import Gemini
from agno.run.agent import RunStatus

from reserving_engine import DiagnosticsBundle, ResultSet

from copilot_agent.tools import build_read_tools
from copilot_agent.transcript import Transcript, build_transcript


class ModelNotConfiguredError(RuntimeError):
    """Raised when an interpretation agent is composed without a model
    api key / id — the Engine-Only Mode trigger (AD-9, Story 5.6)."""


class ModelCallError(RuntimeError):
    """A LIVE model-plane failure during one interpretation turn — the model
    is configured but the provider call failed (API 5xx / auth / rate-limit /
    remote-unavailable, a network error, or a per-call wall-clock timeout).

    Distinct from :class:`ModelNotConfiguredError` (misconfiguration, raised
    before any call). Agno funnels every provider failure through
    ``agno.exceptions.ModelProviderError``; ``run_interpretation`` catches that
    precise signal and re-raises it as this typed, provider-neutral error so
    ``engine_service`` can fail closed into Engine-Only Mode on a genuine RUNTIME
    outage (Story 5.6 AC-1, review F16) — without a broad ``except Exception``
    that would swallow real bugs. Raised per-attempt; the redraft loop decides
    the terminal fail-closed outcome after the attempt budget (review F18)."""


@dataclass(frozen=True)
class InterpretationResult:
    """What ``run_interpretation`` returns to the caller: the model's
    final text, the full audit transcript, and this turn's token usage.

    ``token_count`` is the run-level total tokens Agno reports on the
    ``RunOutput`` (``metrics.total_tokens``, agno 2.5.x — verified against
    the installed version). It defaults to ``0`` when usage is unavailable
    (a scripted/stub model with no live call — keeps deterministic tests
    passing); the redraft loop accumulates it to enforce the per-Run token
    ceiling (Story 5.6, AD-9). NEVER a reserve figure — a model-usage
    integer, engine-side only (AD-1)."""

    output_text: str
    transcript: Transcript
    token_count: int = 0


def build_gemini_model(
    api_key: str, model_id: str, *, timeout: float | None = None
) -> Gemini:
    """Build the Agno Gemini model from engine_service config (AD-8).

    ``api_key`` is passed EXPLICITLY: Agno's ``Gemini`` otherwise defaults
    to the env var ``GOOGLE_API_KEY``, but our config var is
    ``GEMINI_API_KEY`` — relying on Agno's default would silently read the
    wrong (absent) key. ``model_id`` is ``gemini-3.1-flash-lite`` supplied
    from ``Settings.gemini_model_id``.

    ``timeout`` (seconds, Story 5.6 review F18) is the hard per-call wall-clock
    bound: Agno's ``Gemini`` forwards it to the ``google-genai`` client's
    ``http_options.timeout`` (ms), so a single hung model call aborts at the SDK
    level rather than blocking the request indefinitely (NFR-7 ≤10 min). The
    aborted call surfaces as a ``ModelProviderError`` → ``ModelCallError`` and
    fails closed. ``None`` leaves the SDK default (used by scripted-model tests,
    which never build a real client).
    """
    if not api_key or not model_id:
        raise ModelNotConfiguredError(
            "GEMINI_API_KEY and GEMINI_MODEL_ID must both be set to build the "
            "interpretation model; interpretation falls closed to Engine-Only "
            "Mode when they are not (AD-9)"
        )
    return Gemini(id=model_id, api_key=api_key, timeout=timeout)


def build_interpretation_agent(
    model: Model,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
    *,
    instructions: str | list[str] | None = None,
) -> Agent:
    """Construct the interpretation agent for one Run.

    The ``model`` is INJECTED (the test seam — pass a stub with no api
    key). Tools are the read-only closures over this Run's ResultSet /
    DiagnosticsBundle. ``telemetry=False`` (AD-8) and no ``db`` (AD-3) are
    non-negotiable.
    """
    return Agent(
        model=model,
        tools=build_read_tools(result_set, diagnostics_bundle),
        instructions=instructions,
        telemetry=False,
        markdown=False,
    )


def run_interpretation(agent: Agent, prompt: str) -> InterpretationResult:
    """Run one interpretation and capture its transcript.

    A thin wrapper: no provenance gate, no Convex, no persistence (later
    stories). A live model-plane failure (API error, auth, rate-limit,
    remote-unavailable, or a per-call timeout) is surfaced as a typed
    :class:`ModelCallError` so the caller can fail closed into Engine-Only Mode
    on a genuine RUNTIME outage (AD-9, Story 5.6 review F16). Agno funnels every
    provider failure into a ``RunStatus.error`` ``RunOutput`` (it does NOT
    re-raise ``ModelProviderError`` out of ``run``), so the error state is read
    off the returned run — the ``except`` is a belt-and-braces guard for Agno
    versions that do propagate. An error-status run fails closed rather than
    passing the error text on as a draft.
    """
    try:
        run_output = agent.run(prompt)
    except ModelProviderError as exc:
        raise ModelCallError(str(exc)) from exc
    if getattr(run_output, "status", None) == RunStatus.error:
        raise ModelCallError(str(run_output.content or "model run failed"))
    return _result_from_run(run_output)


def probe_model(model: Model) -> None:
    """Cheap model-plane liveness probe (Story 5.6 review F17).

    Runs ONE minimal turn to confirm the model is actually REACHABLE, not merely
    configured — the Engine-Only Mode recovery path (``/interpretation/health``)
    must not signal "healthy" on a live outage. A live failure raises
    :class:`ModelCallError` (the route maps it to 503 ``model_unavailable`` so the
    workspace stays in Engine-Only Mode instead of a false recovery). Provider-
    neutral: goes through Agno, never raw REST; no tools, no Convex, no writes."""
    agent = Agent(model=model, telemetry=False, markdown=False)
    try:
        run_output = agent.run("ping")
    except ModelProviderError as exc:
        raise ModelCallError(str(exc)) from exc
    if getattr(run_output, "status", None) == RunStatus.error:
        raise ModelCallError(str(run_output.content or "model probe failed"))


def _result_from_run(run_output) -> InterpretationResult:
    # Run-level token usage (agno 2.5.x: RunOutput.metrics.total_tokens).
    # Defensive: metrics is `RunMetrics | None`, total_tokens may be None —
    # a scripted/stub model reports nothing, so default to 0 (AD-9 / tests).
    metrics = getattr(run_output, "metrics", None)
    token_count = getattr(metrics, "total_tokens", 0) or 0
    return InterpretationResult(
        output_text=run_output.content or "",
        transcript=build_transcript(run_output.messages or []),
        token_count=token_count,
    )
