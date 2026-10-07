#!/usr/bin/env bun

/**
 * The wave audit's census: every recorded run grouped by source state and condition (the request
 * digest and the three model slots), then every baseline and candidate run of one condition in
 * adjacent states, marked with each identity that differs. A pair with none is source-only. Runs are
 * found and read as `runs pulse` finds and reads them (`recordedRuns`, `readRunEvidence`), so a run's
 * identity here is the one every other reader states; a seeded campaign adds its `seed.json`
 * fingerprint. Read only; it prints no prompt, argv, credential or backend content.
 */
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { readJsonFile, readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { mainCheckout, recordedRuns } from "#tools/runs/discover.ts";
import { type OpeningFacts, readRunEvidence } from "#tools/runs/evidence.ts";

const USAGE = `usage: census.ts [--repo <abs checkout>] [--states <abs census-states.json>]

One CELL row per source state and condition (request digest and model slots), then one PAIR row for
every baseline and candidate run of one condition in adjacent states: source-only, or mixed with each
identity that differs (same-source, dirty, origin, seed, cap, command). A command digest from before
#118 hashed the run id and source, so it differs in every older pair; compare those runs' launch.json
argv without --run, --expected-source and --project instead. Without --states, a run's state is its
source commit; with it, the file's rows[].state for that run, and a run it does not list is skipped.`;

interface CensusRun {
  runId: string;
  state: string;
  condition: string;
  opening: OpeningFacts;
  seed: string | null;
}

const short = (value: string | null, length = 8) => (value ?? "?").slice(0, length);

/** The seeded product a campaign started from, or null for a fresh or continued one. */
function seedOf(campaignDir: string): string | null {
  const seed = readJsonFileOrNull(join(campaignDir, "seed.json"));
  if (!isRecord(seed)) return null;
  return [seed.selectedProductId, seed.fingerprintAfter, seed.bytesSha256].map(String).join(":");
}

function statesFrom(path: string | null): Map<string, string> | null {
  if (path === null) return null;
  const file = readJsonFile(path);
  const rows = isRecord(file) && Array.isArray(file.rows) ? file.rows : [];
  const states = new Map<string, string>();
  for (const row of rows) {
    if (isRecord(row) && isString(row.runId) && isString(row.state)) states.set(row.runId, row.state);
  }
  if (states.size === 0) throw new Error(`${path}: no rows[] with runId and state`);
  return states;
}

/** What separates two runs of one condition besides their source. */
function mismatches(a: CensusRun, b: CensusRun): string[] {
  const [x, y] = [a.opening, b.opening];
  const found: string[] = [];
  if (x.commit === null || y.commit === null) found.push("source-unknown");
  else if (x.commit === y.commit) found.push("same-source");
  if (x.dirty !== false || y.dirty !== false) found.push("dirty");
  if (x.origin !== y.origin) found.push("origin");
  if (a.seed !== b.seed) found.push("seed");
  if (x.cap !== y.cap) found.push("cap");
  if (x.commandDigest === null || y.commandDigest === null) found.push("command-unknown");
  else if (x.commandDigest !== y.commandDigest) found.push("command");
  return found;
}

function census(args: CommandArgs): void {
  const mapped = statesFrom(args.value("states"));
  const runs: CensusRun[] = [];
  let unread = 0;
  for (const location of recordedRuns(args.value("repo") ?? mainCheckout(import.meta.dir))) {
    const opening = readRunEvidence(location).opening;
    const state = mapped === null ? short(opening?.commit ?? null, 9) : mapped.get(location.runId);
    if (state === undefined) continue;
    if (opening === null) {
      unread += 1;
      continue;
    }
    const slots = opening.slots.map((slot) =>
      slot.enabled
        ? `${slot.role}:${slot.kind ?? "?"}/${slot.model ?? "?"}/${slot.effort ?? "?"}`
        : `${slot.role}:off`,
    );
    const seed = existsSync(join(location.campaignDir, "seed.json")) ? seedOf(location.campaignDir) : null;
    runs.push({
      runId: location.runId,
      state,
      condition: `${short(opening.requestDigest, 12)} ${slots.join(" ")}`,
      opening,
      seed,
    });
  }
  runs.sort((a, b) => (a.opening.writtenAt ?? "").localeCompare(b.opening.writtenAt ?? ""));
  const states = [...new Set(runs.map((run) => run.state))];
  const cells = Map.groupBy(runs, (run) => `${run.state}\t${run.condition}`);
  console.log(`census\t${runs.length} runs\t${states.length} source states\t${unread} openings unread`);
  for (const [key, cell] of cells) console.log(`CELL\t${key}\t${cell.length} runs`);
  for (const [index, after] of states.entries()) {
    const before = states[index - 1];
    if (before === undefined) continue;
    const baseline = runs.filter((run) => run.state === before);
    let pairs = 0;
    for (const candidate of runs.filter((run) => run.state === after)) {
      for (const left of baseline.filter((run) => run.condition === candidate.condition)) {
        const found = mismatches(left, candidate);
        const verdict = found.length === 0 ? "source-only" : `mixed:${found.join(",")}`;
        console.log(
          `PAIR\t${before} -> ${after}\t${candidate.condition}\t${left.runId}\t${candidate.runId}\t${verdict}`,
        );
        pairs += 1;
      }
    }
    if (pairs === 0) console.log(`PAIR\t${before} -> ${after}\tno run shares a request and model slots`);
  }
}

if (import.meta.main) {
  await runCommand(
    { name: "census", usage: USAGE, options: { repo: "abs", states: "abs", help: "flag" } },
    census,
  );
}
