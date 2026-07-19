"""engine_service FastAPI shell tests (Story 2.5).

The service is a thin imperative shell over reserving_engine (AD-2): it
adds bearer service-auth (AD-12), a single error envelope, and nothing
else. These tests assert the HTTP boundary changes nothing about the
numbers — the response equals a direct engine call — plus auth, error
envelopes, and idempotent-by-runId determinism (AD-3/AD-7).

Golden literals live in test_golden_taylor_ashe.py; here we only prove
delegation, so we compare against the live engine, never re-pin values.
"""

import pytest
from fastapi.testclient import TestClient

from engine_service import Settings, create_app
from reserving_engine import (
    AprioriLossRatio,
    RunParameters,
    Triangle,
    compute_diagnostics,
    run_methods,
    triangle_hash,
    validate_triangle,
)
from tests.fixtures import TAYLOR_ASHE

TEST_SECRET = "test-service-secret-123"
AUTH = {"Authorization": f"Bearer {TEST_SECRET}"}

# 2.3's canonical BF prior: 0.9 loss ratio on 5,000,000 exposure per Origin Period.
BF_APRIORIS = tuple(
    AprioriLossRatio(origin=origin, loss_ratio=0.9, exposure=5_000_000.0)
    for origin in TAYLOR_ASHE.origin_periods
)
CL_BF_MACK = RunParameters(
    methods=("chain_ladder", "bornhuetter_ferguson", "mack"),
    apriori_loss_ratios=BF_APRIORIS,
)

# A structurally valid paid Triangle whose second cell decreases — a
# domain monotonicity defect (not a container defect), so it parses as a
# Triangle and is rejected by validate_triangle, not by the model.
BAD_TRIANGLE = Triangle(
    kind="paid",
    origin_periods=("2001", "2002"),
    development_periods=("12", "24"),
    cells=((100.0, 90.0), (200.0, None)),
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(settings=Settings(service_secret=TEST_SECRET)))


def _triangle_payload(triangle: Triangle) -> dict:
    return triangle.model_dump(mode="json")


def _run_body(run_id: str, triangle: Triangle, parameters: RunParameters | None = None) -> dict:
    body: dict = {"runId": run_id, "triangle": _triangle_payload(triangle)}
    if parameters is not None:
        body["parameters"] = parameters.model_dump(mode="json", by_alias=True)
    return body


# --------------------------------------------------------------------------- #
# AC-1: auth rejection                                                          #
# --------------------------------------------------------------------------- #


class TestAuth:
    @pytest.mark.parametrize(
        "path", ["/validate", "/runs", "/canonicalize", "/rederive", "/recommendations", "/reports"]
    )
    def test_missing_authorization_header_is_401(self, client: TestClient, path: str) -> None:
        resp = client.post(path, json={})
        assert resp.status_code == 401
        body = resp.json()
        assert body["code"] == "unauthorized"
        assert set(body) == {"code", "message", "details"}

    @pytest.mark.parametrize(
        "path", ["/validate", "/runs", "/canonicalize", "/rederive", "/recommendations", "/reports"]
    )
    def test_wrong_secret_is_401(self, client: TestClient, path: str) -> None:
        resp = client.post(path, json={}, headers={"Authorization": "Bearer wrong-secret"})
        assert resp.status_code == 401
        assert resp.json()["code"] == "unauthorized"

    @pytest.mark.parametrize(
        "path", ["/validate", "/runs", "/canonicalize", "/rederive", "/recommendations", "/reports"]
    )
    def test_non_bearer_scheme_is_401(self, client: TestClient, path: str) -> None:
        resp = client.post(path, json={}, headers={"Authorization": f"Basic {TEST_SECRET}"})
        assert resp.status_code == 401

    @pytest.mark.parametrize(
        "path", ["/validate", "/runs", "/canonicalize", "/rederive", "/recommendations", "/reports"]
    )
    def test_non_ascii_token_is_401_not_500(self, client: TestClient, path: str) -> None:
        # A non-ASCII bearer token must fail closed as 401 — never crash the
        # constant-time compare (TypeError) into an unhandled 500. Sent as raw
        # bytes to bypass the client's ASCII header guard, as a hostile caller
        # on the wire would (Starlette decodes headers as latin-1).
        resp = client.post(path, json={}, headers={"Authorization": b"Bearer \xffbad"})
        assert resp.status_code == 401
        assert resp.json()["code"] == "unauthorized"

    def test_bearer_scheme_is_case_insensitive(self, client: TestClient) -> None:
        # RFC 7235: the auth scheme is case-insensitive; a correct secret with
        # a lowercase scheme is accepted, not rejected.
        resp = client.post(
            "/validate",
            json={"triangle": _triangle_payload(TAYLOR_ASHE)},
            headers={"Authorization": f"bearer {TEST_SECRET}"},
        )
        assert resp.status_code == 200

    def test_401_body_never_echoes_presented_token(self, client: TestClient) -> None:
        secret_guess = "super-secret-guess-9000"
        resp = client.post(
            "/validate", json={}, headers={"Authorization": f"Bearer {secret_guess}"}
        )
        assert resp.status_code == 401
        assert secret_guess not in resp.text
        assert TEST_SECRET not in resp.text

    def test_correct_secret_is_not_401(self, client: TestClient) -> None:
        resp = client.post(
            "/validate", json={"triangle": _triangle_payload(TAYLOR_ASHE)}, headers=AUTH
        )
        assert resp.status_code == 200


# --------------------------------------------------------------------------- #
# AC-2: happy paths delegate to the engine unchanged                           #
# --------------------------------------------------------------------------- #


class TestValidateHappyPath:
    def test_valid_triangle_returns_engine_report(self, client: TestClient) -> None:
        resp = client.post(
            "/validate", json={"triangle": _triangle_payload(TAYLOR_ASHE)}, headers=AUTH
        )
        assert resp.status_code == 200
        assert resp.json() == validate_triangle(TAYLOR_ASHE).model_dump(mode="json", by_alias=True)
        assert resp.json()["valid"] is True
        assert resp.json()["findings"] == []


class TestRunsHappyPath:
    def test_chain_ladder_only_matches_direct_engine_call(self, client: TestClient) -> None:
        run_id = "run-cl-001"
        resp = client.post("/runs", json=_run_body(run_id, TAYLOR_ASHE), headers=AUTH)
        assert resp.status_code == 200

        result_set = run_methods(TAYLOR_ASHE)
        bundle = compute_diagnostics(TAYLOR_ASHE, result_set, run_id)
        body = resp.json()
        assert body["runId"] == run_id
        assert body["resultSet"] == result_set.model_dump(mode="json", by_alias=True)
        assert body["diagnosticsBundle"] == bundle.model_dump(mode="json", by_alias=True)

    def test_cl_bf_mack_matches_direct_engine_call(self, client: TestClient) -> None:
        run_id = "run-clbfmack-001"
        resp = client.post(
            "/runs", json=_run_body(run_id, TAYLOR_ASHE, CL_BF_MACK), headers=AUTH
        )
        assert resp.status_code == 200

        result_set = run_methods(TAYLOR_ASHE, CL_BF_MACK)
        bundle = compute_diagnostics(TAYLOR_ASHE, result_set, run_id)
        body = resp.json()
        assert body["resultSet"] == result_set.model_dump(mode="json", by_alias=True)
        assert body["diagnosticsBundle"] == bundle.model_dump(mode="json", by_alias=True)

    def test_diagnostic_ids_embed_the_request_run_id(self, client: TestClient) -> None:
        run_id = "run-embed-xyz"
        resp = client.post(
            "/runs", json=_run_body(run_id, TAYLOR_ASHE, CL_BF_MACK), headers=AUTH
        )
        bundle = resp.json()["diagnosticsBundle"]
        every_id = (
            [e["id"] for e in bundle["ldfStability"]]
            + [e["id"] for e in bundle["ave"]]
            + [e["id"] for e in bundle["clBfDivergence"]]
            + [e["id"] for e in bundle["residuals"]]
        )
        assert every_id
        assert all(f":{run_id}:" in diag_id for diag_id in every_id)


# --------------------------------------------------------------------------- #
# AC-4: validation-failure passthrough (cell-level errors intact)              #
# --------------------------------------------------------------------------- #


class TestValidationPassthrough:
    def test_validate_returns_200_with_cell_level_finding(self, client: TestClient) -> None:
        resp = client.post(
            "/validate", json={"triangle": _triangle_payload(BAD_TRIANGLE)}, headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["valid"] is False
        assert body == validate_triangle(BAD_TRIANGLE).model_dump(mode="json", by_alias=True)
        finding = body["findings"][0]
        assert {"origin", "dev", "reason", "code"} <= set(finding)
        assert finding["code"] == "paid_monotonicity"

    def test_runs_on_invalid_triangle_is_422_with_findings_intact(
        self, client: TestClient
    ) -> None:
        resp = client.post("/runs", json=_run_body("run-bad", BAD_TRIANGLE), headers=AUTH)
        assert resp.status_code == 422
        body = resp.json()
        assert body["code"] == "triangle_invalid"
        expected_findings = [
            f.model_dump(by_alias=True)
            for f in validate_triangle(BAD_TRIANGLE).findings
        ]
        assert body["details"] == expected_findings

    def test_runs_missing_apriori_is_422_naming_origins(self, client: TestClient) -> None:
        params = RunParameters(methods=("bornhuetter_ferguson",))  # no aprioris
        resp = client.post(
            "/runs", json=_run_body("run-noprior", TAYLOR_ASHE, params), headers=AUTH
        )
        assert resp.status_code == 422
        body = resp.json()
        assert body["code"] == "missing_apriori"
        missing = body["details"]["missingOrigins"]
        assert set(missing) == set(TAYLOR_ASHE.origin_periods)
        assert "2001" in body["message"]

    def test_runs_unknown_apriori_is_422_envelope_not_500(self, client: TestClient) -> None:
        # A malformed a-priori set (origin absent from the Triangle) must ride
        # the same envelope as its missing-a-priori sibling, never a bare 500.
        stranger = AprioriLossRatio(origin="1999", loss_ratio=0.9, exposure=5_000_000.0)
        params = RunParameters(
            methods=("bornhuetter_ferguson",), apriori_loss_ratios=BF_APRIORIS + (stranger,)
        )
        resp = client.post(
            "/runs", json=_run_body("run-stranger", TAYLOR_ASHE, params), headers=AUTH
        )
        assert resp.status_code == 422
        body = resp.json()
        assert body["code"] == "invalid_apriori"
        assert body["details"]["origins"] == ["1999"]
        assert set(body) == {"code", "message", "details"}


# --------------------------------------------------------------------------- #
# AC-2/AC-4: idempotent retry + statelessness                                  #
# --------------------------------------------------------------------------- #


class TestIdempotencyAndStatelessness:
    def test_identical_requests_return_byte_identical_bodies(self, client: TestClient) -> None:
        body = _run_body("run-idem", TAYLOR_ASHE, CL_BF_MACK)
        first = client.post("/runs", json=body, headers=AUTH)
        second = client.post("/runs", json=body, headers=AUTH)
        assert first.status_code == second.status_code == 200
        assert first.content == second.content

    def test_different_run_id_differs_only_in_run_id_and_diagnostic_ids(
        self, client: TestClient
    ) -> None:
        resp_a = client.post("/runs", json=_run_body("run-A", TAYLOR_ASHE, CL_BF_MACK), headers=AUTH)
        resp_b = client.post("/runs", json=_run_body("run-B", TAYLOR_ASHE, CL_BF_MACK), headers=AUTH)
        body_a, body_b = resp_a.json(), resp_b.json()

        # resultSet is runId-independent → identical across runs (no cross-request bleed).
        assert body_a["resultSet"] == body_b["resultSet"]
        # Diagnostic IDs embed the runId → differ; underlying values are the same.
        ids_a = [e["id"] for e in body_a["diagnosticsBundle"]["ldfStability"]]
        ids_b = [e["id"] for e in body_b["diagnosticsBundle"]["ldfStability"]]
        assert ids_a != ids_b
        assert all(":run-A:" in i for i in ids_a)
        assert all(":run-B:" in i for i in ids_b)


# --------------------------------------------------------------------------- #
# Error-envelope coverage: malformed body + wire shape                         #
# --------------------------------------------------------------------------- #


class TestErrorEnvelopeAndWire:
    def test_runs_missing_run_id_is_bad_request_envelope(self, client: TestClient) -> None:
        body = {"triangle": _triangle_payload(TAYLOR_ASHE)}  # no runId
        resp = client.post("/runs", json=body, headers=AUTH)
        assert resp.status_code == 422
        assert resp.json()["code"] == "bad_request"
        assert set(resp.json()) == {"code", "message", "details"}

    def test_runs_empty_run_id_is_bad_request_envelope(self, client: TestClient) -> None:
        body = _run_body("", TAYLOR_ASHE)
        resp = client.post("/runs", json=body, headers=AUTH)
        assert resp.status_code == 422
        assert resp.json()["code"] == "bad_request"

    def test_validate_ragged_triangle_is_bad_request_envelope(self, client: TestClient) -> None:
        ragged = {
            "kind": "paid",
            "origin_periods": ["2001", "2002"],
            "development_periods": ["12", "24"],
            "cells": [[100.0, 200.0], [300.0]],  # row 2 is short → container defect
        }
        resp = client.post("/validate", json={"triangle": ragged}, headers=AUTH)
        assert resp.status_code == 422
        assert resp.json()["code"] == "bad_request"

    def test_runs_response_top_level_keys_are_camelcase(self, client: TestClient) -> None:
        resp = client.post(
            "/runs", json=_run_body("run-wire", TAYLOR_ASHE, CL_BF_MACK), headers=AUTH
        )
        body = resp.json()
        assert set(body) == {"runId", "resultSet", "diagnosticsBundle"}
        assert "schemaVersion" in body["resultSet"]
        assert "lineage" in body["resultSet"]
        assert "ldfStability" in body["diagnosticsBundle"]
        assert "schemaVersion" in body["diagnosticsBundle"]


# --------------------------------------------------------------------------- #
# Story 3.3: /canonicalize — the engine-computed canonical Triangle hash        #
# --------------------------------------------------------------------------- #


class TestCanonicalize:
    def test_returns_engine_triangle_hash(self, client: TestClient) -> None:
        # The Lineage Triangle hash (AD-11) is single-sourced from the engine —
        # /canonicalize must return exactly triangle_hash(triangle), the same
        # value stamped into Lineage at /runs. camelCase key on the wire.
        resp = client.post(
            "/canonicalize", json={"triangle": _triangle_payload(TAYLOR_ASHE)}, headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert set(body) == {"triangleHash"}
        assert body["triangleHash"] == triangle_hash(TAYLOR_ASHE)

    def test_matches_lineage_triangle_hash_from_runs(self, client: TestClient) -> None:
        # The whole point: the hash recorded at acceptance equals the hash a Run
        # later stamps into Lineage, so re-derivation (4.7) and the diagnostics
        # equality check never diverge.
        canon = client.post(
            "/canonicalize", json={"triangle": _triangle_payload(TAYLOR_ASHE)}, headers=AUTH
        ).json()
        runs = client.post("/runs", json=_run_body("run-hash", TAYLOR_ASHE), headers=AUTH).json()
        assert canon["triangleHash"] == runs["resultSet"]["lineage"]["triangleHash"]

    def test_malformed_triangle_is_422_bad_request(self, client: TestClient) -> None:
        # Duplicate development labels is a container defect — the Triangle model
        # rejects it at request-body validation, before any hash is computed.
        duplicate = {
            "kind": "paid",
            "origin_periods": ["2001", "2002"],
            "development_periods": ["12", "12"],  # duplicate → container defect
            "cells": [[100.0, 200.0], [300.0, 400.0]],
        }
        resp = client.post("/canonicalize", json={"triangle": duplicate}, headers=AUTH)
        assert resp.status_code == 422
        assert resp.json()["code"] == "bad_request"


# --------------------------------------------------------------------------- #
# Story 4.7: /rederive — replay a stored ResultSet from its Lineage           #
# --------------------------------------------------------------------------- #


def _rederive_body(run_id: str, triangle: Triangle, stored_result_set) -> dict:
    return {
        "runId": run_id,
        "triangle": _triangle_payload(triangle),
        "storedResultSet": stored_result_set.model_dump(mode="json", by_alias=True),
    }


class TestRederive:
    def test_untouched_resultset_reproduces(self, client: TestClient) -> None:
        stored = run_methods(TAYLOR_ASHE, CL_BF_MACK)
        resp = client.post(
            "/rederive", json=_rederive_body("run-1", TAYLOR_ASHE, stored), headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["reproduced"] is True
        assert body["triangleHashVerified"] is True
        assert body["discrepancies"] == []
        assert body["runId"] == "run-1"
        assert body["tier"] in {"exact", "epsilon"}
        assert body["schemaVersion"] == "1.0.0"

    def test_tampered_resultset_surfaces_a_discrepancy(self, client: TestClient) -> None:
        stored = run_methods(TAYLOR_ASHE, CL_BF_MACK)
        m0 = stored.method_results[0]
        o1 = m0.origin_results[1]
        tampered_method = m0.model_copy(
            update={
                "origin_results": (
                    (m0.origin_results[0], o1.model_copy(update={"ultimate": o1.ultimate + 500.0}))
                    + m0.origin_results[2:]
                )
            }
        )
        tampered = stored.model_copy(
            update={"method_results": (tampered_method,) + stored.method_results[1:]}
        )
        resp = client.post(
            "/rederive", json=_rederive_body("run-1", TAYLOR_ASHE, tampered), headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["reproduced"] is False
        assert body["triangleHashVerified"] is True
        assert len(body["discrepancies"]) == 1
        disc = body["discrepancies"][0]
        assert disc["method"] == "chain_ladder"
        assert disc["field"] == "ultimate"
        assert disc["stored"] > disc["rederived"]

    def test_foreign_triangle_fails_chain_of_custody(self, client: TestClient) -> None:
        stored = run_methods(TAYLOR_ASHE, CL_BF_MACK)
        foreign = TAYLOR_ASHE.model_copy(update={"kind": "incurred"})
        resp = client.post(
            "/rederive", json=_rederive_body("run-1", foreign, stored), headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["triangleHashVerified"] is False
        assert body["reproduced"] is False
        assert body["discrepancies"] == []

    def test_empty_run_id_is_422_bad_request(self, client: TestClient) -> None:
        stored = run_methods(TAYLOR_ASHE)
        resp = client.post(
            "/rederive", json=_rederive_body("", TAYLOR_ASHE, stored), headers=AUTH
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "bad_request"


# --------------------------------------------------------------------------- #
# Story 5.3: POST /recommendations — the interpretation endpoint (AC-1..4)      #
# --------------------------------------------------------------------------- #

import json  # noqa: E402

from agno.exceptions import ModelProviderError  # noqa: E402
from agno.models.base import Model  # noqa: E402
from agno.models.response import ModelResponse  # noqa: E402


class _ScriptedModel(Model):
    """A scripted model returning a canned final answer per attempt (no network,
    no google-genai) — the 5.1 injection seam for the endpoint (Task 8.5)."""

    def __init__(self, outputs: list[str]) -> None:
        super().__init__(id="scripted-endpoint-model")
        self.provider = "scripted"
        self._outputs = outputs
        self._i = 0

    def invoke(self, *args, **kwargs) -> ModelResponse:
        out = self._outputs[min(self._i, len(self._outputs) - 1)]
        self._i += 1
        return ModelResponse(role="assistant", content=out)

    async def ainvoke(self, *args, **kwargs) -> ModelResponse:
        return self.invoke(*args, **kwargs)

    def invoke_stream(self, *args, **kwargs):
        yield self.invoke(*args, **kwargs)

    async def ainvoke_stream(self, *args, **kwargs):
        yield self.invoke(*args, **kwargs)

    def _parse_provider_response(self, response, **kwargs) -> ModelResponse:
        return response

    def _parse_provider_response_delta(self, response) -> ModelResponse:
        return response


class _RaisingModel(_ScriptedModel):
    """A model that fails like a LIVE Gemini outage (review F16/F17): Agno
    funnels provider failures through ``ModelProviderError``. Returns the ``pre``
    scripted outputs first (attempts that complete before the outage, F6), then
    raises on every subsequent call."""

    def __init__(self, pre: list[str] | None = None) -> None:
        super().__init__(pre or [])
        self._pre = list(pre or [])

    def invoke(self, *args, **kwargs) -> ModelResponse:
        if self._i < len(self._pre):
            return super().invoke(*args, **kwargs)
        raise ModelProviderError(
            message="gemini is down", model_name="scripted", model_id="x"
        )


REC_RUN_ID = "run-5-3-endpoint"


def _rec_run():
    result_set = run_methods(TAYLOR_ASHE, CL_BF_MACK)
    bundle = compute_diagnostics(TAYLOR_ASHE, result_set, REC_RUN_ID)
    return result_set, bundle


def _rec_body(run_id: str, result_set, bundle) -> dict:
    return {
        "runId": run_id,
        "resultSet": result_set.model_dump(mode="json", by_alias=True),
        "diagnosticsBundle": bundle.model_dump(mode="json", by_alias=True),
    }


def _draft_json(result_set, bundle, *, drop_first=False):
    origins = [o.origin for o in result_set.method_results[0].origin_results]
    dx_id = bundle.ldf_stability[0].id
    use = origins[1:] if drop_first else origins
    recs = [
        {
            "origin": origin,
            "method": "chain_ladder",
            "reasons": [f"Recommended for {origin} " + "{{" + dx_id + "}}."],
        }
        for origin in use
    ]
    return json.dumps({"recommendations": recs})


def _rec_client(build_model, *, gemini_key: str | None = "k", gemini_model: str | None = "m") -> TestClient:
    settings = Settings(
        service_secret=TEST_SECRET,
        gemini_api_key=gemini_key,
        gemini_model_id=gemini_model,
    )
    return TestClient(create_app(settings=settings, build_model=build_model))


class TestRecommendations:
    def test_accepted_returns_document_and_transcript_200(self) -> None:
        result_set, bundle = _rec_run()
        good = _draft_json(result_set, bundle)
        client = _rec_client(lambda: _ScriptedModel([good]))
        resp = client.post(
            "/recommendations", json=_rec_body(REC_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "accepted"
        assert body["recommendations"] is not None
        assert body["recommendations"]["runId"] == REC_RUN_ID
        # One recommendation per Origin Period.
        origins = [o.origin for o in result_set.method_results[0].origin_results]
        assert len(body["recommendations"]["recommendations"]) == len(origins)
        # The transcript rides in every arm (FR-15).
        assert len(body["attempts"]) == 1
        assert body["rejectionSummary"] is None

    def test_gate_exhaustion_returns_rejected_200_no_recommendations(self) -> None:
        result_set, bundle = _rec_run()
        # Persistently missing an origin → the loop exhausts and rejects.
        bad = _draft_json(result_set, bundle, drop_first=True)
        client = _rec_client(lambda: _ScriptedModel([bad]))
        resp = client.post(
            "/recommendations", json=_rec_body(REC_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "rejected"
        assert body["recommendations"] is None
        assert len(body["attempts"]) >= 1
        assert body["rejectionSummary"]

    def test_model_not_configured_is_model_unavailable_503(self) -> None:
        result_set, bundle = _rec_run()
        # No injected model + no key → build_gemini_model raises → 503 envelope.
        client = _rec_client(None, gemini_key=None, gemini_model=None)
        resp = client.post(
            "/recommendations", json=_rec_body(REC_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "model_unavailable"
        assert set(body) == {"code", "message", "details"}

    def test_empty_run_id_is_422_bad_request(self) -> None:
        result_set, bundle = _rec_run()
        good = _draft_json(result_set, bundle)
        client = _rec_client(lambda: _ScriptedModel([good]))
        resp = client.post(
            "/recommendations", json=_rec_body("", result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "bad_request"


# --------------------------------------------------------------------------- #
# Story 5.4: POST /reports — the Reserve Report drafting endpoint (AC-1..4)     #
# --------------------------------------------------------------------------- #

from reserving_engine import (  # noqa: E402
    MethodRecommendation,
    RecommendationReason,
    Recommendations,
)

REPORT_RUN_ID = "run-5-4-endpoint"


def _report_recommendations(result_set, bundle):
    citation = bundle.ave[0].id
    origins = [o.origin for o in result_set.method_results[0].origin_results]
    return Recommendations(
        run_id=REPORT_RUN_ID,
        recommendations=tuple(
            MethodRecommendation(
                origin=origin,
                method="chain_ladder",
                reasons=(RecommendationReason(text=f"Chosen for {origin}.", citations=(citation,)),),
            )
            for origin in origins
        ),
    )


def _report_run():
    result_set = run_methods(TAYLOR_ASHE, CL_BF_MACK)
    bundle = compute_diagnostics(TAYLOR_ASHE, result_set, REPORT_RUN_ID)
    return result_set, bundle


def _report_body(run_id: str, result_set, bundle) -> dict:
    return {
        "runId": run_id,
        "resultSet": result_set.model_dump(mode="json", by_alias=True),
        "diagnosticsBundle": bundle.model_dump(mode="json", by_alias=True),
        "recommendations": _report_recommendations(result_set, bundle).model_dump(
            mode="json", by_alias=True
        ),
    }


def _report_draft_json(result_set, bundle, *, blank_section=None):
    dx_id = bundle.ldf_stability[0].id
    dx_ph = "{{" + dx_id + "}}"

    def _section(name: str, default: str) -> str:
        return "   " if blank_section == name else default

    return json.dumps(
        {
            "executiveSummary": _section("executiveSummary", f"Stable position {dx_ph}."),
            "methodSelectionRationale": _section(
                "methodSelectionRationale", f"Chain ladder chosen {dx_ph}."
            ),
            "movementCommentary": _section(
                "movementCommentary", f"No notable movements {dx_ph}."
            ),
            "limitations": _section("limitations", "Estimates carry uncertainty."),
        }
    )


class TestReports:
    def test_accepted_returns_document_and_transcript_200(self) -> None:
        result_set, bundle = _report_run()
        good = _report_draft_json(result_set, bundle)
        client = _rec_client(lambda: _ScriptedModel([good]))
        resp = client.post(
            "/reports", json=_report_body(REPORT_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "accepted"
        assert body["report"] is not None
        assert body["report"]["runId"] == REPORT_RUN_ID
        assert body["report"]["machineDrafted"] is True
        # The four named sections are present.
        for field in (
            "executiveSummary",
            "methodSelectionRationale",
            "movementCommentary",
            "limitations",
        ):
            assert field in body["report"]
        # The transcript rides in every arm (FR-15).
        assert len(body["attempts"]) == 1
        assert body["rejectionSummary"] is None

    def test_gate_exhaustion_returns_rejected_200_no_report(self) -> None:
        result_set, bundle = _report_run()
        # Persistently blank section → the loop exhausts and rejects.
        bad = _report_draft_json(result_set, bundle, blank_section="limitations")
        client = _rec_client(lambda: _ScriptedModel([bad]))
        resp = client.post(
            "/reports", json=_report_body(REPORT_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "rejected"
        assert body["report"] is None
        assert len(body["attempts"]) >= 1
        assert body["rejectionSummary"]

    def test_model_not_configured_is_model_unavailable_503(self) -> None:
        result_set, bundle = _report_run()
        client = _rec_client(None, gemini_key=None, gemini_model=None)
        resp = client.post(
            "/reports", json=_report_body(REPORT_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "model_unavailable"
        assert set(body) == {"code", "message", "details"}

    def test_empty_run_id_is_422_bad_request(self) -> None:
        result_set, bundle = _report_run()
        good = _report_draft_json(result_set, bundle)
        client = _rec_client(lambda: _ScriptedModel([good]))
        resp = client.post(
            "/reports", json=_report_body("", result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 422
        assert resp.json()["code"] == "bad_request"


# --------------------------------------------------------------------------- #
# Story 5.6: fail-closed budget envelopes (503) + /interpretation/health        #
# --------------------------------------------------------------------------- #


def _budget_client(*, token_ceiling=None, timeout_seconds=600.0) -> TestClient:
    # A configured client whose interpretation ceiling/timeout are set to trip.
    # The scripted model is never actually reached when the budget trips at the
    # pre-attempt guard, so its output is irrelevant.
    settings = Settings(
        service_secret=TEST_SECRET,
        gemini_api_key="k",
        gemini_model_id="m",
        interpretation_token_ceiling=token_ceiling,
        interpretation_timeout_seconds=timeout_seconds,
    )
    return TestClient(
        create_app(settings=settings, build_model=lambda: _ScriptedModel(["{}"]))
    )


class TestBudgetEnvelopes:
    def test_recommendations_cost_ceiling_is_503_envelope(self) -> None:
        # A zero token ceiling trips the fail-closed guard before any model turn.
        result_set, bundle = _rec_run()
        client = _budget_client(token_ceiling=0)
        resp = client.post(
            "/recommendations", json=_rec_body(REC_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "cost_ceiling_exceeded"
        assert set(body) == {"code", "message", "details"}

    def test_recommendations_timeout_is_503_envelope(self) -> None:
        # A zero timeout makes the deadline already reached at the first guard.
        result_set, bundle = _rec_run()
        client = _budget_client(timeout_seconds=0.0)
        resp = client.post(
            "/recommendations", json=_rec_body(REC_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "interpretation_timeout"
        assert set(body) == {"code", "message", "details"}

    def test_reports_cost_ceiling_is_503_envelope(self) -> None:
        result_set, bundle = _report_run()
        client = _budget_client(token_ceiling=0)
        resp = client.post(
            "/reports", json=_report_body(REPORT_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        assert resp.json()["code"] == "cost_ceiling_exceeded"

    def test_reports_timeout_is_503_envelope(self) -> None:
        result_set, bundle = _report_run()
        client = _budget_client(timeout_seconds=0.0)
        resp = client.post(
            "/reports", json=_report_body(REPORT_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        assert resp.json()["code"] == "interpretation_timeout"


class TestInterpretationHealth:
    def test_health_ok_when_model_builds(self) -> None:
        client = _rec_client(lambda: _ScriptedModel(["{}"]))
        resp = client.get("/interpretation/health", headers=AUTH)
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}

    def test_health_is_503_model_unavailable_when_unconfigured(self) -> None:
        # No injected model + no key → build_gemini_model raises → 503 envelope.
        client = _rec_client(None, gemini_key=None, gemini_model=None)
        resp = client.get("/interpretation/health", headers=AUTH)
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "model_unavailable"
        assert set(body) == {"code", "message", "details"}

    def test_health_requires_auth(self) -> None:
        client = _rec_client(lambda: _ScriptedModel(["{}"]))
        resp = client.get("/interpretation/health")
        assert resp.status_code == 401
        assert resp.json()["code"] == "unauthorized"

    def test_health_is_503_when_model_configured_but_unreachable(self) -> None:
        # Review F17: a configured-but-unreachable model must NOT report healthy.
        # The probe issues a real model-plane call → ModelProviderError → 503
        # model_unavailable, so recovery does not falsely clear Engine-Only Mode.
        client = _rec_client(lambda: _RaisingModel())
        resp = client.get("/interpretation/health", headers=AUTH)
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "model_unavailable"
        assert set(body) == {"code", "message", "details"}


class TestRuntimeModelOutage:
    def test_recommendations_runtime_outage_is_503_model_unavailable(self) -> None:
        # Review F16: a LIVE outage (not just misconfig) fails closed into the same
        # 503 model_unavailable so callEngine → engine.model_unavailable → Engine-Only.
        result_set, bundle = _rec_run()
        client = _rec_client(lambda: _RaisingModel())
        resp = client.post(
            "/recommendations", json=_rec_body(REC_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "model_unavailable"

    def test_runtime_outage_after_completed_attempt_carries_transcripts(self) -> None:
        # Review F6: attempt 1 completes (gate-rejected); the 503 carries its
        # transcript in details.attempts so the LLM interaction is still audited.
        result_set, bundle = _rec_run()
        bad = _draft_json(result_set, bundle, drop_first=True)  # missing coverage → rejected
        client = _rec_client(lambda: _RaisingModel(pre=[bad]))
        resp = client.post(
            "/recommendations", json=_rec_body(REC_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        body = resp.json()
        assert body["code"] == "model_unavailable"
        assert body["details"] is not None
        assert len(body["details"]["attempts"]) == 1

    def test_reports_runtime_outage_is_503_model_unavailable(self) -> None:
        result_set, bundle = _report_run()
        client = _rec_client(lambda: _RaisingModel())
        resp = client.post(
            "/reports", json=_report_body(REPORT_RUN_ID, result_set, bundle), headers=AUTH
        )
        assert resp.status_code == 503
        assert resp.json()["code"] == "model_unavailable"
