"""Scaffold smoke test: the three engine packages import cleanly."""

import copilot_agent
import engine_service
import reserving_engine


def test_packages_importable() -> None:
    assert reserving_engine is not None
    assert engine_service is not None
    assert copilot_agent is not None
