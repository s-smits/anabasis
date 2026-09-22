/**
 * What state a recorded run is actually in.
 *
 * A missing `terminal.json` does not mean a run is alive — it is equally what a killed controller
 * leaves behind, and it is exactly the shape an operator mistakes for a live run. So liveness comes
 * from two signals the source already owns: the service manager's own view of
 * `ana.fullrun.<runId>`, and the campaign lock, whose holder record `lockHolderState` classifies
 * through the same dead-process rule that decides whether a stale lock may be broken. Neither is a
 * file timestamp.
 *
 * The lock is campaign-scoped, so it attributes to one run only while the campaign has a single
 * unfinished opening. With more than one it says so instead of guessing.
 */
import { existsSync, readFileSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { CONTROLLER_LOCK_FILE, lockHolderState, type LockHolderState } from "../../src/run/campaign-lock.ts";
import { serviceManager, type ServiceManager } from "../../.claude/skills/launch-run/scripts/service.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";

type RunState = "live" | "closed" | "orphaned" | "service-stopped" | "unknown";

export interface Liveness {
  state: RunState;
  /** The process the service manager reports, or the campaign lock's holder. */
  pid: number | null;
  /** Which signal decided the state, in the words of its owner. */
  detail: string;
}

/** One service-manager query result, so tests can answer without a manager on the host. */
export interface QueryResult {
  code: number;
  out: string;
}

export type ServiceQuery = (argv: readonly string[]) => QueryResult;

interface LivenessInput {
  runId: string;
  campaignDir: string;
  /** The run's own terminal evidence exists, whatever it says. */
  terminalRecorded: boolean;
  /** The service the launcher recorded, and the worktree it bound it to. */
  service: string | null;
  worktree: string | null;
  /** How many openings in this campaign have no terminal, this run included. */
  unfinishedInCampaign: number;
}

const runService: ServiceQuery = (argv) => {
  const result = runSync(argv, { timeout: 20_000 });
  return { code: result.exitCode ?? 1, out: decodeOutput(result.stdout) + decodeOutput(result.stderr) };
};

/** The holder pid, for display beside the state its own classifier decided. */
function lockHolderPid(campaignDir: string): number | null {
  const path = join(campaignDir, CONTROLLER_LOCK_FILE);
  if (!existsSync(path)) return null;
  try {
    const holder = parseJsonAs<{ pid?: unknown }>(readFileSync(path, "utf8"));
    const pid = Number(holder.pid);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function fromLock(input: LivenessInput, holder: LockHolderState): Liveness {
  const pid = lockHolderPid(input.campaignDir);
  if (holder === "held" && input.unfinishedInCampaign === 1) {
    return { state: "live", pid, detail: "campaign lock held by a live holder" };
  }
  if (holder === "held") {
    return {
      state: "unknown",
      pid,
      detail: `campaign lock held, ${input.unfinishedInCampaign} unfinished openings share it`,
    };
  }
  if (holder === "unreadable") return { state: "unknown", pid: null, detail: "campaign lock unreadable" };
  return {
    state: "orphaned",
    pid: null,
    detail: holder === "absent" ? "no service, no campaign lock" : "campaign lock holder proved dead",
  };
}

function fromService(
  input: LivenessInput,
  service: string,
  manager: ServiceManager,
  query: ServiceQuery,
): Liveness | null {
  const result = query(manager.query(service));
  if (manager.absent(result.code, result.out)) return null;
  if (result.code !== 0) return { state: "unknown", pid: null, detail: `${manager.name} query failed` };
  const label = `ana.fullrun.${input.runId}`;
  if (input.worktree !== null && !manager.owned(result.out, input.worktree, label)) {
    return { state: "unknown", pid: null, detail: `${manager.name} bound ${service} to another worktree` };
  }
  if (manager.running(result.out)) {
    return {
      state: "live",
      pid: manager.pid(result.out),
      detail: `${manager.name} reports ${service} running`,
    };
  }
  if (manager.stopped(result.out)) {
    return {
      state: "service-stopped",
      pid: null,
      detail: `${manager.name} holds ${service} loaded but not running`,
    };
  }
  return { state: "unknown", pid: null, detail: `${manager.name} reported no state for ${service}` };
}

/**
 * The run's state. A recorded terminal ends the question; otherwise the service answers when the
 * run has one, and the campaign lock answers when it does not.
 */
export function runLiveness(
  input: LivenessInput,
  query: ServiceQuery = runService,
  manager: ServiceManager = serviceManager(),
): Liveness {
  if (input.terminalRecorded) return { state: "closed", pid: null, detail: "terminal evidence recorded" };
  const fromManager = input.service === null ? null : fromService(input, input.service, manager, query);
  if (fromManager !== null) return fromManager;
  return fromLock(input, lockHolderState(join(input.campaignDir, CONTROLLER_LOCK_FILE)));
}
