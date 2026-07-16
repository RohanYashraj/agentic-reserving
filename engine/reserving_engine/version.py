"""Engine semver constant.

Pure-core contract (AD-2): the engine cannot read pyproject.toml (no
file access), so the version recorded in Lineage lives here as a plain
constant. It MUST be bumped in lockstep with ``[project] version`` in
``engine/pyproject.toml`` — ``tests/test_version_sync.py`` enforces the
lockstep mechanically.
"""

ENGINE_VERSION = "0.1.0"
