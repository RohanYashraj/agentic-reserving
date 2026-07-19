"""copilot_agent: the Agno-hosted interpretation agent layer (AD-8, AD-3).

The model is reached ONLY through Agno over the official ``google-genai``
SDK (never raw REST; the SDK absorbs Gemini 3.x thought-signature
handling in the tool loop). The agent's entire data-access boundary is a
set of read-only, provider-neutral tool views over the current Run's
in-memory ResultSet / DiagnosticsBundle — no filesystem, network, Convex,
or write operations (FR-9). No durable state remains in Agno sessions
(AD-3); the full session transcript is returned to the caller for audit
logging. The model ID is engine_service config, so a model swap is a
contained change.

Layer position: a shell ABOVE the pure ``reserving_engine`` core and
BELOW ``engine_service`` (which hosts it). copilot_agent imports only
``reserving_engine`` + ``agno`` + stdlib — never ``engine_service``
(upward) and never Convex/Clerk (cross-plane).
"""

from copilot_agent.agent import (
    InterpretationResult,
    ModelNotConfiguredError,
    build_gemini_model,
    build_interpretation_agent,
    run_interpretation,
)
from copilot_agent.tools import build_read_tools
from copilot_agent.transcript import (
    ToolCallRecord,
    Transcript,
    TranscriptMessage,
    build_transcript,
)

__all__ = [
    "InterpretationResult",
    "ModelNotConfiguredError",
    "ToolCallRecord",
    "Transcript",
    "TranscriptMessage",
    "build_gemini_model",
    "build_interpretation_agent",
    "build_read_tools",
    "build_transcript",
    "run_interpretation",
]
