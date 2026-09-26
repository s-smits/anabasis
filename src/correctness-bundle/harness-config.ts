/** `agent/config.yaml`: the runtime settings a Built Harness declares for itself, read from the
 *  submitted snapshot by the solver, the submit gate and measurement, so all three run the harness
 *  under the walls it asked for rather than three separate sets (operator decision).
 *
 *  The Builder is told the file exists, not what it holds, and the host maximums live only here
 *  under `src/correctness-bundle/`, which the Builder cannot read. Each maximum is ten times its
 *  default, which leaves a harness room to ask for what its domain needs without being able to
 *  declare a wall that never cuts. The solver's walls also stop at a tenth of their defaults: below
 *  that the solver never sees a command return, and the wall's own submit of its first draft is what
 *  the battery grades. The gate's walls have no floor, since a short one costs only the Builder. */

import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { isNumber, isRecord } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export const HARNESS_CONFIG_FILE = "agent/config.yaml";

/** Section, key and default of every setting, in the unit the key names. */
const SETTINGS = {
  solver: { solve_minutes: 120, max_turns: 24, shell_timeout_seconds: 300, shell_timeout_max_seconds: 900 },
  gate: { reference_solve_seconds: 120, census_minutes: 30, check_seconds: 600, tool_run_seconds: 300 },
  battery: { solve_concurrency: 3 },
} as const;
const HOST_MAXIMUM_FACTOR = 10;

type Section = keyof typeof SETTINGS;
type Raw = { [S in Section]: { [K in keyof (typeof SETTINGS)[S]]: number } };

export interface HarnessSettings {
  solveMs: number;
  maxTurns: number;
  shellDefaultSeconds: number;
  shellMaxSeconds: number;
  referenceSolveMs: number;
  censusWallMs: number;
  checkWallMs: number;
  toolRunMs: number;
  solveConcurrency: number;
}

export class HarnessConfigError extends Error {}

function settingsOf(raw: Raw): HarnessSettings {
  const { solver, gate, battery } = raw;
  return {
    solveMs: solver.solve_minutes * 60_000,
    maxTurns: solver.max_turns,
    shellDefaultSeconds: solver.shell_timeout_seconds,
    shellMaxSeconds: solver.shell_timeout_max_seconds,
    referenceSolveMs: gate.reference_solve_seconds * 1000,
    censusWallMs: gate.census_minutes * 60_000,
    checkWallMs: gate.check_seconds * 1000,
    toolRunMs: gate.tool_run_seconds * 1000,
    solveConcurrency: battery.solve_concurrency,
  };
}

export const DEFAULT_HARNESS_SETTINGS: HarnessSettings = settingsOf(SETTINGS);

function checkedValue(section: Section, key: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!isNumber(value) || !Number.isInteger(value) || value <= 0) {
    throw new HarnessConfigError(`${section}.${key} must be a positive whole number`);
  }
  const tooLow = section === "solver" && value * HOST_MAXIMUM_FACTOR < fallback;
  const side = value > fallback * HOST_MAXIMUM_FACTOR ? "above" : tooLow ? "below" : null;
  if (side !== null) {
    throw new HarnessConfigError(
      `${section}.${key} ${String(value)} is ${side} what this host allows; choose a value closer to the seeded one`,
    );
  }
  return value;
}

function checkedSection(section: Section, value: unknown): Record<string, number> {
  const defaults: Record<string, number> = SETTINGS[section];
  if (value !== undefined && value !== null && !isRecord(value)) {
    throw new HarnessConfigError(`${section} must be a mapping`);
  }
  const given = isRecord(value) ? value : {};
  const unknown = Object.keys(given).filter((key) => !Object.hasOwn(defaults, key));
  if (unknown.length > 0) throw new HarnessConfigError(`${section} has no setting ${unknown.join(", ")}`);
  return Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [
      key,
      checkedValue(section, key, given[key], fallback),
    ]),
  );
}

/** Parse the file's text; an absent file or key keeps the default. */
function parseHarnessConfig(text: string): HarnessSettings {
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch (cause) {
    throw new HarnessConfigError(`is not valid YAML: ${errorMessage(cause)}`);
  }
  if (parsed !== null && parsed !== undefined && !isRecord(parsed)) {
    throw new HarnessConfigError("must be a mapping");
  }
  const root = isRecord(parsed) ? parsed : {};
  const unknown = Object.keys(root).filter((key) => !Object.hasOwn(SETTINGS, key));
  if (unknown.length > 0) throw new HarnessConfigError(`has no section ${unknown.join(", ")}`);
  const solver = checkedSection("solver", root.solver);
  const gate = checkedSection("gate", root.gate);
  const battery = checkedSection("battery", root.battery);
  if ((solver.shell_timeout_seconds ?? 0) > (solver.shell_timeout_max_seconds ?? 0)) {
    throw new HarnessConfigError(
      "solver.shell_timeout_seconds must not exceed solver.shell_timeout_max_seconds",
    );
  }
  return settingsOf(
    /* SAFETY: checkedSection returned exactly the keys of each section's defaults, each a checked number. */ {
      solver,
      gate,
      battery,
    } as Raw,
  );
}

/** The settings of a bundle or workspace directory; throws HarnessConfigError on a defective file. */
export function harnessSettings(dir: string): HarnessSettings {
  const file = join(dir, HARNESS_CONFIG_FILE);
  return existsSync(file) ? parseHarnessConfig(readFileSync(file, "utf8")) : DEFAULT_HARNESS_SETTINGS;
}

/** The submit-time finding for a defective config, or null. */
export function harnessConfigIssue(dir: string): string | null {
  try {
    harnessSettings(dir);
    return null;
  } catch (cause) {
    if (cause instanceof HarnessConfigError) return `${HARNESS_CONFIG_FILE} ${cause.message}`;
    throw cause;
  }
}
