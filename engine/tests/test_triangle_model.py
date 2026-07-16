"""Structural tests for the Triangle Pydantic model (Story 2.1, Task 1).

Container-level malformation (ragged rows, duplicate/empty labels, NaN/Inf)
raises pydantic.ValidationError at construction; domain defects are the
concern of validate_triangle, not this model.
"""

import math

import pytest
from pydantic import ValidationError

from reserving_engine import Triangle


def make_triangle(**overrides):
    """A small valid 2x3 paid triangle; override any field."""
    kwargs = {
        "kind": "paid",
        "origin_periods": ("2021", "2022"),
        "development_periods": ("12", "24", "36"),
        "cells": (
            (100.0, 150.0, 175.0),
            (110.0, 160.0, None),
        ),
    }
    kwargs.update(overrides)
    return Triangle(**kwargs)


class TestConstruction:
    def test_valid_triangle_constructs(self):
        t = make_triangle()
        assert t.kind == "paid"
        assert t.origin_periods == ("2021", "2022")
        assert t.development_periods == ("12", "24", "36")
        assert t.cells[1][2] is None

    def test_incurred_kind_accepted(self):
        assert make_triangle(kind="incurred").kind == "incurred"

    def test_lists_coerced_to_tuples(self):
        t = Triangle(
            kind="paid",
            origin_periods=["2021"],
            development_periods=["12"],
            cells=[[100.0]],
        )
        assert isinstance(t.origin_periods, tuple)
        assert isinstance(t.cells, tuple)
        assert isinstance(t.cells[0], tuple)

    def test_zero_valued_cell_is_a_value_not_missing(self):
        # A genuine 0.0 cell must survive as a float, never treated as None.
        t = make_triangle(cells=((0.0, 150.0, 175.0), (110.0, 160.0, None)))
        assert t.cells[0][0] == 0.0
        assert t.cells[0][0] is not None


class TestImmutability:
    def test_model_is_frozen(self):
        t = make_triangle()
        with pytest.raises(ValidationError):
            t.kind = "incurred"


class TestStructuralRejection:
    def test_invalid_kind_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(kind="reported")

    def test_empty_origin_periods_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(origin_periods=(), cells=())

    def test_empty_development_periods_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(development_periods=(), cells=((), ()))

    def test_duplicate_origin_labels_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(origin_periods=("2021", "2021"))

    def test_duplicate_development_labels_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(development_periods=("12", "12", "36"))

    def test_empty_string_label_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(origin_periods=("2021", ""))

    def test_row_count_mismatch_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(cells=((100.0, 150.0, 175.0),))

    def test_ragged_row_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(cells=((100.0, 150.0, 175.0), (110.0, 160.0)))

    def test_nan_cell_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(cells=((math.nan, 150.0, 175.0), (110.0, 160.0, None)))

    def test_infinity_cell_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(cells=((math.inf, 150.0, 175.0), (110.0, 160.0, None)))

    def test_negative_infinity_cell_rejected(self):
        with pytest.raises(ValidationError):
            make_triangle(cells=((100.0, -math.inf, 175.0), (110.0, 160.0, None)))
