"""Link 1 of the AD-10 contract chain: Pydantic ⇒ committed JSON Schema.

Byte-equality guard, the schema analogue of ``test_version_sync.py``:
regenerate the JSON Schema in memory and assert it matches the
checked-in ``schemas/*.json`` exactly. Change a ResultSet or
DiagnosticsBundle field without re-running ``scripts/export_schema.py``
and this test goes red — the committed contract can never silently drift
from the models. Tests may do I/O (unlike the pure core).
"""

import json

import pytest

from scripts.export_schema import SCHEMAS_DIR, build_schemas


_SCHEMAS = build_schemas()


@pytest.mark.parametrize("filename, content", list(_SCHEMAS.items()), ids=list(_SCHEMAS))
def test_committed_schema_matches_models(filename: str, content: str):
    """The checked-in schema file is byte-identical to a fresh export."""
    committed = (SCHEMAS_DIR / filename).read_text(encoding="utf-8")
    assert committed == content, (
        f"{filename} is stale — re-run `uv run python -m scripts.export_schema` "
        "from engine/ and commit the result"
    )


@pytest.mark.parametrize("filename", list(_SCHEMAS), ids=list(_SCHEMAS))
def test_committed_schema_is_versioned_json(filename: str):
    """Cheap sanity guard: the file parses and carries schemaVersion 1.0.0."""
    schema = json.loads((SCHEMAS_DIR / filename).read_text(encoding="utf-8"))
    assert schema["properties"]["schemaVersion"]["default"] == "1.0.0"
