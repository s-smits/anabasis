/**
 * The one owner of where a candidate bundle's files sit inside a workspace, snapshot or product
 * tree: `correctness-model/…` for the evaluation half, `agent/…` for the solve half.
 *
 * These six names were spelled inline at 68 sites in 23 modules, two or three to a file, which is
 * below `ana/no-repeated-string-literal`'s four-per-file floor at every one of them — so the rule
 * saw a clean tree while the layout was typed out sixty-eight times. `tree/identity-without-owner`
 * is the scan that reads across files instead, and this module is the repair it asks for.
 * The two directory prefixes joined on 2026-09-22, when the same scan found `correctness-model/`
 * spelled as a candidate prefix in two modules.
 *
 * Three bundle names are deliberately absent, because a module already owns each with its meaning
 * attached: `BUILT_AGENTS_FILE` in `src/solve/built-starter.ts`, `REFERENCE_SOLVE_ENTRY` in
 * `src/truth/evaluator-process-bundle.ts` and `HARNESS_CONFIG_FILE` in `src/truth/harness-config.ts`.
 * Moving them here would trade one owner for another rather than removing a second spelling.
 *
 * Tests keep spelling the literals. A fixture that builds its tree from the same constant as the
 * code under test follows a rename and passes either way, so the layout would stop being checked
 * by anything at the moment it changed. Only non-test source reads these names.
 */

/** The evaluation half's directory, as a candidate path prefix. */
export const CORRECTNESS_MODEL_DIR = "correctness-model/";

/** The solve half's directory, as a candidate path prefix. */
export const AGENT_DIR = "agent/";

/** The domain plan and public rule decisions the Builder writes first. */
export const BRIEF_FILE = "correctness-model/brief.json";

/** Public task inputs beside their hidden expectations. */
export const TASKS_FILE = "correctness-model/tasks.json";

/** The task-bound accept and reject artifacts that calibrate the checks. */
export const CONTROLS_FILE = "correctness-model/controls.json";

/** The named Boolean checks the host runs; the one owner of every pass. */
export const EVALUATOR_FILE = "correctness-model/evaluator.ts";

/** The declared tool contract the solver's roster is derived from. */
export const TOOLS_SPEC_FILE = "agent/tools-spec.json";

/** The generated tool implementations the Built Harness calls. */
export const GENERATED_TOOLS_FILE = "agent/tools.ts";
