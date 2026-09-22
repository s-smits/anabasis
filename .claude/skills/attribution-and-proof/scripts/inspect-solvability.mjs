#!/usr/bin/env bun
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

// Read-only inspector for recorded F2 solvability results. It helps establish whether the
// mechanism ran. Walks every epoch-*/NN-*/solvability.json under one
// campaign root and prints the census shape: case counts by status, the failing-check
// concentration, finding codes, source identity, and the drift verdict.
//
// Usage:
//   bun --no-env-file inspect-solvability.mjs <campaign root>   # campaigns/<slug>, any tree
//   bun --no-env-file inspect-solvability.mjs <run tree> <slug> # joins campaigns/<slug> for you
//
// The input is protected verifier evidence. Keep it and this diagnostic output out of
// Builder-visible channels. The script prints check ids, counts, finding codes and source
// identity; it prints neither task ids nor raw tool output.
const [, , rootArg, slugArg] = Bun.argv;
if (!rootArg) {
  console.error("usage: inspect-solvability.mjs <campaign root> | <run tree> <slug>");
  runtimeProcess.exit(2);
}
const root = slugArg ? join(rootArg, "campaigns", slugArg) : rootArg;
if (!existsSync(root)) {
  console.error(`no such directory: ${root}`);
  runtimeProcess.exit(2);
}

const epochs = readdirSync(root)
  .filter((entry) => entry.startsWith("epoch-"))
  .sort();
if (epochs.length === 0) console.log(`${root}: no epoch-* directories`);

for (const epoch of epochs) {
  const iterations = readdirSync(join(root, epoch))
    .filter((entry) => /^\d\d-/.test(entry))
    .sort();
  for (const iteration of iterations) {
    const file = join(root, epoch, iteration, "solvability.json");
    if (!existsSync(file)) continue;
    const result = readJsonFile(file);
    const cases = result.evidence?.cases || [];
    const by = { passed: 0, failed: 0, "non-result": 0 };
    const checkCounts = new Map();
    for (const row of cases) by[row.status] = (by[row.status] || 0) + 1;
    const failedIds = cases.flatMap((row) => (row.status === "failed" ? row.failedCheckIds || [] : []));
    for (const id of failedIds) checkCounts.set(id, (checkCounts.get(id) || 0) + 1);
    const ranked = [...checkCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const codes = [...new Set((result.findings || []).map((finding) => finding.code))];
    console.log(`${epoch}/${iteration}`);
    console.log(
      `  cases ${cases.length}: ${by.passed} passed, ${by.failed} failed, ${by["non-result"]} non-result`,
    );
    if (ranked.length > 0) {
      console.log(
        `  failing checks: ${ranked.map(([id, count]) => `${id} (${count})`).join(", ")} — ${ranked.length} class(es)`,
      );
    }
    if (codes.length > 0) {
      console.log(`  finding codes: ${codes.join(", ")} (${result.findings.length} rows)`);
    }
    console.log(
      `  source ${(result.source?.commit || "unknown").slice(0, 12)}, drift ${JSON.stringify(result.drift)}`,
    );
  }
}
