/**
 * Which credential file each open launched run started on, read from its launch receipt, so a
 * steward choosing the credential for a simulation condition sees which ones paid runs already hold.
 *
 * On 2026-09-30 each of three stewards opened `.scratch/quick-run/launch.json` in every `ana-run-*`
 * tree by hand to find the live runs' `credentialSource` before starting its own condition. Only the
 * receipt's recorded path is read, and only its file name is shown: the credential file is never
 * opened. How much room a credential has left is not this script's question.
 *
 *   bun .claude/skills/system-path-simulation/scripts/credential-use.mts [--root /abs/checkout] [--json]
 *
 * `run-condition.mts` records its own `--env-file` the same way and names the open runs that share it.
 */
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { runCommand } from "#skills/main/cli.ts";
import { LAUNCH_RECEIPT_PATH, mainCheckout } from "#tools/runs/discover.ts";
import { collectRows } from "#tools/runs/rows.ts";

export interface CredentialUse {
  /** The credential's file name, as the receipt recorded its path. */
  credential: string;
  runs: { runId: string; slug: string; state: string; worktree: string }[];
}

/** The file name of the credential a launch receipt in `dir` records, or null without one. */
export function receiptCredential(dir: string): string | null {
  const path = join(dir, LAUNCH_RECEIPT_PATH);
  if (!existsSync(path)) return null;
  try {
    const { credentialSource } = parseJsonAs<{ credentialSource?: unknown }>(readFileSync(path, "utf8"));
    return isString(credentialSource) && credentialSource !== "" ? basename(credentialSource) : null;
  } catch {
    return null;
  }
}

/** The file name Bun's `--env-file` names in this process's own arguments, or null. */
export function credentialFileOf(execArgv: readonly string[]): string | null {
  for (const [index, argument] of execArgv.entries()) {
    if (argument.startsWith("--env-file=")) return basename(argument.slice("--env-file=".length));
    const next = execArgv[index + 1];
    if (argument === "--env-file" && next !== undefined) return basename(next);
  }
  return null;
}

/** Every open run with a launch receipt, grouped by the credential it was launched on. */
export function credentialUse(root: string): CredentialUse[] {
  const groups = new Map<string, CredentialUse["runs"]>();
  for (const row of collectRows(mainCheckout(root), { closedLimit: 0 })) {
    if (row.liveness.state === "closed" || row.worktree === null) continue;
    const credential = receiptCredential(row.worktree) ?? "(no credential recorded)";
    const runs = groups.get(credential) ?? [];
    runs.push({ runId: row.runId, slug: row.slug, state: row.liveness.state, worktree: row.worktree });
    groups.set(credential, runs);
  }
  return [...groups]
    .map(([credential, runs]) => ({ credential, runs }))
    .sort((a, b) => a.credential.localeCompare(b.credential));
}

/** The open runs launched on `credential`, by run id. */
export function openRunsOn(credential: string, root: string): string[] {
  return credentialUse(root)
    .filter((group) => group.credential === credential)
    .flatMap((group) => group.runs.map((run) => run.runId));
}

if (import.meta.main) {
  await runCommand(
    {
      name: "credential-use",
      usage: "usage: credential-use.mts [--root /abs/checkout] [--json]",
      options: { root: "abs", json: "flag" },
    },
    (args) => {
      const groups = credentialUse(args.value("root") ?? runtimeProcess.cwd());
      if (args.flag("json")) {
        console.log(JSON.stringify(groups, null, 2));
        return;
      }
      if (groups.length === 0) console.log("no open launched run");
      for (const { credential, runs } of groups) {
        console.log(`${credential}  ${runs.length} open`);
        for (const run of runs) console.log(`  ${run.runId}  ${run.state}  ${run.slug}  ${run.worktree}`);
      }
    },
  );
}
