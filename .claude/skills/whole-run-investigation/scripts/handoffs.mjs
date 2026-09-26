// What one round hands the next, and whether the next round used it. Four lanes of the catalogue
// each start from one table here, so their paid lanes spend on the question rather than on
// rebuilding the join:
//
//   lane 17  round hand-off census — per round and per channel, whether the channel's bytes were
//            present, served in the kickoff prompt, read back through a tool call, and acted on;
//   lane 10  difficulty calibration — rehearsals, declared target against verified passes, and
//            whether rehearsal or trace evidence was opened before the battery was authored;
//   lane 15  triage hand-off — per failing family, what the Epoch Reviewer and the advice packet
//            said, and which side of the product the successor battery actually moved;
//   lane 18  same-task repair — per family, whether consecutive batteries measured the same public
//            inputs, and which advice issue states moved on a comparison of family names alone.
//
//   bun wri.mjs handoff <target> [--json] [--out <abs file>]
//
// Campaign bytes only; nothing executes and nothing is written inside the run. A served marker is a
// sentence the current source renders, so an absent marker reads `not found`, never `not served`:
// an older prompt may have carried the same channel under other words. Reads come from the path
// record and the Builder's custom calls. A file opened through `bash` records only its working
// directory, so every round states its bash count beside the reads as the unobservable remainder.
// A field an older source never recorded is `null` and printed as unobservable, never as zero.
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import { BUILDER_EXECUTION_SCHEMA } from "#src/author/builder-execution.ts";
import { DIFFICULTY_DECISION_SCHEMA } from "#src/run/difficulty-decision.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { isNumber, isRecord, isString } from "#src/meta/json-shape.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import { adviceIssueId, issueStatusWord } from "#src/author/rebuild-advice.ts";
import { ownerSide } from "#src/author/feedback-routing.ts";

export const HANDOFFS_SCHEMA = "wri-handoffs/v1";

/** The Builder tools this reader counts, spelled once. */
const TRIAL = "harness_trial";
const PREVIEW = "correctness_check";

/** The operation each triaged side's repair is attributed as, from the accepted bytes
 *  (`experiment-admission.ts`): a task probe repairs neither side, a new baseline moved several. */
const REPAIR_OPERATION = { harness: "harness-intervention", evaluation: "evaluation-correction" };

/**
 * The channels a round can hand the next. `marker` is a sentence the current source renders into
 * the kickoff (grep-confirmed at the owner named beside it); `read` names the tool evidence that
 * counts as opening the channel, or null when no tool re-serves it; `alternative` is the cheapest
 * route a served-but-unread channel could take instead, stated as a candidate for lane 17 to test.
 */
export const CHANNELS = [
  // src/run/battery-sizing.ts
  {
    name: "round-facts",
    marker: "Task count:",
    read: null,
    alternative: "re-serve through an existing harness_inspect mode",
  },
  // src/run/climb-readout-frame.ts
  {
    name: "climb-readout",
    marker: "Climb readout (",
    read: "history",
    alternative: "harness_inspect history exists; name it where the target is chosen",
  },
  // src/run/climb-readout-frame.ts, src/author/domain-repo.ts
  {
    name: "ladder",
    marker: "difficulty-ladder.md",
    read: "ladder",
    alternative: "quote the zone's ladder section inside the readout",
  },
  // src/author/rebuild-advice.ts
  {
    name: "rebuild-advice",
    marker: "Standing issues",
    read: null,
    alternative: "return the current packet from harness_inspect feedback",
  },
  // src/author/rebuild-advice.ts (v1 and later renderings)
  {
    name: "diagnosis",
    marker: /confidence, points at|First failure boundary /,
    read: null,
    alternative: "ride the advice packet's inspect route",
  },
  // src/review/epoch-review-public.ts
  {
    name: "epoch-review",
    marker: "Epoch review (",
    read: null,
    alternative: "return the latest public projection from harness_inspect feedback",
  },
  // src/run/climb-readout-frame.ts
  {
    name: "experiment",
    marker: "before preview or submit as {",
    read: "experiment",
    alternative: "none: submit already refuses a missing proposal",
  },
  // src/author/builder-memory.ts (fresh sessions only)
  {
    name: "memory",
    marker: "Historical notes, model-authored",
    read: "memory",
    alternative: "restate on a resumed session, which receives no memory block",
  },
  // src/builder/user-context.ts
  {
    name: "context",
    marker: "User context:",
    read: "context",
    alternative: "none when no files were supplied",
  },
  // src/run/climb-readout-frame.ts
  {
    name: "traces",
    marker: "harness_inspect history holds every row",
    read: "traces",
    alternative: "an inspect mode summarising the last battery's traces",
  },
];

const READ_PATHS = {
  ladder: /starter-pack\/difficulty-ladder\.md$/,
  experiment: /\/EXPERIMENT\.json$/,
  memory: /\/MEMORY\.md$/,
  traces: /\/(rehearsals|trials|cases)\/|trace/,
};

const records = (value) => (Array.isArray(value) ? value.filter((row) => isRecord(row)) : []);
const jsonl = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line))
    : [];

/** This run's batteries in claim order, which AGENTS.md makes the order of record.
 *  @param {string} campaign
 *  @param {string | null} runId */
function batteriesOf(campaign, runId) {
  const dir = join(campaign, "claims");
  if (!existsSync(dir)) return [];
  const ownBattery =
    runId === null ? () => true : (battery) => battery === runId || battery.startsWith(`${runId}-i`);
  const rows = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJsonFileOrNull(join(dir, name)))
    .filter((claim) => isRecord(claim) && isString(claim.runId) && isString(claim.createdAt))
    .filter((claim) => ownBattery(claim.runId));
  return rows
    .map((claim) => ({ runId: claim.runId, createdAt: claim.createdAt, at: Date.parse(claim.createdAt) }))
    .sort((a, b) => a.at - b.at);
}

/** Each battery's difficulty row, from whichever decision file recorded it last. A decision under
 *  any other schema is refused by name: its rows carry another shape, and reading them as this one
 *  would put a placement in the table that the controller never made. */
function decisionRows(campaign) {
  const dir = join(campaign, "difficulty-decisions");
  const byRun = new Map();
  if (!existsSync(dir)) return byRun;
  for (const name of readdirSync(dir).sort()) {
    const decision = readJsonFileOrNull(join(dir, name));
    if (!isRecord(decision) || decision.schema !== DIFFICULTY_DECISION_SCHEMA) {
      throw new Error(`difficulty-decisions/${name} is not ${DIFFICULTY_DECISION_SCHEMA}`);
    }
    for (const row of records(isRecord(decision.difficulty) ? decision.difficulty.rows : [])) {
      if (isString(row.runId)) byRun.set(row.runId, row);
    }
  }
  return byRun;
}

const analysis = (campaign, battery, kind) =>
  readJsonFileOrNull(join(campaign, "analysis", `${battery}-${kind}.json`));

/** Authoring-time reviews, timed by the UUIDv7 in their file name; battery reviews record no time. */
function authoringReviewTimes(campaign) {
  const dir = join(campaign, "analysis");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^authoring-([0-9a-f-]{36})-epoch-review\.json$/.exec(name)?.[1])
    .filter((id) => id !== undefined)
    .map((id) => Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16))
    .sort((a, b) => a - b);
}

/** Every Builder session an epoch recorded, with its calls placed on the wall clock. A record under
 *  another schema is refused by name rather than read for the fields that happen to match. */
function sessionsOf(epochDir) {
  return readdirSync(epochDir)
    .filter((name) => /^builder-execution(-\d+)?\.json$/.test(name))
    .map((name) => {
      const record = readJsonFileOrNull(join(epochDir, name));
      if (!isRecord(record) || record.schema !== BUILDER_EXECUTION_SCHEMA) {
        throw new Error(`${basename(epochDir)}/${name} is not ${BUILDER_EXECUTION_SCHEMA}`);
      }
      return record;
    })
    .filter((record) => isString(record.writtenAt) && isNumber(record.durationMs))
    .map((record) => {
      const start = Date.parse(record.writtenAt) - record.durationMs;
      const at = (row) => (isNumber(row.startedAtMs) ? start + row.startedAtMs : null);
      return {
        start,
        end: Date.parse(record.writtenAt),
        calls: records(record.customCalls).map((row) => ({ ...row, at: at(row) })),
        reviews: records(record.authoringReviews).length,
        submits: records(record.submits).map((row) => ({
          ...row,
          at: isNumber(row.atMs) ? start + row.atMs : null,
        })),
        bash:
          isRecord(record.toolCalls) && isRecord(record.toolCalls.byName)
            ? (record.toolCalls.byName.bash ?? 0)
            : null,
      };
    });
}

/** The full kickoff prompts this run served the Builder, keyed by the epoch workspace they name. */
function promptsByEpoch(campaign, runId) {
  const byEpoch = new Map();
  const dir = join(campaign, "observability");
  if (!existsSync(dir)) return byEpoch;
  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".jsonl") && (runId === null || name === `${runId}.jsonl`),
  );
  for (const file of files) {
    for (const row of jsonl(join(dir, file))) {
      if (row.type !== "prompt-ingested" || row.contract !== "builder" || row.role !== "builder") continue;
      const epoch = /(epoch-[0-9a-f]{12})\/workspace/.exec(row.prompt ?? "")?.[1];
      if (epoch !== undefined) byEpoch.set(epoch, [...(byEpoch.get(epoch) ?? []), row.prompt]);
    }
  }
  return byEpoch;
}

/** One round per epoch: its sessions, path record, prompts and the battery its accepted submit fed. */
function roundsOf(campaign, runId, batteries) {
  const epochs = readJsonFileOrNull(join(campaign, "epochs.json"));
  const prompts = promptsByEpoch(campaign, runId);
  const listed = records(isRecord(epochs) ? epochs.epochs : []).filter((epoch) => isString(epoch.key));
  const scoped = prompts.size === 0 ? listed : listed.filter((epoch) => prompts.has(epoch.key));
  return scoped.map((epoch, index) => {
    const dir = join(campaign, epoch.key);
    const sessions = existsSync(dir) ? sessionsOf(dir) : [];
    const accepted = sessions
      .flatMap((s) => s.submits)
      .filter((s) => s.outcome === "accepted" && s.at !== null);
    const acceptedAt = accepted.length === 0 ? null : Math.max(...accepted.map((s) => s.at));
    const battery = acceptedAt === null ? null : (batteries.find((b) => b.at > acceptedAt) ?? null);
    const start =
      sessions.length === 0 ? Date.parse(epoch.createdAt) : Math.min(...sessions.map((s) => s.start));
    return {
      index: index + 1,
      epoch: epoch.key,
      dir,
      start,
      sessions,
      paths: jsonl(join(dir, "builder-path-record.jsonl")).map((row) => ({ ...row, at: Date.parse(row.at) })),
      prompts: prompts.get(epoch.key) ?? [],
      proposal: accepted.at(-1)?.experimentProposal ?? null,
      battery: battery?.runId ?? null,
      prior: batteries.filter((b) => b.at < start),
    };
  });
}

const calls = (round, tool, action) =>
  round.sessions
    .flatMap((s) => s.calls)
    .filter((c) => c.tool === tool && (action === undefined || c.action === action));
const pathHits = (round, capability, pattern, before = Infinity) =>
  round.paths.filter(
    (row) => row.capability === capability && pattern.test(row.resolved ?? "") && row.at < before,
  ).length;

function readCount(round, read, before = Infinity) {
  if (read === null) return null;
  if (read === "history") {
    return calls(round, "harness_inspect", "history").filter((c) => c.at < before).length;
  }
  if (read === "context") return calls(round, "context").filter((c) => c.at < before).length;
  return pathHits(round, "read", READ_PATHS[read], before);
}

function presentOf(campaign, round, name) {
  const last = round.prior.at(-1)?.runId ?? null;
  const advice = last === null ? null : analysis(campaign, last, "rebuild-advice");
  const diagnoses = last === null ? null : analysis(campaign, last, "diagnoses");
  switch (name) {
    case "round-facts":
    case "context":
      return true;
    case "ladder":
      return existsSync(join(round.dir, "workspace", "starter-pack", "difficulty-ladder.md"));
    case "rebuild-advice":
      return isRecord(advice) && records(advice.issues).length > 0;
    case "diagnosis":
      return isRecord(diagnoses) && records(diagnoses.diagnoses).length > 0;
    case "epoch-review":
      return last !== null && analysis(campaign, last, "epoch-review") !== null;
    case "memory":
      return round.index > 1;
    default:
      return round.prior.length > 0 || (name === "traces" && calls(round, TRIAL).length > 0);
  }
}

function actedOf(round, name) {
  const proposal = round.proposal;
  if (name === "climb-readout") return isRecord(proposal) && isRecord(proposal.target);
  if (name === "experiment") return pathHits(round, "write", READ_PATHS.experiment) > 0 && isRecord(proposal);
  if (name === "memory") return pathHits(round, "write", READ_PATHS.memory) > 0;
  if (name === "traces") return calls(round, TRIAL).length > 0;
  return null;
}

/** Lane 17: one row per round, one cell per channel. */
function census(campaign, rounds) {
  return rounds.map((round) => {
    const text = round.prompts.join("\n");
    const channels = CHANNELS.map((channel) => {
      const marker = channel.marker;
      let served = typeof marker === "string" ? text.includes(marker) : marker.test(text);
      if (channel.name === "epoch-review") served ||= round.sessions.some((s) => s.reviews > 0);
      if (channel.name === "traces") served ||= calls(round, TRIAL).length > 0;
      const read = readCount(round, channel.read);
      return {
        name: channel.name,
        present: presentOf(campaign, round, channel.name),
        served,
        read,
        acted: actedOf(round, channel.name),
      };
    });
    const unread = channels.flatMap((cell) =>
      cell.served && (cell.read === null || cell.read === 0)
        ? [{ name: cell.name, alternative: CHANNELS.find((c) => c.name === cell.name).alternative }]
        : [],
    );
    const bash = round.sessions.map((s) => s.bash).filter((n) => n !== null);
    return {
      round: round.index,
      epoch: round.epoch,
      promptFound: round.prompts.length > 0,
      bashCalls: bash.length === 0 ? null : bash.reduce((a, b) => a + b, 0),
      channels,
      servedNotRead: unread,
    };
  });
}

/** When the round started committing to a battery: its first proposal write, preview or submit. */
function authoringMark(round) {
  const writes = round.paths.filter(
    (row) => row.capability === "write" && READ_PATHS.experiment.test(row.resolved ?? ""),
  );
  const gates = [...calls(round, PREVIEW), ...calls(round, "submit")].filter((c) => c.at !== null);
  const times = [...writes.map((row) => row.at), ...gates.map((c) => c.at)];
  return times.length === 0 ? Infinity : Math.min(...times);
}

/** Whether the magnitude of the prediction error closes across the rounds that declared a target. */
function errorTrend(errors) {
  if (errors.length < 2) return "insufficient";
  if (errors.every((e, i) => i === 0 || e <= errors[i - 1]) && errors.at(-1) < errors[0]) return "shrinking";
  return errors.every((e) => e === errors[0]) ? "flat" : "not-shrinking";
}

/** Lane 10: per round, the rehearsals, the declared target against the verified count, and the
 *  evidence the round opened before it committed to a battery. */
function calibration(rounds, rows) {
  const out = rounds.map((round) => {
    const row = round.battery === null ? null : (rows.get(round.battery) ?? null);
    const trials = calls(round, TRIAL);
    const target = isRecord(round.proposal) && isRecord(round.proposal.target) ? round.proposal.target : null;
    const passed = isNumber(row?.passed) ? row.passed : null;
    const mark = authoringMark(round);
    return {
      round: round.index,
      battery: round.battery,
      rehearsals: trials.length,
      rehearsalVerdicts: trials.map((c) =>
        isRecord(c.semantic) ? (c.semantic.truthVerdict ?? "not-run") : null,
      ),
      target:
        target === null ? null : { comparator: target.comparator, verifiedPasses: target.verifiedPasses },
      passed,
      verified: isNumber(row?.verified) ? row.verified : null,
      error: target === null || passed === null ? null : passed - target.verifiedPasses,
      result: isRecord(row?.target) ? (row.target.result ?? null) : null,
      zone: row?.zone ?? null,
      beforeAuthoring: {
        history: readCount(round, "history", mark),
        rehearsals: trials.filter((c) => c.at !== null && c.at < mark).length,
        traceReads: pathHits(round, "read", READ_PATHS.traces, mark),
      },
      // The decision row scores the plan's per-task pass probabilities against the verdicts.
      predictions: isRecord(row?.calibration) ? row.calibration : null,
    };
  });
  const placed = [...rows.values()].filter((row) => isString(row.zone));
  return {
    rounds: out,
    errorTrend: errorTrend(out.filter((r) => r.error !== null).map((r) => Math.abs(r.error))),
    onAim: placed.filter((row) => row.zone === "on-aim").length,
    placed: placed.length,
  };
}

/** A diagnosis names a bundle file or `solver` (`DIAGNOSIS_OWNERS`), and a file's own prefix is the
 *  side its repair reopens, so `correctness-model/brief.json` is the evaluation's. */
function diagnosisOf(value) {
  if (!isRecord(value) || !isString(value.owner)) return null;
  const evaluation = value.owner !== "solver" && ownerSide(value.owner) === "correctness-model";
  return {
    side: evaluation ? "evaluation" : "harness",
    owner: value.owner,
    confidence: value.confidence ?? null,
  };
}

function reviewOf(campaign, battery, issueId) {
  const review = analysis(campaign, battery, "epoch-review");
  if (!isRecord(review)) return null;
  const probes = records(review.probes);
  const unmoved = probes.filter(
    (p) =>
      p.refused == null &&
      p.baseline?.outcome === "pass" &&
      Array.isArray(p.movedCheckIds) &&
      p.movedCheckIds.length === 0,
  );
  return {
    status: review.status ?? null,
    findings: records(review.findings).length,
    probes: probes.length,
    unmovedProbes: unmoved.length,
    disputedThisIssue: records(review.disputes).some((d) => d.issueId === issueId),
  };
}

/** Lane 15: per failing family, the triage each component recorded and the side the successor moved. */
function triage(campaign, batteries, rows, rounds, reviewTimes) {
  const families = batteries.flatMap((battery, index) => {
    const packet = analysis(campaign, battery.runId, "rebuild-advice");
    const issues = records(isRecord(packet) ? packet.issues : []).filter(
      (issue) => issue.lastSeenRunId === battery.runId && issue.count > 0 && issue.retired !== true,
    );
    const next = batteries[index + 1] ?? null;
    return issues.map((issue) => {
      const review = reviewOf(campaign, battery.runId, issue.id);
      const operation = next === null ? null : (rows.get(next.runId)?.operation ?? null);
      const diagnosis = diagnosisOf(issue.diagnosis);
      const disputed = issue.dispute != null || review?.disputedThisIssue === true;
      const undiagnosed = issue.kind === "non-result" ? "environment" : "none";
      const side = disputed ? "evaluation" : (diagnosis?.side ?? undiagnosed);
      const wanted = REPAIR_OPERATION[side] ?? null;
      return {
        battery: battery.runId,
        family: issue.family,
        kind: issue.kind,
        detail: issue.detail ?? null,
        count: issue.count,
        denominator: issue.denominator ?? null,
        status: issueStatusWord({ ...issue, dispute: issue.dispute ?? null }),
        diagnosis,
        review,
        adviceWithheld: issue.dispute != null,
        triagedSide: side,
        successor: next?.runId ?? null,
        successorOperation: operation,
        repairedNamedSide: wanted === null || operation === null ? null : operation === wanted,
      };
    });
  });
  const gateCalls = rounds.flatMap((round) =>
    [...calls(round, PREVIEW), ...calls(round, "submit")].flatMap((c) =>
      c.at === null
        ? []
        : [{ tool: c.tool, reviewed: reviewTimes.some((t) => t >= round.start && t < c.at) }],
    ),
  );
  const count = (tool, reviewed) =>
    gateCalls.filter((c) => c.tool === tool && (reviewed === null || c.reviewed === reviewed)).length;
  const firstFailing = batteries.find((b) => {
    const row = rows.get(b.runId);
    return isRecord(row) && ((row.verified ?? 0) > (row.passed ?? 0) || (row.unaccepted ?? 0) > 0);
  });
  const firstReview = firstFailing === undefined ? undefined : reviewTimes.find((t) => t > firstFailing.at);
  return {
    families,
    timing: {
      previews: count(PREVIEW, null),
      previewsAfterReview: count(PREVIEW, true),
      submits: count("submit", null),
      submitsAfterReview: count("submit", true),
      firstFailingBattery: firstFailing?.runId ?? null,
      minutesToFirstReview:
        firstReview === undefined ? null : Math.round((firstReview - firstFailing.at) / 600) / 100,
    },
  };
}

/** The public inputs a battery measured, from the case bytes the solver received. */
function tasksOf(campaign, battery) {
  for (const root of campaignTraceRoots(campaign)) {
    const cases = join(root, "runs", battery, "cases");
    if (!existsSync(cases)) continue;
    return readdirSync(cases)
      .map((taskId) => readJsonFileOrNull(join(cases, taskId, "public-task.json")))
      .filter((row) => isRecord(row) && isRecord(row.publicTask))
      .map((row) => ({
        taskId: row.taskId,
        family: row.family,
        input: hashJsonValue(row.publicTask.publicInput ?? null),
      }));
  }
  return null;
}

export function classifyFamily(before, after) {
  if (before.length === 0) return "absent-before";
  if (after.length === 0) return "absent-after";
  const shared = after.filter((digest) => before.includes(digest)).length;
  if (shared === 0) return "name-only";
  return shared === after.length && before.length === after.length ? "identical-tasks" : "partially-shared";
}

/** Lane 18: consecutive batteries joined per family on public-input digests, and the advice
 *  transitions each join carried. */
function sameTask(campaign, batteries) {
  const inputs = new Map(batteries.map((b) => [b.runId, tasksOf(campaign, b.runId)]));
  const packets = new Map(batteries.map((b) => [b.runId, analysis(campaign, b.runId, "rebuild-advice")]));
  const pairs = batteries.slice(1).map((after, index) => {
    const before = batteries[index];
    const [a, b] = [inputs.get(before.runId), inputs.get(after.runId)];
    if (a === null || b === null) {
      return { before: before.runId, after: after.runId, families: null, transitions: [] };
    }
    const names = [...new Set([...a, ...b].map((t) => t.family))].sort();
    const digests = (tasks, family) => tasks.filter((t) => t.family === family).map((t) => t.input);
    const families = names.map((family) => ({
      family,
      join: classifyFamily(digests(a, family), digests(b, family)),
    }));
    const renamed = b.filter((t) => a.some((p) => p.input === t.input && p.family !== t.family)).length;
    const prior = new Map(records(packets.get(before.runId)?.issues).map((issue) => [issue.id, issue]));
    const transitions = records(packets.get(after.runId)?.issues)
      .filter((issue) => prior.has(issue.id))
      .map((issue) => {
        const from = issueStatusWord({ dispute: null, ...prior.get(issue.id) });
        const to = issueStatusWord({ dispute: null, ...issue });
        const familyJoin = families.find((f) => f.family === issue.family)?.join ?? null;
        return {
          family: issue.family,
          kind: issue.kind,
          from,
          to,
          join: familyJoin,
          onNamesAlone: familyJoin === "name-only" || familyJoin === "absent-after",
        };
      })
      .filter((transition) => transition.from !== transition.to);
    return { before: before.runId, after: after.runId, families, renamedTasks: renamed, transitions };
  });
  const issues = batteries.flatMap((b) => records(packets.get(b.runId)?.issues));
  const keyed = issues.filter(
    (issue) => issue.id === adviceIssueId(issue.kind, issue.family, issue.detail ?? null),
  ).length;
  return { pairs, producer: { issues: issues.length, familyKeyed: keyed } };
}

/**
 * @param {{ campaign: string, runId?: string | null }} target the campaign directory, and the run
 *   whose batteries and prompts to read, or null for every run the campaign recorded
 */
export function buildHandoffs({ campaign, runId = null }) {
  const batteries = batteriesOf(campaign, runId);
  const rows = decisionRows(campaign);
  const rounds = roundsOf(campaign, runId, batteries);
  if (rounds.length === 0 && batteries.length === 0) {
    return { schema: HANDOFFS_SCHEMA, state: "empty", reason: "no epoch and no claimed battery", runId };
  }
  return {
    schema: HANDOFFS_SCHEMA,
    state: "read",
    reason: null,
    runId,
    batteries: batteries.map((b) => b.runId),
    census: census(campaign, rounds),
    calibration: calibration(rounds, rows),
    triage: triage(campaign, batteries, rows, rounds, authoringReviewTimes(campaign)),
    sameTask: sameTask(campaign, batteries),
  };
}

const short = (runId) => (runId === null ? "none" : runId.replace(/^.*-(?=[0-9a-f]{6}(-i\d+)?$)/, ""));
const shown = (value) => (value === null ? "unobservable" : String(value));
/** One census letter: the letter when the fact holds, `-` when it does not, `·` when nothing records it. */
const mark = (fact, letter) => (fact === null ? "·" : fact ? letter : "-");

function renderCensus(report) {
  const lines = [
    "lane 17 round hand-off census (P present, S served, R read back, A acted; · no channel or no proxy)",
  ];
  lines.push(`  ${"channel".padEnd(15)}${report.census.map((r) => `r${r.round}`.padEnd(6)).join("")}`);
  for (const [i, channel] of CHANNELS.entries()) {
    lines.push(
      `  ${channel.name.padEnd(15)}${report.census
        .map(({ channels }) => {
          const c = channels[i];
          const read = c.read === null ? null : c.read > 0;
          return `${mark(c.present, "P")}${mark(c.served, "S")}${mark(read, "R")}${mark(c.acted, "A")}`.padEnd(
            6,
          );
        })
        .join("")}`,
    );
  }
  for (const round of report.census) {
    const unread = round.servedNotRead.map((u) => `${u.name} (${u.alternative})`).join("; ");
    lines.push(
      `  r${round.round} ${round.epoch}: bash ${shown(round.bashCalls)} (reads through it unobservable)${round.promptFound ? "" : "; kickoff prompt not found"}`,
    );
    if (unread !== "") lines.push(`    served, never read: ${unread}`);
  }
  return lines;
}

function renderCalibration({ calibration: c }) {
  const lines = ["lane 10 difficulty calibration"];
  for (const r of c.rounds) {
    const target = r.target === null ? "no target" : `${r.target.comparator} ${r.target.verifiedPasses}`;
    const b = r.beforeAuthoring;
    lines.push(
      `  r${r.round} ${short(r.battery)}: rehearsals ${r.rehearsals} [${r.rehearsalVerdicts.join(",")}]; ${target} -> ${shown(r.passed)}/${shown(r.verified)} (error ${shown(r.error)}, target ${shown(r.result)}); zone ${shown(r.zone)}; predictions ${r.predictions === null ? "unrecorded" : `expected ${r.predictions.expected} observed ${r.predictions.observed} brier ${r.predictions.brier} over ${r.predictions.scored}`}; before authoring: history ${b.history}, rehearsals ${b.rehearsals}, trace reads ${b.traceReads}`,
    );
  }
  lines.push(`  error trend ${c.errorTrend}; on-aim ${c.onAim} of ${c.placed} placed batteries`);
  return lines;
}

function renderTriage({ triage: t }) {
  const lines = ["lane 15 triage hand-off"];
  if (t.families.length === 0) lines.push("  no failing family in any advice packet");
  for (const f of t.families) {
    const d =
      f.diagnosis === null ? "no diagnosis" : `diagnosis ${f.diagnosis.owner} (${f.diagnosis.confidence})`;
    const r =
      f.review === null
        ? "no review"
        : `review ${f.review.status}: ${f.review.findings} findings, ${f.review.probes} probes (${f.review.unmovedProbes} moved no check), disputed ${f.review.disputedThisIssue}`;
    lines.push(
      `  ${short(f.battery)} ${f.family} ${f.kind}${f.detail ? `/${f.detail}` : ""} ${f.count}/${shown(f.denominator)} [${f.status}]: ${d}; ${r}; advice withheld ${f.adviceWithheld}; triaged ${f.triagedSide}; successor ${short(f.successor)} ${shown(f.successorOperation)}; named side repaired ${shown(f.repairedNamedSide)}`,
    );
  }
  const s = t.timing;
  lines.push(
    `  previews after a mid-round review ${s.previewsAfterReview}/${s.previews}; submits ${s.submitsAfterReview}/${s.submits}; ${s.firstFailingBattery === null ? "no battery failed a verified or unaccepted case" : `first failing battery ${short(s.firstFailingBattery)}, first authoring review ${shown(s.minutesToFirstReview)} min later`}`,
  );
  return lines;
}

function renderSameTask({ sameTask: s }) {
  const lines = ["lane 18 same-task repair"];
  for (const pair of s.pairs) {
    const head = `  ${short(pair.before)} -> ${short(pair.after)}:`;
    if (pair.families === null) {
      lines.push(`${head} case inputs unobservable`);
      continue;
    }
    const counts = {};
    for (const f of pair.families) counts[f.join] = (counts[f.join] ?? 0) + 1;
    const moved = pair.transitions
      .map((t) => `${t.family} ${t.from}->${t.to} on ${t.join}${t.onNamesAlone ? ", names alone" : ""}`)
      .join("; ");
    lines.push(
      `${head} ${Object.entries(counts)
        .map(([k, v]) => `${k} ${v}`)
        .join(
          ", ",
        )}; ${pair.renamedTasks} tasks reappear under another family name${moved ? `; ${moved}` : ""}`,
    );
  }
  lines.push(
    s.producer.issues === 0
      ? "  producer: no advice issue recorded, so no issue state rested on either join"
      : `  producer: ${s.producer.familyKeyed} of ${s.producer.issues} issue ids recompute from (kind, family, detail), so issue state follows the family name, not task identity`,
  );
  return lines;
}

export function renderHandoffs(report) {
  if (report.state !== "read") return `handoffs: ${report.state} (${report.reason})`;
  return [
    ...renderCensus(report),
    ...renderCalibration(report),
    ...renderTriage(report),
    ...renderSameTask(report),
  ].join("\n");
}
