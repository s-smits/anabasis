/**
 * The one owner of where a candidate bundle's files sit inside a workspace, snapshot or product
 * tree: `correctness-model/…` for the evaluation half, `agent/…` for the solve half.
 *
 * Three bundle names live with the module that owns their meaning: `BUILT_AGENTS_FILE`
 * (`src/solve/built-starter.ts`), `REFERENCE_SOLVE_ENTRY` (`src/truth/evaluator-process-bundle.ts`)
 * and `HARNESS_CONFIG_FILE` (`src/truth/harness-config.ts`).
 *
 * Tests spell the literals, so a rename here is still caught by a fixture.
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
