/**
 * The one owner of where a candidate bundle's files sit inside a workspace, snapshot or product
 * tree: `correctness-model/…` for the evaluation half, `agent/…` for the solve half.
 *
 * Spelled inline, these names fall two or three to a file, below `no-repeated-string-literal`'s
 * four-per-file floor. `tree-identity`, which reports a name spelled in more than one file as
 * `no-unowned-identity`, is the scan that reads across files instead, and this module is the
 * owner it asks for.
 *
 * Two names here are bare, with no half in front of them, because their readers join them onto a
 * directory the caller holds rather than onto a bundle: `EVALUATOR_FILE` sits at the root of a
 * task's check program (`task.checks`, `src/kernel/task.ts`), which inside a pack is the
 * evaluation half and inside a staged exam is the model directory; `GUIDE_FILE` is the name pi's
 * project context gives the guide, with `AGENT_DIR` in front of it on disk. `TOOL_TREE_DIR` is bare
 * for the same reason: it sits at the root of a harness.
 *
 * Tests keep spelling the literals, and no file under `test/` imports this module. A fixture that
 * built its tree from the same constant as the code under test would follow a rename and pass
 * either way, so the layout would stop being checked by anything at the moment it changed.
 */

/** The evaluation half's directory, as a candidate path prefix. */
export const CORRECTNESS_MODEL_DIR = "correctness-model/";

/** The solve half's directory, as a candidate path prefix. */
export const AGENT_DIR = "agent/";

/** The check program's entry, at the root of its directory: it exports the checks as `checks`. */
export const EVALUATOR_FILE = "evaluator.ts";

/** The guide, under `AGENT_DIR` on disk and by this name in the solver's system prompt. It is not
 *  `AGENTS.md`, the name a solver's backend may load by itself, so that the guide reaches the solver
 *  once, through its prompt, and never beside a file of the backend's own (the operator's choice). */
export const GUIDE_FILE = "BUILT_AGENTS.md";

/** The check program's declaration, at the root of its directory: the domain plan and its public rule
 *  decisions. A bundle holds it under `correctness-model/`, `BRIEF_FILE`. */
export const CHECK_BRIEF = "brief.json";
export const BRIEF_FILE = `correctness-model/${CHECK_BRIEF}`;

/** Public task inputs beside their hidden expectations. */
export const TASKS_FILE = "correctness-model/tasks.json";

/** The task-bound accept and reject artifacts that calibrate the checks. */
export const CONTROLS_FILE = "correctness-model/controls.json";

/** The harness's selection of pi's coding tools, with a tools list that stays empty. */
export const TOOLS_SPEC_FILE = "agent/tools-spec.json";

/** The module of tools of its own that an older harness held (`src/harness/open.ts`). No opener
 *  reads it; a harness that still holds the file has it listed by its readers. */
export const GENERATED_TOOLS_FILE = "agent/tools.ts";

/** A harness's installed programs, at its root: the tree the solver's shell finds them in. */
export const TOOL_TREE_DIR = ".toolchain";

/** The bytecode caches Python writes beside a program it runs. Python reads a file in one only while
 *  the source beside it is there, and checks it against that source unless the file was compiled
 *  as unchecked, so a cache holds nothing the source does not, and a harness whose programs ran
 *  once is the harness it was before; counting the caches would read a state that differs from the
 *  one practised by them alone as never practised. A `.pyc` outside `__pycache__` is code
 *  Python imports with no source beside it, and stays in. */
export const BYTECODE = /(^|\/)__pycache__(\/|$)/;
