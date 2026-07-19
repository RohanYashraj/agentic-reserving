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
from agno.models.base import Model
from agno.models.google import Gemini

from reserving_engine import DiagnosticsBundle, ResultSet

from copilot_agent.tools import build_read_tools
from copilot_agent.transcript import Transcript, build_transcript


class ModelNotConfiguredError(RuntimeError):
    """Raised when an interpretation agent is composed without a model
    api key / id — the Engine-Only Mode trigger (AD-9, Story 5.6)."""


@dataclass(frozen=True)
class InterpretationResult:
    """What ``run_interpretation`` returns to the caller: the model's
    final text plus the full audit transcript."""

    output_text: str
    transcript: Transcript


def build_gemini_model(api_key: str, model_id: str) -> Gemini:
    """Build the Agno Gemini model from engine_service config (AD-8).

    ``api_key`` is passed EXPLICITLY: Agno's ``Gemini`` otherwise defaults
    to the env var ``GOOGLE_API_KEY``, but our config var is
    ``GEMINI_API_KEY`` — relying on Agno's default would silently read the
    wrong (absent) key. ``model_id`` is ``gemini-3.1-flash-lite`` supplied
    from ``Settings.gemini_model_id``.
    """
    if not api_key or not model_id:
        raise ModelNotConfiguredError(
            "GEMINI_API_KEY and GEMINI_MODEL_ID must both be set to build the "
            "interpretation model; interpretation falls closed to Engine-Only "
            "Mode when they are not (AD-9)"
        )
    return Gemini(id=model_id, api_key=api_key)


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
    stories). Model-plane errors propagate to the caller, which owns
    retry / fail-closed (AD-9).
    """
    run_output = agent.run(prompt)
    return InterpretationResult(
        output_text=run_output.content or "",
        transcript=build_transcript(run_output.messages or []),
    )
