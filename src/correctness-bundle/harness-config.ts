/** `agent/config.yaml`: the runtime walls a Built Harness declares for itself, read from the
 *  submitted snapshot by the solver, the submit gate and measurement, so all three run the harness
 *  under the walls it asked for rather than three separate sets (operator decision).
 *
 *  Every setting is one wall in seconds and bounds one thing no other setting bounds: a whole solve,
 *  one solver shell command, one reference solve, one correctness check, one verifier tool run.
 *  What the host owns stays out of the file: the Built turn guard (`BUILT_RUNAWAY_TURNS`), the census
 *  wall, derived from the check and reference walls (`censusWallMs`), and the battery width
 *  (`BUILT_SOLVE_CONCURRENCY`).
 *
 *  The Builder is told the file exists, not what it holds. A gate wall has no maximum: the one
 *  recorded value that reached ten times its default was a reference solve, the wall a stronger
 *  witness needs longest. A solver wall keeps that maximum, because it is part of the measured
 *  condition, and also stops at a tenth of its default: below that the solver never sees a command
 *  return, and the wall's own submit of its first draft is what the battery grades. That floor is
 *  current policy for a new candidate or a new solve, so only `harnessConfigIssue` applies it:
 *  `harnessSettings` reads what a bundle declared, and a replay that grades one never runs its
 *  solver. The gate's walls have no floor, since a short one costs only the Builder. */

import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { isNumber, isRecord } from "../meta/json-shape.ts";
import { join } from "../meta/path.ts";
import { errorMessage } from "../meta/runtime-values.ts";

export const HARNESS_CONFIG_FILE = "agent/config.yaml";

/** Section, key and default of every setting, each a wall in seconds. */
const SETTINGS = {
  solver: { solve_seconds: 7200, shell_command_seconds: 900 },
  gate: { reference_solve_seconds: 120, check_seconds: 600, tool_run_seconds: 300 },
} as const;

/** How far above and below its default the host accepts a solver wall. */
const HOST_LIMIT_FACTOR = 10;

type Section = keyof typeof SETTINGS;
type Raw = { [S in Section]: { [K in keyof (typeof SETTINGS)[S]]: number } };

export interface HarnessSettings {
  solveMs: number;
  /** The wall of one solver shell command: a command runs for up to this, whatever it passes. */
  shellCommandSeconds: number;
  referenceSolveMs: number;
  checkWallMs: number;
  toolRunMs: number;
}

export class HarnessConfigError extends Error {}

/** A solver wall far above its default (`"above"`) or far below it (`"below"`). */
function hostLimitSide(section: Section, value: number, fallback: number): "above" | "below" | null {
  if (section !== "solver") return null;
  if (value > fallback * HOST_LIMIT_FACTOR) return "above";
  return value * HOST_LIMIT_FACTOR < fallback ? "below" : null;
}

const hostLimitMessage = (section: Section, key: string, value: number, side: "above" | "below") =>
  `${section}.${key} ${String(value)} is ${side} what this host allows; choose a value closer to the seeded one`;

function settingsOf(raw: Raw): HarnessSettings {
  const { solver, gate } = raw;
  return {
    solveMs: solver.solve_seconds * 1000,
    shellCommandSeconds: solver.shell_command_seconds,
    referenceSolveMs: gate.reference_solve_seconds * 1000,
    checkWallMs: gate.check_seconds * 1000,
    toolRunMs: gate.tool_run_seconds * 1000,
  };
}

export const DEFAULT_HARNESS_SETTINGS: HarnessSettings = settingsOf(SETTINGS);

function checkedValue(section: Section, key: string, value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (!isNumber(value) || !Number.isInteger(value) || value <= 0) {
    throw new HarnessConfigError(`${section}.${key} must be a positive whole number`);
  }
  if (hostLimitSide(section, value, fallback) === "above") {
    throw new HarnessConfigError(hostLimitMessage(section, key, value, "above"));
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
function parseHarnessConfig(text: string): Raw {
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
  /* SAFETY: checkedSection returned exactly the keys of each section's defaults, each a checked number. */
  return { solver, gate } as Raw;
}

function rawSettings(dir: string): Raw {
  const file = join(dir, HARNESS_CONFIG_FILE);
  return existsSync(file) ? parseHarnessConfig(readFileSync(file, "utf8")) : SETTINGS;
}

/** The settings a bundle or workspace directory declares, recorded ones included; throws
 *  HarnessConfigError on a defective file. The solver floor is not applied here. */
export function harnessSettings(dir: string): HarnessSettings {
  const file = join(dir, HARNESS_CONFIG_FILE);
  return existsSync(file) ? settingsOf(rawSettings(dir)) : DEFAULT_HARNESS_SETTINGS;
}

/** The settings a bundle declares, or null when its config is defective: a reader of records reports
 *  one recorded under an earlier schema as unread rather than parsing around it. */
export function readableHarnessSettings(dir: string): HarnessSettings | null {
  try {
    return harnessSettings(dir);
  } catch (cause) {
    if (cause instanceof HarnessConfigError) return null;
    throw cause;
  }
}

/** The finding that refuses admitting a candidate, or launching a solve, under this config, or null. */
export function harnessConfigIssue(dir: string): string | null {
  try {
    const { solver } = rawSettings(dir);
    const defaults: Record<string, number> = SETTINGS.solver;
    for (const [key, value] of Object.entries(solver)) {
      const fallback = defaults[key] ?? value;
      if (hostLimitSide("solver", value, fallback) === "below") {
        return `${HARNESS_CONFIG_FILE} ${hostLimitMessage("solver", key, value, "below")}`;
      }
    }
    return null;
  } catch (cause) {
    if (cause instanceof HarnessConfigError) return `${HARNESS_CONFIG_FILE} ${cause.message}`;
    throw cause;
  }
}
