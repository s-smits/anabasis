/**
 * The one owner of where a candidate bundle's files sit inside a workspace, snapshot or product
 * tree: `correctness-model/…` for the evaluation half, `agent/…` for the solve half.
 *
 * These six names were spelled inline at 68 sites in 23 modules, two or three to a file, which is
 * below `no-repeated-string-literal`'s four-per-file floor at every one of them — so that rule saw
 * a clean tree while the layout was typed out sixty-eight times. `tree-identity`, which reports a
 * name spelled in more than one file as `identity-without-owner`, is the scan that reads across
 * files instead, and this module is the repair it asks for. The two directory prefixes joined them
 * when the same scan found `correctness-model/` spelled as a candidate prefix in two modules.
 *
 * Two names here are bare, with no half in front of them, because their readers join them onto a
 * directory the caller holds rather than onto a bundle: `EVALUATOR_FILE` sits at the root of a
 * task's check program (`task.checks`, `src/kernel/task.ts`), which inside a pack is the
 * evaluation half and inside a staged exam is the model directory; `GUIDE_FILE` is the name pi's
 * project context gives the guide, with `AGENT_DIR` in front of it on disk. Each was spelled in
 * three files on 10 October, below the per-file floor in every one of them, and
 * `identity-without-owner` reported both.
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

/** The guide, under `AGENT_DIR` on disk and by this name in the solver's system prompt. */
export const GUIDE_FILE = "BUILT_AGENTS.md";

/** The domain plan and public rule decisions the Builder writes first. */
export const BRIEF_FILE = "correctness-model/brief.json";

/** Public task inputs beside their hidden expectations. */
export const TASKS_FILE = "correctness-model/tasks.json";

/** The task-bound accept and reject artifacts that calibrate the checks. */
export const CONTROLS_FILE = "correctness-model/controls.json";

/** The declared tool contract the solver's roster is derived from. */
export const TOOLS_SPEC_FILE = "agent/tools-spec.json";

/** The generated tool implementations the Built Harness calls. */
export const GENERATED_TOOLS_FILE = "agent/tools.ts";
