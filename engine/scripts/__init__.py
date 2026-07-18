"""Build-time tools for the engine (NOT part of the pure core).

``scripts`` is a build/CI tool package, not a ``reserving_engine``
submodule: it may do file I/O and is exempt from the AD-2 purity
contract (which scopes ``source_modules = ["reserving_engine"]``). It is
deliberately NOT an import-linter root package. Dependencies point
downward only: ``scripts`` → ``reserving_engine`` (never
``engine_service``/``copilot_agent``).
"""
