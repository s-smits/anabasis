/**
 * The one owner of where a candidate bundle's files sit inside a workspace, snapshot or product
 * tree: `correctness-model/…` for the evaluation half, `agent/…` for the solve half.
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
