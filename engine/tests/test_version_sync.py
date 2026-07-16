"""ENGINE_VERSION lockstep test (Story 2.2, Task 1.1).

The pure core cannot read pyproject.toml (AD-2), so the semver lives as
a constant. This test (tests may do I/O) makes the lockstep mechanical:
bump one without the other and the suite goes red.
"""

import tomllib
from pathlib import Path

from reserving_engine import ENGINE_VERSION

PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def test_engine_version_matches_pyproject():
    with PYPROJECT.open("rb") as f:
        pyproject = tomllib.load(f)
    assert ENGINE_VERSION == pyproject["project"]["version"]
