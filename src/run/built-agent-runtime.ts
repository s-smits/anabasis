/** The one Built runtime a battery solves under. */
import { type PiBuiltRuntime, piBuiltSolver } from "../backends/pi-built.ts";
import type { RunObserver } from "../observe/run-observer.ts";
import type { ProviderResourceBudget } from "./provider-resource-budget.ts";
import type { SafeguardContext } from "../meta/safeguard.ts";
import type { Solver } from "../truth/solve.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { EnvironmentRefusal } from "../backends/environment-refusal.ts";
import type { OsIsolationRuntime } from "../verify/os-isolation.ts";
import { type SolveIsolationPolicy, solveIsolationPolicy } from "../verify/solve-sandbox.ts";

interface BuiltBatteryRuntime {
  observer: RunObserver;
  solver(): Solver;
}

/** Observation phase used by the main battery. The name reads oddly because it predates
 *  single-battery measurement, when it distinguished the measured condition from the one run with
 *  advisers. It is now the identifier every observation reader matches on, so the string is part of
 *  the recorded shape rather than a description of it, and renaming it would change what those
 *  readers see without changing what was measured. */
const SHIPPING_PHASE = "measure-on";

/** What a battery runtime is opened with beyond its runtime and observer: the turn wall, a
 *  scripted solver that replaces the provider, and the two campaign-level records it reports to. */
type BuiltBatteryOptions = {
  readonly maxTurns?: number | undefined;
  readonly scripted?: Solver | undefined;
  readonly providerBudget?: ProviderResourceBudget | undefined;
  readonly safeguardContext?: SafeguardContext | undefined;
};

/** Every Built provider runs in the same host-confined Pi child. An absent OS mechanism refuses
 *  before the Builder opens, and the refusal is typed: a plain Error records `abortClause: null`,
 *  while this class records `environment-blocked`, which is the owner a host with no isolation has.
 *  The `runtime` interface is the same one `solveIsolationPolicy` carries, so the unsupported branch
 *  can be exercised on a host that does support isolation. */
export function builtSolveIsolation(
  repoRoot: string,
  readAllowRoots: readonly string[] = [],
  runtime?: OsIsolationRuntime,
): SolveIsolationPolicy {
  const policy = solveIsolationPolicy({ repoRoot, readAllowRoots, ...keyIfDefined("runtime", runtime) });
  if ("unsupported" in policy) {
    throw new EnvironmentRefusal(
      `the Built Harness cannot be physically confined on this host (${policy.unsupported})`,
    );
  }
  return policy;
}

export function builtBatteryRuntime(
  runtime: PiBuiltRuntime | null,
  observer: RunObserver,
  options: BuiltBatteryOptions = {},
): BuiltBatteryRuntime {
  const { maxTurns, scripted, providerBudget, safeguardContext } = options;
  return {
    observer,
    solver() {
      if (scripted !== undefined) return scripted;
      if (runtime === null) throw new Error("the live Pi Built runtime was not resolved");
      return piBuiltSolver(runtime, {
        maxTurns,
        observer,
        observationPhase: SHIPPING_PHASE,
        providerBudget,
        safeguardContext,
      });
    },
  };
}
