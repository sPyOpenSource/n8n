# Design Spec: Codebase Cleanup (Dead Code Removal)
Date: 2026-07-08
Status: Approved

## Goal
Remove dead code and files across the entire codebase to improve maintainability and reduce noise.

## Scope
- **Target:** Entire codebase (all Python files).
- **Objectives:** Delete unused imports, dead functions, unused classes, obsolete variables, and unused files.
- **Constraints:** No specific constraints; however, manual verification is required to avoid deleting dynamic entry points.

## Approach: Automated Scan → Manual Review → Incremental Cleanup

### 1. Tooling & Configuration
We will use a combination of tools to maximize detection while minimizing false positives.

- **vulture**: Primary tool for finding dead code (functions, classes, variables).
  - Confidence threshold: 80%
  - Exclusions: `tests/`, `examples/`, `docs/`, `.pytest_cache/`, `.git/`
- **pyflakes**: used to identify undefined names and unused imports.
- **autoflake**: Used for final automatic removal of imports and variables *only* after manual verification.

### 2. Cleanup Process

#### Phase 1: Discovery (Automated)
1. Run `vulture --min-confidence 80 --exclude tests/,examples/,docs/,.pytest_cache/,.git/ .`
2. Run `pyflakes .`
3. Consolidate all findings into a temporary `cleanup-report.txt` file.
4. Categorize findings into: `unused-import`, `unused-function`, `unused-class`, `unused-variable`, `undefined-name`.

#### Phase 2: Verification (Manual)
1. Review each item in `cleanup-report.txt`.
2. Mark each item as:
   - `CONFIRMED_DEAD`: Safe to remove.
   - `FALSE_POSITIVE`: Used dynamically (e.g., plugin registration, CLI entry points).
   - `NEEDS_INVESTIGATION`: Unclear usage.
3. Maintain a `vulture` whitelist config to avoid future false positives for the same items.

#### Phase 3: Execution (Incremental)
1. Group confirmed removals by directory/module.
2. For each group:
   - Remove dead code.
   - Run tests to verify no regression.
   - Commit changes with message: `cleanup: remove dead code from <module> (<count> items)`.
3. Limit commits to ~50 lines changed for reviewability.

#### Phase 4: Final Validation
1. Run the full test suite.
2. Run `pyflakes` again to ensure no new undefined name errors were introduced.
3. Run `vulture` one last time to confirm significant noise reduction.

## Success Criteria
- No "dead" code reported by `vulture` (except whitelisted items).
- No unused imports reported by `pyflakes`.
- All existing tests pass.
- No runtime regressions.
