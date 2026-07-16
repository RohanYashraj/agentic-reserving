"""Canonical Triangle JSON + hash tests (Story 2.1, Task 3).

The canonical serialization is a permanent cross-runtime contract
(AD-10/AD-11): Lineage hashes recorded now must re-derive forever. The
pinned known-answer vector below was cross-verified independently with
`shasum -a 256` over the exact canonical string before pinning — if this
test goes red, the contract broke; fix the code, never the vector.
"""

import hashlib
import json

from reserving_engine import Triangle, canonical_triangle_json, triangle_hash


def make_triangle(**overrides):
    kwargs = {
        "kind": "paid",
        "origin_periods": ("2021", "2022"),
        "development_periods": ("12", "24"),
        "cells": ((100.0, 150.0), (120.0, None)),
    }
    kwargs.update(overrides)
    return Triangle(**kwargs)


# --- pinned known-answer vector (permanent contract) -------------------------

PINNED_CANONICAL_JSON = (
    '{"cells":[[100.0,150.0],[120.0,null]],'
    '"developmentPeriods":["12","24"],'
    '"kind":"paid",'
    '"originPeriods":["2021","2022"]}'
)
# shasum -a 256 over PINNED_CANONICAL_JSON, verified independently of the
# implementation on 2026-07-16:
PINNED_HASH = "651a7c3719e778aa0b2ad2269f9866f4247c42b2f6c2cde45fd3db67f7b21a36"


def test_pinned_canonical_json_vector():
    assert canonical_triangle_json(make_triangle()) == PINNED_CANONICAL_JSON


def test_pinned_hash_vector():
    assert triangle_hash(make_triangle()) == PINNED_HASH


# --- canonical form properties ------------------------------------------------


def test_canonical_json_is_valid_json_with_camel_case_keys():
    parsed = json.loads(canonical_triangle_json(make_triangle()))
    assert set(parsed) == {"kind", "originPeriods", "developmentPeriods", "cells"}
    assert parsed["cells"][1][1] is None  # missing cell serializes as null


def test_hash_is_sha256_of_utf8_canonical_json():
    t = make_triangle()
    expected = hashlib.sha256(canonical_triangle_json(t).encode("utf-8")).hexdigest()
    assert triangle_hash(t) == expected
    assert len(triangle_hash(t)) == 64
    assert triangle_hash(t) == triangle_hash(t).lower()


# --- determinism ---------------------------------------------------------------


def test_deterministic_across_repeated_calls():
    t = make_triangle()
    assert triangle_hash(t) == triangle_hash(t)


def test_deterministic_across_structurally_equal_instances():
    assert triangle_hash(make_triangle()) == triangle_hash(make_triangle())


# --- sensitivity: any semantic change flips the hash ----------------------------


def test_kind_change_flips_hash():
    assert triangle_hash(make_triangle()) != triangle_hash(make_triangle(kind="incurred"))


def test_origin_label_change_flips_hash():
    other = make_triangle(origin_periods=("2021", "2023"))
    assert triangle_hash(make_triangle()) != triangle_hash(other)


def test_development_label_change_flips_hash():
    other = make_triangle(development_periods=("12", "36"))
    assert triangle_hash(make_triangle()) != triangle_hash(other)


def test_cell_value_change_flips_hash():
    other = make_triangle(cells=((100.0, 150.5), (120.0, None)))
    assert triangle_hash(make_triangle()) != triangle_hash(other)


def test_none_to_value_flips_hash():
    other = make_triangle(cells=((100.0, 150.0), (120.0, 130.0)))
    assert triangle_hash(make_triangle()) != triangle_hash(other)


def test_value_to_none_flips_hash():
    other = make_triangle(cells=((100.0, None), (120.0, None)))
    assert triangle_hash(make_triangle()) != triangle_hash(other)
