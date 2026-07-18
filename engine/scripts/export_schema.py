"""Export the AD-10 cross-runtime JSON Schema from the Pydantic models.

Single source of truth: ``ResultSet`` and ``DiagnosticsBundle`` in
``reserving_engine``. This build tool emits their JSON Schema (camelCase,
``by_alias=True``) to the repo-root ``schemas/`` directory, the neutral
cross-runtime home both planes read. ``tests/test_schema_contract.py``
byte-compares the committed files against a fresh export (Link 1 of the
contract chain); the Node drift check diffs the Convex validators against
these same files (Link 2).

Run from ``engine/``::

    uv run python scripts/export_schema.py

Never hand-edit the emitted files — they are generated artifacts.
"""

import json
from pathlib import Path

from reserving_engine import DiagnosticsBundle, ResultSet

# scripts/export_schema.py → parents[2] is the repo root.
SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "schemas"

# model → output filename (kebab reads naturally on the product plane).
_TARGETS = {
    ResultSet: "resultset.schema.json",
    DiagnosticsBundle: "diagnostics-bundle.schema.json",
}


def _dumps(schema: dict) -> str:
    """Deterministic JSON bytes: sorted keys, fixed indent, trailing newline.

    The byte-equality guard depends on this being stable and identical
    between the in-memory build and what is written to disk.
    """
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def build_schemas() -> dict[str, str]:
    """Return ``{filename: json_str}`` for every exported contract model.

    ``by_alias=True`` is mandatory: the wire is camelCase, matching the
    Convex validators the drift check compares against.
    """
    return {
        filename: _dumps(model.model_json_schema(by_alias=True))
        for model, filename in _TARGETS.items()
    }


def main() -> None:
    SCHEMAS_DIR.mkdir(parents=True, exist_ok=True)
    for filename, content in build_schemas().items():
        target = SCHEMAS_DIR / filename
        target.write_text(content, encoding="utf-8")
        print(f"wrote {target}")


if __name__ == "__main__":
    main()
