/**
 * The authoring sequence of a campaign as the controller recorded it, backend-neutral, codes only.
 *
 * Every steward of a live condition has so far written its own watcher over the Codex rollout jsonl
 * (`detect.py`, `sequence.py`, `rollout-filter.py`, `snapshotter.sh` on 2026-08-23 alone), and each
 * one re-implemented the same redaction: print tool names, stages, codes, ids and timings, never
 * verifier stdout, issue text or remedies. This reads what the controller itself records —
 * `epoch-<key>/builder-execution[-NN].json` (checkpointed per tool return since #319) and each
 * run's opening and terminal through `openRecordedRun` — so a Claude condition and a Codex condition
 * show the same view and nothing model-private is opened. A run the strict reader refuses is shown
 * with its refusal rather than with fields read around it.
 *
 *   bun .claude/skills/system-path-simulation/scripts/difficulty-watch.mts \
 *     --campaign /abs/worktree/campaigns/<slug> [--json]
 *
 * Use it once per check instead of a polling loop; a steward that needs an event waits on the
 * condition's process or on `terminal.json` appearing, not on this output changing.
 */

import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runCommand } from "#skills/main/cli.ts";
import { openRecordedRun } from "#skills/main/run.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { campaignRuns } from "#tools/runs/discover.ts";

const LADDER_TOOLS = new Set([
  "correctness_check",
  "submit",
  "harness_trial",
  "harness_inspect",
  "verifier_workshop",
]);

export interface DifficultyCall {
  sequence: number | null;
  turn: number | null;
  tool: string;
  action: string | null;
  startedAtMs: number | null;
  durationMs: number | null;
  dispatchOutcome: string | null;
}

export interface SubmitRow {
  ordinal: number | null;
  turn: number | null;
  atMs: number | null;
  outcome: string | null;
  stage: string | null;
  findingCodes: string[];
  repeatedFindings: JsonValue;
  workspaceChanged: JsonValue;
  terminal: JsonValue;
}

/** One controller run as this watch reads it: the opening's identity and the terminal, if written.
 *  `refused` is the strict reader's refusal, of the opening or of the terminal it binds. */
interface ControllerRow {
  runId: string;
  source: string | null;
  epoch: JsonObject | null;
  modelSlots: JsonValue;
  terminal: { outcome: string; terminalReason: string; writtenAt: string } | null;
  refused: string | null;
}

export interface ExecutionView {
  record: string;
  backend: string | null;
  outcome: string | null;
  turns: number | null;
  durationMs: number | null;
  toolCalls: JsonObject | null;
  sequence: DifficultyCall[];
  submits: SubmitRow[];
  writtenAt: string | null;
}

function str(value: unknown): string | null {
  return isString(value) ? value : null;
}

function num(value: unknown): number | null {
  return isNumber(value) && Number.isFinite(value) ? value : null;
}

function clock(ms: number | null): string {
  if (ms === null) return "--:--";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Selects names, counts, codes and timings from one builder-execution record. Finding codes are
 * token-filtered; other selected fields rely on the controller schema, so this is not a generic redactor. */
export function executionView(record: string, data: JsonObject): ExecutionView {
  const calls = Array.isArray(data.customCalls) ? data.customCalls : [];
  const sequence: DifficultyCall[] = [];
  for (const raw of calls) {
    const call = asRecord(raw);
    if (call === null) continue;
    const tool = str(call.tool);
    if (tool === null || !LADDER_TOOLS.has(tool)) continue;
    sequence.push({
      sequence: num(call.sequence),
      turn: num(call.turn),
      tool,
      action: str(call.action),
      startedAtMs: num(call.startedAtMs),
      durationMs: num(call.durationMs),
      dispatchOutcome: str(call.dispatchOutcome),
    });
  }
  const submits: SubmitRow[] = [];
  for (const raw of Array.isArray(data.submits) ? data.submits : []) {
    const submit = asRecord(raw);
    if (submit === null) continue;
    submits.push({
      ordinal: num(submit.ordinal),
      turn: num(submit.turn),
      atMs: num(submit.atMs),
      outcome: str(submit.outcome),
      stage: str(submit.stage),
      // A finding code is one token; prose that reached a code field stays behind.
      findingCodes: (Array.isArray(submit.findingCodes) ? submit.findingCodes : []).filter(
        (code): code is string => isString(code) && /^[A-Za-z0-9_.:/-]+$/.test(code),
      ),
      repeatedFindings: submit.repeatedFindings ?? null,
      workspaceChanged: submit.workspaceChanged ?? null,
      terminal: submit.terminal ?? null,
    });
  }
  return {
    record,
    backend: str(data.backend),
    outcome: str(data.outcome),
    turns: num(data.turns),
    durationMs: num(data.durationMs),
    toolCalls: asRecord(data.toolCalls),
    sequence,
    submits,
    writtenAt: str(data.writtenAt),
  };
}

function executionRecords(root: string): string[] {
  const out: string[] = [];
  for (const epoch of readdirSync(root)
    .filter((name) => name.startsWith("epoch-"))
    .sort()) {
    const dir = join(root, epoch);
    const records = readdirSync(dir).filter((name) => /^builder-execution(?:-\d+)?\.json$/.test(name));
    // The first iteration is unnumbered; a plain sort would put `-02` before `.json`.
    const ordinal = (name: string): number => Number(/-(\d+)\.json$/.exec(name)?.[1] ?? "1");
    for (const name of records.sort((a, b) => ordinal(a) - ordinal(b))) out.push(join(dir, name));
  }
  return out;
}

function controllerRow(root: string, runId: string): ControllerRow {
  let run: ReturnType<typeof openRecordedRun>;
  try {
    run = openRecordedRun(root, runId);
  } catch (error) {
    return {
      runId,
      source: null,
      epoch: null,
      modelSlots: null,
      terminal: null,
      refused: errorMessage(error),
    };
  }
  const recorded = run.controller?.state === "recorded" ? run.controller : null;
  return {
    runId,
    source: run.source.commit,
    epoch: asRecord(run.opening.epoch),
    modelSlots: run.opening.modelSlots ?? null,
    terminal:
      recorded === null
        ? null
        : {
            outcome: recorded.outcome,
            terminalReason: recorded.terminalReason,
            writtenAt: recorded.writtenAt,
          },
    refused: run.controllerError,
  };
}

function render(controller: ControllerRow[], executions: ExecutionView[]): void {
  for (const run of controller) {
    const epoch = run.epoch;
    console.log(
      `run ${run.runId}: source ${(run.source ?? "?").slice(0, 9)} epoch ${str(epoch?.key) ?? "?"} supersedes ${JSON.stringify(epoch?.supersedes ?? null)}`,
    );
    console.log(`  terminal: ${run.terminal === null ? "absent" : JSON.stringify(run.terminal)}`);
    if (run.refused !== null) console.log(`  refused by the strict reader: ${run.refused}`);
  }
  for (const view of executions) {
    const by = JSON.stringify(view.toolCalls?.byName ?? {});
    console.log(
      `${view.record}: outcome ${view.outcome ?? "open"} turns ${view.turns ?? "?"} ${clock(view.durationMs)} tools ${by}`,
    );
    for (const call of view.sequence) {
      const action = call.action === null ? "" : `:${call.action}`;
      console.log(
        `  ${clock(call.startedAtMs)} t${call.turn ?? "?"} #${call.sequence ?? "?"} ${call.tool}${action} ${call.durationMs ?? "?"}ms ${call.dispatchOutcome ?? ""}`,
      );
    }
    for (const submit of view.submits) {
      const codes = submit.findingCodes.length === 0 ? "" : ` codes ${submit.findingCodes.join(",")}`;
      console.log(
        `  ${clock(submit.atMs)} submit ${submit.ordinal ?? "?"} → ${submit.outcome ?? "?"} stage ${submit.stage ?? "null"}${codes} repeated ${JSON.stringify(submit.repeatedFindings)} changed ${JSON.stringify(submit.workspaceChanged)} terminal ${JSON.stringify(submit.terminal)}`,
      );
    }
  }
  if (executions.length === 0) console.log("no builder-execution record yet");
}

if (import.meta.main) {
  await runCommand(
    {
      name: "difficulty-watch",
      usage: "usage: difficulty-watch.mts --campaign /abs/campaigns/<slug> [--json]",
      options: { campaign: "abs", json: "flag" },
    },
    (args) => {
      const campaign = args.required("campaign");
      if (!existsSync(campaign)) args.die(`${campaign} does not exist`);
      const executions = executionRecords(campaign)
        .map((path) => {
          const data = asRecord(readJsonFileOrNull(path));
          return data === null ? null : executionView(path.slice(campaign.length + 1), data);
        })
        .filter((view): view is ExecutionView => view !== null);
      const controller = campaignRuns(campaign)
        .map(({ runId }) => runId)
        .sort()
        .map((runId) => controllerRow(campaign, runId));
      if (args.flag("json")) console.log(JSON.stringify({ campaign, controller, executions }, null, 2));
      else render(controller, executions);
    },
  );
}
