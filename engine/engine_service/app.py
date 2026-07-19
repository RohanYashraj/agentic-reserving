"""engine_service FastAPI app — the imperative shell over reserving_engine.

AD-2: the only I/O/HTTP layer; the core stays pure. AD-3: no state
between requests (no cache, no session store, no files) — the sole
process-lifetime value is the immutable ``Settings``. AD-7: idempotency
by runId is determinism + statelessness, NOT a cache — an identical
retried ``/runs`` recomputes to a byte-identical response because the
core is pure, so there are no "recomputation side effects" to avoid.
AD-12: every route requires the shared bearer secret; no user auth; never
calls Convex or Clerk.

``create_app`` is a factory (the test seam — inject a known ``Settings``
without touching the environment). Run locally with the factory flag:

    uv run uvicorn engine_service.app:create_app --factory
"""

from collections.abc import Callable

from agno.models.base import Model
from fastapi import Depends, FastAPI
from fastapi.responses import JSONResponse

from copilot_agent import build_gemini_model
from engine_service.auth import make_service_auth
from engine_service.config import Settings, load_settings
from engine_service.errors import register_exception_handlers
from engine_service.models import (
    CanonicalizeResponse,
    ReDeriveRequest,
    RecommendRequest,
    RecommendResponse,
    RunRequest,
    RunResponse,
    ValidateRequest,
)
from engine_service.recommendations_flow import generate_recommendations
from reserving_engine import (
    compute_diagnostics,
    rederive,
    run_methods,
    triangle_hash,
    validate_triangle,
)


def create_app(
    settings: Settings | None = None,
    *,
    build_model: Callable[[], Model] | None = None,
) -> FastAPI:
    if settings is None:
        settings = load_settings()

    # The model seam (AD-8): prod builds the Gemini model from config on each
    # /recommendations request (so a missing key fails per-request into
    # ModelNotConfiguredError → model_unavailable, never at boot — AD-9). Tests
    # inject a scripted model via `build_model` without a live key.
    if build_model is None:
        def build_model() -> Model:
            return build_gemini_model(settings.gemini_api_key, settings.gemini_model_id)

    app = FastAPI(title="engine_service", version="0.1.0")
    register_exception_handlers(app)
    auth = Depends(make_service_auth(settings))

    @app.post("/validate", dependencies=[auth])
    def validate(request: ValidateRequest) -> JSONResponse:
        report = validate_triangle(request.triangle)
        return JSONResponse(content=report.model_dump(mode="json", by_alias=True))

    @app.post("/canonicalize", dependencies=[auth])
    def canonicalize(request: ValidateRequest) -> JSONResponse:
        # Story 3.3: the acceptance-time Lineage Triangle hash (AD-11), single-
        # sourced from the engine so it is byte-identical to the hash stamped
        # into Lineage at /runs. Triangle construction (in ValidateRequest) is
        # the structural backstop; no numbers are computed here (AD-1).
        response = CanonicalizeResponse(triangle_hash=triangle_hash(request.triangle))
        return JSONResponse(content=response.model_dump(mode="json", by_alias=True))

    @app.post("/runs", dependencies=[auth])
    def runs(request: RunRequest) -> JSONResponse:
        result_set = run_methods(request.triangle, request.parameters)
        bundle = compute_diagnostics(request.triangle, result_set, request.run_id)
        response = RunResponse(
            run_id=request.run_id,
            result_set=result_set,
            diagnostics_bundle=bundle,
        )
        return JSONResponse(content=response.model_dump(mode="json", by_alias=True))

    @app.post("/rederive", dependencies=[auth])
    def rederive_run(request: ReDeriveRequest) -> JSONResponse:
        # Story 4.7 (FR-6, AD-11): replay a stored ResultSet from its Lineage
        # and compare. All comparison arithmetic (the discrepancy deltas, the
        # exact/epsilon verdict) lives in reserving_engine.rederive — the shell
        # computes no numbers (AD-1/AD-2), it only carries the report to the wire.
        report = rederive(
            request.triangle, request.stored_result_set, run_id=request.run_id
        )
        return JSONResponse(content=report.model_dump(mode="json", by_alias=True))

    @app.post("/recommendations", dependencies=[auth])
    def recommendations(request: RecommendRequest) -> JSONResponse:
        # Story 5.3 (FR-10, AD-1/AD-5/AD-9): a thin adapter over the bounded
        # generate-gate-validate loop — build the model (fails closed to
        # model_unavailable if unconfigured), run the loop, serialize. Both the
        # accepted and rejected arms return HTTP 200 with the transcript(s) for
        # audit; ModelNotConfiguredError propagates to the error envelope (503).
        model = build_model()
        outcome = generate_recommendations(
            model, request.result_set, request.diagnostics_bundle
        )
        response = RecommendResponse.from_outcome(request.run_id, outcome)
        return JSONResponse(content=response.model_dump(mode="json", by_alias=True))

    return app
