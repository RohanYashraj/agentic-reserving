"""validate_triangle tests (Story 2.1, Tasks 2 & 5).

Example-based edge tests plus Hypothesis property tests: generated valid
triangles always pass; generated violations (shape, paid monotonicity,
missing cells) are always detected at the exact coordinates.
"""

from itertools import accumulate

from hypothesis import given
from hypothesis import strategies as st

from reserving_engine import (
    Triangle,
    ValidationFinding,
    ValidationReport,
    triangle_hash,
    validate_triangle,
)

# --- strategies -------------------------------------------------------------

# Strictly positive: a development column whose observed cumulative total is
# zero has an undefined age-to-age factor and is rejected by validate_triangle
# (degenerate_factor), so a *domain-valid* generated Triangle must avoid it.
# Zero cells / zero movement are exercised by the example-based tests below.
amounts = st.floats(min_value=1.0, max_value=1e9, allow_nan=False, allow_infinity=False)


@st.composite
def valid_triangles(draw, kind=None, min_origins=1, min_devs=1, full_only=False):
    """A structurally and domain-valid Triangle.

    Full rectangle, or a stepped triangle with non-increasing observed
    prefix lengths (oldest origin longest). Paid rows are cumulative sums
    of non-negative increments, so they are non-decreasing.
    """
    k = kind if kind is not None else draw(st.sampled_from(["paid", "incurred"]))
    n_origin = draw(st.integers(min_origins, 8))
    n_dev = draw(st.integers(min_devs, 8))
    if full_only or draw(st.booleans()):
        lengths = [n_dev] * n_origin
    else:
        lengths = [n_dev]
        for _ in range(1, n_origin):
            lengths.append(draw(st.integers(1, lengths[-1])))
    rows = []
    for length in lengths:
        values = draw(st.lists(amounts, min_size=length, max_size=length))
        if k == "paid":
            values = list(accumulate(values))
        rows.append(tuple(values) + (None,) * (n_dev - length))
    return Triangle(
        kind=k,
        origin_periods=tuple(f"O{i}" for i in range(n_origin)),
        development_periods=tuple(f"D{j}" for j in range(n_dev)),
        cells=tuple(rows),
    )


def replace_cell(triangle: Triangle, i: int, j: int, value: float | None) -> Triangle:
    cells = [list(row) for row in triangle.cells]
    cells[i][j] = value
    return Triangle(
        kind=triangle.kind,
        origin_periods=triangle.origin_periods,
        development_periods=triangle.development_periods,
        cells=tuple(tuple(row) for row in cells),
    )


# --- properties: valid triangles always pass --------------------------------


@given(valid_triangles())
def test_valid_triangles_pass(t):
    report = validate_triangle(t)
    assert report.valid is True
    assert report.findings == ()


# --- properties: violations detected at exact coordinates -------------------


@given(valid_triangles(kind="paid", min_devs=2, full_only=True), st.data())
def test_interior_hole_reported_as_missing_cell(t, data):
    j = data.draw(st.integers(0, len(t.development_periods) - 2))
    mutated = replace_cell(t, 0, j, None)
    report = validate_triangle(mutated)
    assert report.valid is False
    assert len(report.findings) == 1
    f = report.findings[0]
    assert isinstance(f, ValidationFinding)
    assert (f.origin, f.dev, f.code) == (
        t.origin_periods[0],
        t.development_periods[j],
        "missing_cell",
    )


@given(valid_triangles(kind="paid", min_devs=2, full_only=True), st.data())
def test_paid_decrease_reported_at_decreasing_cell(t, data):
    i = data.draw(st.integers(0, len(t.origin_periods) - 1))
    j = data.draw(st.integers(1, len(t.development_periods) - 1))
    mutated = replace_cell(t, i, j, t.cells[i][j - 1] - 1.0)
    report = validate_triangle(mutated)
    assert report.valid is False
    assert len(report.findings) == 1
    f = report.findings[0]
    assert (f.origin, f.dev, f.code) == (
        t.origin_periods[i],
        t.development_periods[j],
        "paid_monotonicity",
    )


@given(st.data())
def test_extended_newer_prefix_reported_as_shape(data):
    # Constant observed length L < n_dev across rows is valid; extending a
    # newer row's prefix past its older neighbour's must flag shape at the
    # first offending cell.
    n_origin = data.draw(st.integers(2, 6))
    n_dev = data.draw(st.integers(2, 8))
    length = data.draw(st.integers(1, n_dev - 1))
    i = data.draw(st.integers(1, n_origin - 1))
    rows = []
    for _ in range(n_origin):
        values = list(accumulate(data.draw(st.lists(amounts, min_size=length, max_size=length))))
        rows.append(tuple(values) + (None,) * (n_dev - length))
    t = Triangle(
        kind="paid",
        origin_periods=tuple(f"O{r}" for r in range(n_origin)),
        development_periods=tuple(f"D{c}" for c in range(n_dev)),
        cells=tuple(rows),
    )
    assert validate_triangle(t).valid is True
    # extend row i by one observed cell, keeping paid monotonicity
    mutated = replace_cell(t, i, length, t.cells[i][length - 1] + 1.0)
    report = validate_triangle(mutated)
    assert report.valid is False
    assert len(report.findings) == 1
    f = report.findings[0]
    assert (f.origin, f.dev, f.code) == (
        t.origin_periods[i],
        t.development_periods[length],
        "shape",
    )


@given(valid_triangles(kind="incurred", min_devs=2, full_only=True), st.data())
def test_incurred_decrease_is_not_flagged(t, data):
    # OQ-6: incurred can legitimately decrease (case-reserve releases).
    # Halve rather than subtract a flat amount so the decreased cell stays
    # strictly positive — a zeroed cell would be a legitimate but separate
    # degenerate-column rejection, not the monotonicity behaviour under test.
    i = data.draw(st.integers(0, len(t.origin_periods) - 1))
    j = data.draw(st.integers(1, len(t.development_periods) - 1))
    mutated = replace_cell(t, i, j, t.cells[i][j - 1] / 2.0)
    report = validate_triangle(mutated)
    assert report.valid is True
    assert report.findings == ()


@given(valid_triangles(kind="paid", min_origins=2, min_devs=3, full_only=True))
def test_multiple_defects_all_collected(t):
    # Hole in row 0 plus a monotonicity break in row 1: both must come back
    # in one report (collect-all, never fail-fast).
    last = len(t.development_periods) - 1
    mutated = replace_cell(t, 0, 1, None)
    mutated = replace_cell(mutated, 1, last, mutated.cells[1][last - 1] - 1.0)
    report = validate_triangle(mutated)
    assert report.valid is False
    coords = {(f.origin, f.dev, f.code) for f in report.findings}
    assert (t.origin_periods[0], t.development_periods[1], "missing_cell") in coords
    assert (t.origin_periods[1], t.development_periods[last], "paid_monotonicity") in coords
    assert len(report.findings) == 2


# --- property: hash determinism (AC 4) --------------------------------------


@given(valid_triangles())
def test_hash_deterministic_across_equal_instances(t):
    assert triangle_hash(t) == triangle_hash(Triangle(**t.model_dump()))


# --- example-based edge tests ------------------------------------------------


def paid(cells, origins=None, devs=None):
    n_origin, n_dev = len(cells), len(cells[0])
    return Triangle(
        kind="paid",
        origin_periods=origins or tuple(f"O{i}" for i in range(n_origin)),
        development_periods=devs or tuple(f"D{j}" for j in range(n_dev)),
        cells=tuple(tuple(row) for row in cells),
    )


def test_one_by_one_triangle_valid():
    report = validate_triangle(paid([[42.0]]))
    assert report.valid is True and report.findings == ()


def test_single_origin_full_row_valid():
    report = validate_triangle(paid([[10.0, 20.0, 30.0]]))
    assert report.valid is True


def test_equal_adjacent_paid_values_valid():
    # Only *strict* decrease is a defect; a quarter with zero paid movement
    # is legitimate.
    report = validate_triangle(paid([[10.0, 10.0, 10.0]]))
    assert report.valid is True


def test_full_rectangle_valid():
    report = validate_triangle(paid([[1.0, 2.0], [3.0, 4.0]]))
    assert report.valid is True


def test_zero_valued_cell_is_not_missing():
    # A genuine 0.0 cell is a value — never confuse falsy with missing. The
    # older origin carries a positive column total, so no degenerate rejection.
    report = validate_triangle(paid([[100.0, 200.0], [0.0, None]]))
    assert report.valid is True


def test_zero_development_column_is_degenerate():
    # An all-zero cumulative column across observed origins has an undefined
    # age-to-age factor; reject it in validation (422) rather than let a
    # non-finite factor surface as an uncaught 500 (decision 2026-07-18).
    report = validate_triangle(paid([[0.0, 5.0], [0.0, None]]))
    assert report.valid is False
    assert [f.code for f in report.findings] == ["degenerate_factor"]
    assert (report.findings[0].origin, report.findings[0].dev) == ("O0", "D0")


def test_empty_row_is_shape_finding():
    report = validate_triangle(paid([[1.0, 2.0], [None, None]]))
    assert report.valid is False
    assert len(report.findings) == 1
    f = report.findings[0]
    assert (f.origin, f.dev, f.code) == ("O1", "D0", "shape")


def test_findings_carry_labels_not_indices():
    t = paid(
        [[5.0, 6.0], [7.0, 3.0]],
        origins=("2021", "2022"),
        devs=("12", "24"),
    )
    report = validate_triangle(t)
    f = report.findings[0]
    assert f.origin == "2022" and f.dev == "24"
    assert f.reason  # human-readable, non-empty


def test_report_json_round_trip():
    report = validate_triangle(paid([[5.0, 6.0], [7.0, 3.0]]))
    restored = ValidationReport.model_validate_json(report.model_dump_json())
    assert restored == report
