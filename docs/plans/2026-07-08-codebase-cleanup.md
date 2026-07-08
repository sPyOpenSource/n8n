# Codebase Cleanup Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Remove dead code and obsolete files across the entire codebase.

**Architecture:** Run automated dead-code detectors first, manually verify each finding, then remove confirmed dead code in small, test-verified commits. Keep a whitelist for deliberate dynamic entry points and repeat validation after each cleanup batch.

**Tech Stack:** Python, `vulture`, `pyflakes`, `autoflake`, `pytest`.

---

### Task 1: Install cleanup tools

**Objective:** Make sure the local environment can run the dead-code checks.

**Files:**
- Modify: `requirements.txt` only if the tools should be tracked there

**Step 1: Install tools**

Run: `pip install vulture pyflakes autoflake`

**Step 2: Verify tool availability**

Run: `vulture --version && pyflakes --version && autoflake --version`

**Step 3: Commit if requirements changed**

Run: `git add requirements.txt && git commit -m "chore: add cleanup tools to requirements"`

---

### Task 2: Run automated discovery

**Objective:** Produce a full report of likely dead code.

**Files:**
- Create: `cleanup-report.txt`
- Create: `vulture_report.txt`
- Create: `pyflakes_report.txt`

**Step 1: Run vulture**

Run: `vulture --min-confidence 80 --exclude tests/,examples/,docs/,.pytest_cache/,.git/ . > vulture_report.txt`

**Step 2: Run pyflakes**

Run: `pyflakes . > pyflakes_report.txt`

**Step 3: Consolidate findings**

Merge both reports into `cleanup-report.txt`, grouped by file path and categorized as `unused-import`, `unused-function`, `unused-class`, `unused-variable`, or `undefined-name`.

**Step 4: Commit the reports if useful for review**

Run: `git add cleanup-report.txt vulture_report.txt pyflakes_report.txt && git commit -m "chore: generate dead code reports"`

---

### Task 3: Verify findings in `server/`

**Objective:** Confirm which findings in `server/` are safe to remove.

**Files:**
- Review: `cleanup-report.txt`
- Modify: any `server/**/*.py` files that contain confirmed dead code

**Step 1: Review entries**

Read all `cleanup-report.txt` entries under `server/`.

**Step 2: Classify each entry**

Mark each finding as `CONFIRMED_DEAD`, `FALSE_POSITIVE`, or `NEEDS_INVESTIGATION`.

**Step 3: Remove confirmed dead code**

Delete confirmed unused imports, functions, classes, and variables.

**Step 4: Verify**

Run: `pytest tests/`

**Step 5: Commit**

Run: `git add server/ && git commit -m "cleanup: remove dead code from server/ module"`

---

### Task 4: Verify findings in `copilot/`

**Objective:** Confirm which findings in `copilot/` are safe to remove.

**Files:**
- Review: `cleanup-report.txt`
- Modify: any `copilot/**/*.py` files that contain confirmed dead code

**Step 1: Review entries**

Read all `cleanup-report.txt` entries under `copilot/`.

**Step 2: Classify each entry**

Mark each finding as `CONFIRMED_DEAD`, `FALSE_POSITIVE`, or `NEEDS_INVESTIGATION`.

**Step 3: Remove confirmed dead code**

Delete confirmed unused imports, functions, classes, and variables.

**Step 4: Verify**

Run: `pytest tests/`

**Step 5: Commit**

Run: `git add copilot/ && git commit -m "cleanup: remove dead code from copilot/ module"`

---

### Task 5: Verify findings in the remaining files

**Objective:** Clean up the root package and any other remaining Python files.

**Files:**
- Review: `cleanup-report.txt`
- Modify: root-level files such as `app.py` and any remaining Python modules

**Step 1: Review remaining entries**

Read the remaining `cleanup-report.txt` findings outside `server/` and `copilot/`.

**Step 2: Remove confirmed dead code**

Delete confirmed unused code and use `autoflake` for unused imports where appropriate.

**Step 3: Verify**

Run: `pytest tests/`

**Step 4: Commit**

Run: `git add . && git commit -m "cleanup: remove dead code from remaining modules"`

---

### Task 6: Final validation

**Objective:** Confirm the codebase is clean and stable after removals.

**Files:**
- Remove: `cleanup-report.txt`, `vulture_report.txt`, `pyflakes_report.txt` if they were only temporary

**Step 1: Final dead-code scan**

Run: `vulture --min-confidence 80 --exclude tests/,examples/,docs/,.pytest_cache/,.git/ .`

**Step 2: Final import/name scan**

Run: `pyflakes .`

**Step 3: Final test run**

Run: `pytest tests/`

**Step 4: Commit temporary-file cleanup**

Run: `git add . && git commit -m "chore: remove temporary cleanup reports"`
