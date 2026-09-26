// What each gate component cost and bought on one campaign, read against the confidence the gate
// audit put on it. Every correctness_check and submit a Builder session made is recorded with its
// receipt — outcome, stage, the finding codes and the candidate identity it judged — so which
// refusal fired, and what the Builder did next, is already on disk. Nothing joined it to the
// question the audit asked of every refusal: is it at least 98% sure it refuses something wrong,
// and does it ever hold up a round that could have advanced?
//
//   bun wri.mjs gates <target> [--json]
//
// A firing is one refused receipt read as ledger components. Each code names its row, current or
// retired, so the several codes one component emits on one receipt are one firing of it, and a
// qualifier — a code that rides beside another component's code to add detail — counts only on a
// receipt that names nothing else. Consecutive refusals carrying the same component are one
// episode, and an episode ends in one of these ways, read from the next receipt that could have
// carried the component again:
//
//   repaired                            the component is gone and the candidate's bytes moved
//   repaired-tool-condition             the bytes are the same and the installed-tool condition
//                                       moved, so a repair to the tools answered it
//   cleared-without-edit                the whole submission condition is the same, bytes and
//                                       tools: the refusal was about something other than them
//   cleared-plan-unrecorded             the same, for a refusal of the round's plan, which the
//                                       condition does not cover: an EXPERIMENT.json edit may
//                                       have answered it
//   bundle-unchanged-condition-unknown  the bytes are the same and the receipts recorded no tool
//                                       condition, so whether the tools moved is not known
//   answered-identity-unrecorded        one of the two receipts named no candidate
//   unanswered                          no later receipt could have carried it
//
// The submission condition is the candidate snapshot joined to the digest of the installed tools
// it resolved (`conditionKey`), which is what the gate caches a verdict on. The tool work between
// the two receipts — shell, workshop and source-fetch calls — is carried beside the answer.
//
// A clear or accepted receipt could have carried every component. A refused one could only carry
// the components whose own stage ran again on it: a check that stopped at conformance never ran
// the reference solve, so a reference-solve code's absence there answers nothing. A receipt names
// each code's stage and the stages it ran; a receipt recorded before it did answers only by
// clearing. `repaired` says bytes moved, not that the defect was fixed: a component dodged by
// renaming reads `repaired` too, which is why lane 27 adjudicates and this reader only counts.
// The same holds for the priors: they are the audit's judgement, carried beside the counts so a
// reader sees where the two disagree.
//
// It also names every evaluation correction the campaign measured, read from the recorded
// batteries' own experiment operation rather than from a later round's decision file, so a
// correction measured just before a stop is still found. Beside each is the battery before it and
// the bundle files that moved between the two snapshots. Where a grading file moved — the brief,
// the evaluator or a module beside it, or a task's hidden expectations — the row is a replay
// candidate: the artifacts the earlier battery accepted can be graded again under the corrected
// bundle with the `bun run replay -- <before> --under <correction>` command it carries, which lane
// 28 runs. Nothing records that a replay was done, so the lead stands after it. Where only
// controls, the reference solve or the agent moved, a regrade would reproduce the recorded
// verdicts, and the row says so instead.

import { existsSync, readdirSync, readFileSync, statSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { sha256 } from "#src/meta/digest.ts";
import { canonicalJson } from "#src/meta/stable-json.ts";
import { commitPublicTask } from "#src/correctness-bundle/task-split.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { campaignEpochs } from "#src/author/campaign-epoch.ts";
import { readControllerEvidence } from "#src/run/controller-evidence.ts";
import { readExecutionEvidenceDetails } from "#tools/outcome/builder-execution-facts.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import { resolveRecordedCandidate } from "#tools/replay/cli.ts";
import {
  DELIBERATELY_UNLEDGERED,
  LEDGER_DATE,
  QUALIFIERS,
  REFUSAL_BAR,
  clearsBar,
  componentOf,
  holdComponent,
  terminalComponent,
} from "./gate-ledger.mjs";

const GATE_RENT_SCHEMA = "wri-gate-rent/v2";
/** An episode that spans this many refused receipts reads as a stall even if it later cleared. */
const STALL_RECEIPTS = 3;
/** Two holds in a row is a chain: the Builder resubmitted into a review that was still running. */
const HOLD_CHAIN = 2;
const GATE_TOOLS = new Set(["correctness_check", "submit"]);
const EDIT_TOOLS = new Set(["write", "edit", "harness_reset"]);
/** Calls that can change the installed tools without touching a bundle file. */
const TOOL_WORK = new Set(["bash", "verifier_workshop", "public_source"]);
const REFUSED = new Set(["findings", "refused"]);
const CLEARED = new Set(["clear", "accepted"]);
/** The forms under which a component still refuses; a firing below the bar in one is a lead. */
const LIVE_FORMS = new Set(["kept", "narrowed", "rewritten"]);
/** The stage that reads the round's EXPERIMENT.json, which the submission condition does not cover. */
const PLAN_STAGE = "validation";
const TASKS_FILE = "correctness-model/tasks.json";

const minutes = (ms) => Math.round(ms / 600) / 100;
/** `1 episode`, `2 episodes`. */
const count = (n, noun, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`;

/** The ledger key one code files under: its row, an unscored validator, or unledgered. */
function keyOf(code) {
  const entry = componentOf(code);
  if (entry !== null) return entry.code;
  return DELIBERATELY_UNLEDGERED.has(code) ? `unscored ${code}` : `unledgered ${code}`;
}

/** A refused receipt's components, each with the codes that named it. A qualifier beside a code of
 *  a component it details is folded into nothing; alone, it counts under its own row. */
function componentsOf(codes) {
  const named = new Set(codes.filter((code) => !QUALIFIERS.has(code)).map((code) => componentOf(code)?.code));
  const detail = (code) => QUALIFIERS.get(code)?.beside.some((component) => named.has(component)) === true;
  const keyed = new Map();
  for (const code of codes.filter((one) => !detail(one))) {
    const key = keyOf(code);
    keyed.set(key, [...(keyed.get(key) ?? []), code]);
  }
  return keyed;
}

/** The gate receipts one session recorded, in dispatch order, each with the edit and tool-work
 *  calls the Builder made since the previous receipt. A call without a receipt carries nothing. */
function receiptsOf(record) {
  const calls = Array.isArray(record.customCalls) ? [...record.customCalls] : [];
  calls.sort((a, b) => a.sequence - b.sequence);
  const receipts = [];
  let edits = 0;
  let toolWork = 0;
  for (const call of calls) {
    if (EDIT_TOOLS.has(call.tool)) edits += 1;
    if (TOOL_WORK.has(call.tool)) toolWork += 1;
    if (!GATE_TOOLS.has(call.tool) || call.semantic === undefined) continue;
    const { semantic } = call;
    const codes = refusedCodes(semantic);
    receipts.push({
      tool: call.tool,
      sequence: call.sequence,
      atMs: isNumber(call.startedAtMs) ? call.startedAtMs : null,
      durationMs: isNumber(call.durationMs) ? call.durationMs : null,
      outcome: semantic.outcome,
      stage: isString(semantic.stage) ? semantic.stage : null,
      reason: isString(semantic.reason) ? semantic.reason : null,
      candidateId: isString(semantic.candidateId) ? semantic.candidateId : null,
      conditionId: isString(semantic.conditionId) ? semantic.conditionId : null,
      stagesRun: Array.isArray(semantic.stagesRun) ? semantic.stagesRun.filter(isString) : null,
      codeStages: codeStagesOf(semantic),
      components: componentsOf(codes),
      editsBefore: edits,
      toolWorkBefore: toolWork,
    });
    edits = 0;
    toolWork = 0;
  }
  return receipts;
}

/** A refused receipt's codes. One that named none — an older record kept the stage and the count
 *  alone — is attributed to its stage, so it is still counted rather than dropped. */
function refusedCodes(semantic) {
  if (!REFUSED.has(semantic.outcome)) return [];
  const codes = Array.isArray(semantic.findingCodes) ? semantic.findingCodes.filter(isString) : [];
  return codes.length > 0 ? [...new Set(codes)] : [`stage:${semantic.stage ?? "unrecorded"}`];
}

/** Each code's stage, from the receipt's `<stage>:<code>` list; a receipt without one files every
 *  code under its own stage. */
function codeStagesOf(semantic) {
  const staged = Array.isArray(semantic.stagedCodes) ? semantic.stagedCodes.filter(isString) : [];
  return new Map(
    staged.flatMap((entry) => {
      const at = entry.indexOf(":");
      return at <= 0 ? [] : [[entry.slice(at + 1), entry.slice(0, at)]];
    }),
  );
}

/** Whether `later` could have carried an episode: it cleared, or it refused having run every stage
 *  the episode's codes came from. A refusal that does not say which stages it ran answers nothing. */
function comparable(episode, later) {
  if (CLEARED.has(later.outcome)) return true;
  if (!REFUSED.has(later.outcome) || later.stagesRun === null) return false;
  // A full gates run covers the census it contains.
  const ran = (stage) =>
    later.stagesRun.includes(stage) || (stage === "census" && later.stagesRun.includes("gates"));
  return episode.stages.every(ran);
}

/** Each episode of each component in one session: where it started, how many receipts carried it,
 *  and how it ended. */
function episodesOf(receipts, where, accepted) {
  const episodes = [];
  const open = new Map();
  receipts.forEach((receipt, index) => {
    for (const [key, episode] of open) {
      if (!comparable(episode, receipt) || receipt.components.has(key)) continue;
      episodes.push(close(episode, receipts, index));
      open.delete(key);
    }
    for (const [key, codes] of receipt.components) {
      const episode = open.get(key) ?? {
        key,
        codes: new Set(),
        stages: [],
        start: index,
        carried: 0,
        edits: 0,
        toolWork: 0,
      };
      for (const code of codes) episode.codes.add(code);
      const stages = codes.map((code) => receipt.codeStages.get(code) ?? receipt.stage ?? "unrecorded");
      episode.stages = [...new Set([...episode.stages, ...stages])];
      episode.carried += 1;
      open.set(key, episode);
    }
    for (const episode of open.values()) {
      if (episode.start === index) continue;
      episode.edits += receipt.editsBefore;
      episode.toolWork += receipt.toolWorkBefore;
    }
  });
  for (const episode of open.values()) episodes.push(close(episode, receipts, null));
  return episodes.map((episode) => ({ ...episode, where, sessionAccepted: accepted }));
}

/** How the receipt that no longer carried a component answered it. The full condition decides
 *  where both receipts recorded one; otherwise the snapshot alone, which cannot see the tools. */
function answerOf(episode, first, end) {
  if (first.conditionId !== null && end.conditionId !== null) {
    if (first.conditionId !== end.conditionId) {
      return first.candidateId === end.candidateId ? "repaired-tool-condition" : "repaired";
    }
    return episode.stages.includes(PLAN_STAGE) ? "cleared-plan-unrecorded" : "cleared-without-edit";
  }
  if (first.candidateId === null || end.candidateId === null) return "answered-identity-unrecorded";
  return first.candidateId === end.candidateId ? "bundle-unchanged-condition-unknown" : "repaired";
}

function close(episode, receipts, endIndex) {
  const first = receipts[episode.start];
  const shared = { component: episode.key, codes: [...episode.codes].sort(), stages: episode.stages };
  if (endIndex === null) {
    return {
      ...shared,
      carried: episode.carried,
      answer: "unanswered",
      minutes: null,
      edits: episode.edits,
      toolWork: episode.toolWork,
    };
  }
  const end = receipts[endIndex];
  const toolWork = episode.toolWork + end.toolWorkBefore;
  return {
    ...shared,
    carried: episode.carried,
    answer: answerOf(episode, first, end),
    minutes: first.atMs !== null && end.atMs !== null ? minutes(end.atMs - first.atMs) : null,
    edits: episode.edits + end.editsBefore,
    toolWork,
  };
}

/** The review-unread holds, as chains of consecutive held submits. */
function holdsOf(receipts, where) {
  const chains = [];
  let chain = null;
  for (const receipt of receipts) {
    const held =
      receipt.tool === "submit" && receipt.outcome === "blocked" && holdComponent(receipt.reason) !== null;
    if (held) {
      chain ??= { where, holds: 0, waitMs: 0 };
      chain.holds += 1;
      chain.waitMs += receipt.durationMs ?? 0;
    } else if (receipt.tool === "submit" && chain !== null) {
      chains.push(chain);
      chain = null;
    }
  }
  if (chain !== null) chains.push(chain);
  return chains;
}

/** Every session of every epoch, with its receipts, episodes and holds. */
function sessionsOf(campaign) {
  const sessions = [];
  const unreadable = [];
  for (const epoch of campaignEpochs(campaign)) {
    const epochDir = join(campaign, epoch);
    const read = readExecutionEvidenceDetails(epochDir);
    unreadable.push(...read.unavailable);
    read.records.forEach((record, index) => {
      const where = `${epoch} session ${read.sessions[index] ?? index + 1}`;
      const receipts = receiptsOf(record);
      const accepted = receipts.some(
        (receipt) => receipt.tool === "submit" && receipt.outcome === "accepted",
      );
      sessions.push({
        where,
        receipts: receipts.length,
        refused: receipts.filter((receipt) => REFUSED.has(receipt.outcome)).length,
        accepted,
        episodes: episodesOf(receipts, where, accepted),
        holds: holdsOf(receipts, where),
      });
    });
  }
  return { sessions, unreadable };
}

/** One row per component that fired, with the audit's prior beside what its episodes did. A row's
 *  `receipts` counts refused receipts that named it, each once however many of its codes it carried. */
function componentRows(episodes) {
  const byKey = new Map();
  for (const episode of episodes) {
    const entry = componentOf(episode.codes[0]);
    const unscored = entry === null ? (DELIBERATELY_UNLEDGERED.get(episode.codes[0]) ?? null) : null;
    const row = byKey.get(episode.component) ?? {
      component: entry?.code ?? null,
      id: entry?.id ?? null,
      form: entry?.form ?? (unscored === null ? null : "unscored"),
      unscored,
      pRight: entry?.pRight ?? null,
      pStall: entry?.pStall ?? null,
      clearsBar: entry === null ? null : clearsBar(entry),
      codes: new Set(),
      episodes: 0,
      receipts: 0,
      answers: {},
      stalls: 0,
      minutes: [],
    };
    for (const code of episode.codes) row.codes.add(code);
    row.episodes += 1;
    row.receipts += episode.carried;
    row.answers[episode.answer] = (row.answers[episode.answer] ?? 0) + 1;
    if (isStall(episode)) row.stalls += 1;
    if (episode.minutes !== null) row.minutes.push(episode.minutes);
    byKey.set(episode.component, row);
  }
  return [...byKey.values()]
    .map(({ codes, minutes: spent, ...row }) => ({
      ...row,
      codes: [...codes].sort(),
      medianMinutes:
        spent.length === 0 ? null : spent.toSorted((a, b) => a - b)[Math.floor(spent.length / 2)],
    }))
    .sort((a, b) => b.receipts - a.receipts);
}

/** An episode that held the session up: it outlived `STALL_RECEIPTS` refusals, or it was never
 *  answered in a session that ended without an accepted submit. */
function isStall(episode) {
  return episode.carried >= STALL_RECEIPTS || (episode.answer === "unanswered" && !episode.sessionAccepted);
}

/** The loop component the run's own terminal names, if any. */
function terminalOf(campaign, runId) {
  if (runId === null) return { state: "unselected", reason: null, component: null };
  try {
    const controller = readControllerEvidence(campaign, runId);
    if (controller.state !== "recorded") return { state: controller.state, reason: null, component: null };
    const entry = terminalComponent(controller.terminalReason);
    return {
      state: "recorded",
      reason: controller.terminalReason,
      component:
        entry === null
          ? null
          : { code: entry.code, id: entry.id, form: entry.form, pRight: entry.pRight, pStall: entry.pStall },
    };
  } catch (error) {
    return { state: "refused", reason: errorMessage(error), component: null };
  }
}

function trigger(name, examples) {
  return examples.length === 0 ? [] : [{ name, rows: examples.length, examples: examples.slice(0, 3) }];
}

/** The digest-style leads this reader raises; `brief.mjs` maps each to the lane that reads it. */
function triggersOf({ episodes, components, holds, terminal }) {
  const label = (episode) =>
    `${episode.codes.join(" + ")} at ${episode.where} (${count(episode.carried, "receipt")}, ${episode.answer})`;
  const belowBar = (row) => LIVE_FORMS.has(row.form) && row.pRight !== null && row.pRight < REFUSAL_BAR;
  return [
    ...trigger("GATE STALL (lane 27)", episodes.filter(isStall).map(label)),
    ...trigger(
      "GATE CLEARED WITHOUT EDIT (lane 27)",
      episodes.filter((episode) => episode.answer === "cleared-without-edit").map(label),
    ),
    ...trigger(
      "BELOW-BAR GATE FIRED (lane 27)",
      components
        .filter(belowBar)
        .map(
          (row) =>
            `${row.component} ${row.id} [${row.form}] P(right) ${row.pRight}, ${count(row.episodes, "episode")}`,
        ),
    ),
    ...trigger(
      "UNLEDGERED REFUSAL CODE (lane 27)",
      components
        .filter((row) => row.component === null && row.unscored === null)
        .map((row) => `${row.codes.join(", ")}, ${count(row.episodes, "episode")}`),
    ),
    ...trigger(
      "REVIEW HOLD CHAIN (lane 27)",
      holds
        .filter((chain) => chain.holds >= HOLD_CHAIN)
        .map((chain) => `${count(chain.holds, "hold")} at ${chain.where}, ${minutes(chain.waitMs)} min held`),
    ),
    ...trigger(
      "CEILING ENDED RUN (lane 27)",
      terminal.component === null || terminal.component.code === "LP-2"
        ? []
        : [`${terminal.component.code} ${terminal.component.id}: ${terminal.reason}`],
    ),
  ];
}

/** Every battery the campaign recorded, once each, with its experiment operation, its counts and
 *  the claim's `createdAt`. Batteries are ordered by that time; one without a claim sorts after
 *  them by run id, which is the controller's round order. */
function recordedBatteries(campaign) {
  const byRun = new Map();
  for (const root of campaignTraceRoots(campaign)) {
    const runs = join(root, "runs");
    if (!existsSync(runs)) continue;
    for (const runId of readdirSync(runs).sort()) {
      if (byRun.has(runId)) continue;
      const battery = readJsonFileOrNull(join(runs, runId, "battery.json"));
      if (!isRecord(battery) || !Array.isArray(battery.cases)) continue;
      const authoring = isRecord(battery.experimentAuthoring) ? battery.experimentAuthoring : null;
      const operation = isRecord(authoring?.operation) ? authoring.operation.operation : null;
      const claim = readJsonFileOrNull(join(campaign, "claims", `${runId}.json`));
      const cases = battery.cases.filter(isRecord);
      byRun.set(runId, {
        runId,
        operation: isString(operation) ? operation : null,
        createdAt: isRecord(claim) && isString(claim.createdAt) ? claim.createdAt : null,
        passed: cases.filter((row) => row.pass === true).length,
        verified: cases.filter((row) => row.truthOk !== null && row.truthOk !== undefined).length,
      });
    }
  }
  const at = (row) => (row.createdAt === null ? Number.POSITIVE_INFINITY : Date.parse(row.createdAt));
  return [...byRun.values()].sort((a, b) => at(a) - at(b) || a.runId.localeCompare(b.runId));
}

/** Every file of a bundle snapshot, by path relative to it, with its digest. */
function snapshotFiles(dir) {
  const files = new Map();
  for (const rel of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const path = join(dir, rel);
    if (statSync(path).isFile()) files.set(rel, sha256(readFileSync(path)));
  }
  return files;
}

/** A module of the scoring program: the brief, or a non-test module of the correctness model
 *  outside the reference solve. */
const isGrading = (rel) =>
  rel === "correctness-model/brief.json" ||
  (rel.startsWith("correctness-model/") &&
    !rel.startsWith("correctness-model/reference/") &&
    rel.endsWith(".ts") &&
    !rel.endsWith(".test.ts"));

/** The tasks of a snapshot by id, or null when `tasks.json` is not a bare array of task rows. */
function tasksById(dir) {
  const tasks = readJsonFileOrNull(join(dir, "correctness-model/tasks.json"));
  if (!Array.isArray(tasks) || !tasks.every((task) => isRecord(task) && isString(task.taskId))) return null;
  return new Map(tasks.map((task) => [task.taskId, task]));
}

/** How many tasks' hidden expectations and how many tasks' public exam moved between two
 *  snapshots. A task on one side only moved its public exam: replay refuses it as missing. */
function taskMoves(beforeDir, afterDir) {
  const before = tasksById(beforeDir);
  const after = tasksById(afterDir);
  if (before === null || after === null) return null;
  let hidden = 0;
  let publicExam = 0;
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const [was, now] = [before.get(id), after.get(id)];
    if (was === undefined || now === undefined) {
      publicExam += 1;
      continue;
    }
    if (commitPublicTask(was).publicTaskDigest !== commitPublicTask(now).publicTaskDigest) publicExam += 1;
    if (canonicalJson(was.hidden ?? null) !== canonicalJson(now.hidden ?? null)) hidden += 1;
  }
  return { hidden, publicExam };
}

/** The bundle files a correction moved, split into the scoring program and everything else. */
function bundleMoves(campaign, beforeRun, afterRun) {
  const beforeDir = resolveRecordedCandidate(`${campaign}/${beforeRun}`, campaign).candidateDir;
  const afterDir = resolveRecordedCandidate(`${campaign}/${afterRun}`, campaign).candidateDir;
  const [was, now] = [snapshotFiles(beforeDir), snapshotFiles(afterDir)];
  const changed = [...new Set([...was.keys(), ...now.keys()])]
    .filter((rel) => was.get(rel) !== now.get(rel))
    .sort();
  const tasks = changed.includes(TASKS_FILE) ? taskMoves(beforeDir, afterDir) : null;
  // A task file that cannot be split is counted as grading rather than cleared.
  const tasksGrade = changed.includes(TASKS_FILE) && (tasks === null || tasks.hidden > 0);
  const grading = changed.filter(isGrading);
  return {
    grading: tasksGrade ? [...grading, TASKS_FILE] : grading,
    other: changed.filter((rel) => !isGrading(rel) && rel !== TASKS_FILE),
    hiddenTasks: tasks?.hidden ?? null,
    publicTasks: tasks?.publicExam ?? 0,
  };
}

/** Every evaluation correction the campaign measured, beside the battery measured before it and
 *  the bundle files that moved between their snapshots. The regrade command is carried only when
 *  a grading file moved, because otherwise it would reproduce the recorded verdicts. */
function correctionsOf(campaign, unreadable) {
  const rows = recordedBatteries(campaign);
  return rows.flatMap((row, index) => {
    if (row.operation !== "evaluation-correction") return [];
    const before = rows[index - 1] ?? null;
    const base = {
      runId: row.runId,
      before: before?.runId ?? null,
      passedBefore: before === null ? null : `${before.passed}/${before.verified}`,
      passedAfter: `${row.passed}/${row.verified}`,
    };
    if (before === null) return [{ ...base, moved: null, regrade: null, note: "no earlier battery" }];
    let moved;
    try {
      moved = bundleMoves(campaign, before.runId, row.runId);
    } catch (error) {
      unreadable.push(`correction ${row.runId}: ${errorMessage(error)}`);
      return [{ ...base, moved: null, regrade: null, note: "a bundle snapshot did not resolve" }];
    }
    if (moved.grading.length === 0) {
      const other = moved.other.length === 0 ? "nothing" : moved.other.join(", ");
      return [
        { ...base, moved, regrade: null, note: `no grading file moved (${other}): nothing to regrade` },
      ];
    }
    const regrade = `bun run replay -- ${campaign}/${before.runId} --under ${campaign}/${row.runId}`;
    return [{ ...base, moved, regrade, note: null }];
  });
}

/** @param {{ campaign: string, runId?: string | null }} named */
export function buildGateRent({ campaign, runId = null }) {
  const { sessions, unreadable } = sessionsOf(campaign);
  const episodes = sessions.flatMap((session) => session.episodes);
  const holds = sessions.flatMap((session) => session.holds);
  const components = componentRows(episodes);
  const terminal = terminalOf(campaign, runId);
  const corrections = correctionsOf(campaign, unreadable);
  return {
    schema: GATE_RENT_SCHEMA,
    campaign,
    runId,
    ledgerDate: LEDGER_DATE,
    refusalBar: REFUSAL_BAR,
    state: sessions.length === 0 ? "unavailable" : "recorded",
    reason: sessions.length === 0 ? "the campaign recorded no Builder execution record" : null,
    sessions: sessions.map(({ episodes: _episodes, holds: _holds, ...session }) => session),
    components,
    episodes,
    holds,
    terminal,
    corrections,
    unreadable,
    triggers: [
      ...triggersOf({ episodes, components, holds, terminal }),
      ...trigger(
        "EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)",
        corrections
          .filter((row) => row.regrade !== null)
          .map((row) => `${row.runId} after ${row.before}: ${row.moved.grading.join(", ")}`),
      ),
    ],
    limits: [
      "A receipt names finding codes, never the finding: which file, check or task a refusal was about stays in the protected gate evidence.",
      "`repaired` says the candidate's bytes moved and the code went away, not that the defect was fixed; a refusal dodged by renaming reads the same.",
      "A replay candidate stays one after the replay is run: nothing records a replay, so lane 28 reads its own report.",
      "An edit count is the Builder's write, edit and reset calls between receipts, and tool work its shell, workshop and source-fetch calls; the record keeps neither with paths.",
      `The priors are the gate audit's judgement as of ${LEDGER_DATE}, carried in gate-ledger.mjs; they are not measured by this reader.`,
    ],
  };
}

function componentLine(row) {
  const answers = Object.entries(row.answers)
    .map(([kind, n]) => `${kind} ${n}`)
    .join(", ");
  const unledgered = row.unscored === null ? "unledgered" : `unscored: ${row.unscored}`;
  const prior =
    row.component === null
      ? unledgered
      : `${row.component} ${row.id} [${row.form}] P(right) ${row.pRight ?? "n/a"} P(stall) ${row.pStall ?? "n/a"}`;
  const spent = row.medianMinutes === null ? "" : `, median ${row.medianMinutes} min to answer`;
  const stalls = row.stalls === 0 ? "" : `, ${count(row.stalls, "stall")}`;
  const firings = `${count(row.episodes, "episode")} over ${count(row.receipts, "refused receipt")}`;
  return `  ${prior}\n      ${row.codes.join(", ")}: ${firings}; ${answers}${spent}${stalls}`;
}

function correctionLine(row) {
  const after = `${row.before ?? "no earlier battery"} (${row.passedBefore ?? "n/a"})`;
  const head = `  evaluation correction ${row.runId} (${row.passedAfter}) after ${after}`;
  if (row.regrade === null) return `${head}; ${row.note}`;
  const drift =
    row.moved.publicTasks === 0
      ? ""
      : `; ${count(row.moved.publicTasks, "task")} moved its public exam and will be refused per task`;
  return `${head}; grading moved: ${row.moved.grading.join(", ")}${drift}; regrade: ${row.regrade}`;
}

export function renderGateRent(report) {
  if (report.state !== "recorded") return `${report.campaign}: ${report.reason}`;
  const receipts = report.sessions.reduce((sum, session) => sum + session.receipts, 0);
  const refused = report.sessions.reduce((sum, session) => sum + session.refused, 0);
  const holds =
    report.holds.length === 0
      ? "none"
      : report.holds
          .map((chain) => `${chain.holds} at ${chain.where} (${minutes(chain.waitMs)} min)`)
          .join("; ");
  const { component } = report.terminal;
  const ended =
    component === null ? "" : ` — ${component.code} ${component.id}, P(right) ${component.pRight}`;
  const sessions = `${count(report.sessions.length, "Builder session")}, ${count(receipts, "gate receipt")}`;
  const lines = [
    `${sessions}, ${refused} refused; priors from the gate audit of ${report.ledgerDate}, bar P(right) ≥ ${report.refusalBar}`,
    ...(report.components.length === 0
      ? ["  no gate component fired"]
      : report.components.map(componentLine)),
    `  review-unread holds: ${holds}`,
    `  terminal: ${report.terminal.reason ?? report.terminal.state}${ended}`,
    ...report.corrections.map(correctionLine),
    ...report.unreadable.map((line) => `  unreadable: ${line}`),
    ...report.triggers.map((row) => `  ${row.name} x${row.rows}: ${row.examples[0]}`),
  ];
  return lines.join("\n");
}
