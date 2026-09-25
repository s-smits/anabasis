#!/usr/bin/env bun
import { existsSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { runCommand } from "#skills/main/cli.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { campaignDir } from "#src/meta/campaign-root.ts";
import { campaignEpochOrder, campaignIterations } from "#src/author/campaign-epoch.ts";

// Read-only inspector for recorded F2 solvability results. It helps establish whether the
// mechanism ran. Walks every <epoch>/NN-*/solvability.json under one campaign root, epochs in
// the order the controller's epochs.json recorded them (their names are hashes, so a sorted
// listing is no chronology), and prints the census shape: case counts by status, the failing-check
// concentration, finding codes, source identity, and the drift verdict.
//
// Usage:
//   bun --no-env-file inspect-solvability.mjs <campaign root>   # campaigns/<slug>, any tree
//   bun --no-env-file inspect-solvability.mjs <run tree> <slug> # joins campaigns/<slug> for you
//
// The input is protected verifier evidence. Keep it and this diagnostic output out of
// Builder-visible channels. The script prints check ids, counts, finding codes and source
// identity; it prints neither task ids nor raw tool output.
/** One iteration's census block, or null when the iteration recorded no solvability result. */
function censusBlock({ epoch, name, dir }) {
  const file = join(dir, "solvability.json");
  if (!existsSync(file)) return null;
  const result = readJsonFile(file);
  const cases = result.evidence?.cases || [];
  const by = { passed: 0, failed: 0, "non-result": 0 };
  const checkCounts = new Map();
  for (const row of cases) by[row.status] = (by[row.status] || 0) + 1;
  const failedIds = cases.flatMap((row) => (row.status === "failed" ? row.failedCheckIds || [] : []));
  for (const id of failedIds) checkCounts.set(id, (checkCounts.get(id) || 0) + 1);
  const ranked = [...checkCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const codes = [...new Set((result.findings || []).map((finding) => finding.code))];
  const lines = [
    `${epoch}/${name}`,
    `  cases ${cases.length}: ${by.passed} passed, ${by.failed} failed, ${by["non-result"]} non-result`,
  ];
  if (ranked.length > 0) {
    lines.push(
      `  failing checks: ${ranked.map(([id, count]) => `${id} (${count})`).join(", ")} — ${ranked.length} class(es)`,
    );
  }
  if (codes.length > 0) lines.push(`  finding codes: ${codes.join(", ")} (${result.findings.length} rows)`);
  lines.push(
    `  source ${(result.source?.commit || "unknown").slice(0, 12)}, drift ${JSON.stringify(result.drift)}`,
  );
  return lines.join("\n");
}

function inspect(args) {
  const [rootArg, slugArg] = args.positionals;
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
      usage: "usage: inspect-solvability.mjs <campaign root> | <run tree> <slug>",
      positionals: [1, 2],
    },
    inspect,
  );
}
