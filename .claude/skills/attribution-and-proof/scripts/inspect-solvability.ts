#!/usr/bin/env bun
import { existsSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { runCommand } from "#skills/main/cli.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { campaignEpochOrder, campaignIterations } from "#src/author/campaign-epoch.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { SOLVABILITY_EVIDENCE_FILE } from "#src/run/solvability-gate.ts";
import type { CommandArgs } from "#skills/main/cli.ts";

type CampaignIteration = ReturnType<typeof campaignIterations>[number];

// Read-only inspector for recorded F2 solvability results. It helps establish whether the
// mechanism ran. Walks every <epoch>/NN-*/solvability.json under one campaign root, epochs in
// the order the controller's epochs.json recorded them (their names are hashes, so a sorted
// listing is no chronology), and prints the census shape: case counts by status, the failing-check
// concentration, finding codes, source identity, and the drift verdict.
//
// Usage:
//   bun --no-env-file inspect-solvability.ts <campaign root>   # campaigns/<slug>, any tree
//   bun --no-env-file inspect-solvability.ts <run tree> <slug> # joins campaigns/<slug> for you
//
// The input is protected verifier evidence. Keep it and this diagnostic output out of
// Builder-visible channels. The script prints check ids, counts, finding codes and source
// identity; it prints neither task ids nor raw tool output.
/** One iteration's census block, or null when the iteration recorded no solvability result. */
function censusBlock({ epoch, name, dir }: CampaignIteration): string | null {
  const file = join(dir, SOLVABILITY_EVIDENCE_FILE);
  if (!existsSync(file)) return null;
  const result = asRecord(readJsonFile(file)) ?? {};
  const cases = listOf(asRecord(result.evidence)?.cases).map((row) => asRecord(row) ?? {});
  const by = new Map<string, number>();
  const checkCounts = new Map<string, number>();
  for (const row of cases) {
    const status = isString(row.status) ? row.status : "undefined";
    by.set(status, (by.get(status) ?? 0) + 1);
  }
  const failedIds = cases.flatMap((row) => (row.status === "failed" ? listOf(row.failedCheckIds) : []));
  for (const id of failedIds.filter(isString)) checkCounts.set(id, (checkCounts.get(id) ?? 0) + 1);
  const ranked = [...checkCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const findings = listOf(result.findings);
  const codes = [...new Set(findings.map((finding) => codeText(asRecord(finding)?.code)))];
  const lines = [
    `${epoch}/${name}`,
    `  cases ${cases.length}: ${by.get("passed") ?? 0} passed, ${by.get("failed") ?? 0} failed, ${by.get("non-result") ?? 0} non-result`,
  ];
  if (ranked.length > 0) {
    lines.push(
      `  failing checks: ${ranked.map(([id, count]) => `${id} (${count})`).join(", ")} — ${ranked.length} class(es)`,
    );
  }
  if (codes.length > 0) lines.push(`  finding codes: ${codes.join(", ")} (${findings.length} rows)`);
  const commit = asRecord(result.source)?.commit;
  const shownCommit = isString(commit) && commit !== "" ? commit : "unknown";
  lines.push(`  source ${shownCommit.slice(0, 12)}, drift ${JSON.stringify(result.drift)}`);
  return lines.join("\n");
}

/** A finding code as `Array.join` spells it: absent reads empty. */
function codeText(code: JsonValue | undefined): string {
  if (code === undefined || code === null) return "";
  return isString(code) ? code : JSON.stringify(code);
}

/** The value as a list, or empty when the record left it out. */
function listOf(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function inspect(args: CommandArgs): void {
  const [rootArg = "", slugArg] = args.positionals;
  const root = slugArg === undefined ? rootArg : campaignDir(rootArg, slugArg);
  if (!existsSync(root)) args.die(`no such directory: ${root}`);
  const iterations = campaignIterations(root);
  if (campaignEpochOrder(root).length === 0) console.log(`${root}: no epoch recorded in epochs.json`);
  for (const iteration of iterations) {
    const block = censusBlock(iteration);
    if (block !== null) console.log(block);
  }
}

if (import.meta.main) {
  await runCommand(
    {
      name: "inspect-solvability",
      usage: "usage: inspect-solvability.ts <campaign root> | <run tree> <slug>",
      positionals: [1, 2],
    },
    inspect,
  );
}
