import type { Reader } from "#src/audit/auditor.ts";
import { reviewDraft } from "#src/audit/draft-audit.ts";
import { stopRule } from "#src/campaign/admission.ts";
import { epochsOf, starterIn } from "#src/campaign/climb.ts";
import { openingOf } from "#src/campaign/opening.ts";
import { comparisonsOf } from "#src/campaign/state.ts";
import type { Draft } from "#src/examiner/draft.ts";
import type { ReviseRunner } from "#src/examiner/revise.ts";
import { frozenChecker } from "#src/kernel/acceptance.ts";
import { readAnswerFiles } from "#src/kernel/answer-files.ts";
import { hasJudge } from "#src/kernel/contract.ts";
import { contentOf, writtenTasks } from "#src/kernel/history.ts";
import {
  append,
  eventsOf,
  isReferenceChange,
  LOG_FILE,
  type LogEvent,
  read,
  TRACE_KINDS,
} from "#src/kernel/log.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { endedData, endedOf, latestBuilt, promoted } from "#src/kernel/reports.ts";
import { ranUnder, standsOf, verdictsOf } from "#src/kernel/solves.ts";
import { blockingOf, type Task, type Verifier } from "#src/kernel/verify.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import { parseArgs } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { keepReading } from "../eval/accept.ts";
import { type DraftAuditor, draftAuditGate } from "../eval/draft.ts";
import { lastLaunch, writeReceipt } from "../runs/receipt.ts";
import { SEED_FILE } from "../runs/registry.ts";
import { campaignLog, openCampaign } from "./campaign.ts";
import { draftReading } from "./exam.ts";
import { importHarness } from "./import.ts";
import { knownReviewer } from "./round.ts";

const REVISED = "exam.revised";
const COPY = { recursive: true, verbatimSymlinks: true } as const;

function revisionRefusal(events: readonly LogEvent[], repair: string | undefined): string | null {
  const comparisons = comparisonsOf(events);
  if (comparisons.some(({ reported }) => reported === null)) return "a comparison is still open";
  const [starter, changedAt] = [
    starterIn(events),
    events.findLastIndex(({ kind }) => isReferenceChange(kind)),
  ];
  const reference = promoted(events) ?? starter;
  const stepped = comparisons.some(
    ({ at, fresh, old, report }) =>
      at > changedAt &&
      report?.reading === "step" &&
      old === reference &&
      ![reference, starter].includes(fresh),
  );
  if (stepped) return "a promotion is pending";
  const epochs = epochsOf(events);
  const current = epochs.at(-1);
  const unconfirmed = current !== undefined && current.reference !== "starter" && current.confirmed !== true;
  if (unconfirmed && (repair === undefined || current.starter_tally !== null)) {
    return "the reference has not confirmed against the starter; until it does, only a check-defect repair is permitted";
  }
  if (repair === undefined) {
    return openingOf(events)?.parent?.carried.tunedThisEpoch === true && epochs.length === 1
      ? "this epoch opened from a tune; earn a promotion before tuning again, or repair a check-defect"
      : null;
  }
  return defectsOn(events, repair).length > 0 ? null : `no standing check-defect ruling names ${repair}`;
}

function defectsOn(events: readonly LogEvent[], repair: string): string[] {
  const stands = standsOf(events);
  const solves = eventsOf(events, "referee.finding").flatMap(({ event: { data } }) =>
    data.check === repair && isString(data.solve) && stands.get(data.solve) === "check-defect"
      ? [data.solve]
      : [],
  );
  return [...new Set(solves)];
}

interface RevisionSetup {
  readonly log: string;
  readonly parentBundle: string;
  readonly packages: () => Map<string, Task>;
  readonly reader: Reader | null;
  readonly auditor?: DraftAuditor | null | undefined;
  readonly kill?: AbortSignal | undefined;
}

async function witnessed(
  setup: Pick<RevisionSetup, "log" | "packages" | "kill">,
  events: readonly LogEvent[],
  verify: Verifier,
  repair?: string,
) {
  const packages = setup.packages();
  const verdicts = verdictsOf(events);
  const versionOf = new Map(ranUnder(events).map(({ id, under }) => [id, under.task]));
  const replay = async (solve: string, kind: string) => {
    const verdict = verdicts.get(solve);
    const task =
      packages.get(versionOf.get(solve) ?? "") ??
      [...packages.values()].find(({ taskId }) => taskId === verdict?.task);
    if (verdict?.answer === undefined || task === undefined) {
      return `${kind} witness on ${verdict?.task ?? "an unknown task"} could not be loaded`;
    }
    const files =
      (verdict.files ?? []).length > 0 ? readAnswerFiles(setup.log, verdict.files ?? []) : undefined;
    const result = await verify(task, verdict.answer, setup.kill, files);
    if (result.kind === "faulty" || result.kind === "non-result") {
      return `${kind} witness on ${task.taskId} faulted under the candidate: ${result.reason}`;
    }
    const blocking = verdict.checker?.kind === "fail" ? verdict.checker.blocking : [];
    return { task: task.taskId, blocking, now: result.kind === "fail" ? result.blocking : null };
  };
  const earned = [...standsOf(events)].flatMap(([solve, ruling]) =>
    ruling === "solver-fail" && blockingOf(verdicts.get(solve)?.checker).length > 0 ? [solve] : [],
  );
  const rows = await pooled(earned, 4, async (solve) => {
    const row = await replay(solve, "earned");
    if (isString(row)) return row;
    const { task, blocking, now } = row;
    const untouched = blocking.filter((id) => id !== repair);
    const sole = blocking.length > 0 && untouched.length === 0;
    if (sole) return now?.includes(repair ?? "") === true ? null : "flipped";
    return now !== null && (untouched.length === 0 || untouched.some((id) => now.includes(id)))
      ? null
      : `earned witness on ${task} is no longer refused by ${untouched.join(", ") || "the checks"} (${now === null ? "pass" : "fail"})`;
  });
  const flipped = rows.filter((row) => row === "flipped").length;
  const note = `${String(flipped)} historical earned witness(es) solely on repaired check ${String(repair)} now pass; probe ${String(repair)} to verify it still enforces its published rule without over-relaxing.`;
  const faults = rows.filter((row): row is string => row !== null && row !== "flipped");
  if (repair !== undefined) {
    const defects = await pooled(defectsOn(events, repair), 4, (solve) => replay(solve, "check-defect"));
    const uncleared = defects.flatMap((row) => {
      if (isString(row)) return [row];
      const sole = row.blocking.length === 1 && row.blocking[0] === repair;
      return row.now !== null && (sole || row.now.includes(repair)) ? [row.task] : [];
    });
    if (uncleared.length > 0) {
      faults.push(
        `the repair leaves ${String(uncleared.length)} of ${String(defects.length)} check-defect witnesses on ${repair} refused or unloaded (${[...new Set(uncleared)].join(", ")})`,
      );
    }
  }
  return { faults, notes: flipped === 0 ? [] : [note] };
}

const failed = (head: string, faults: readonly string[]) => ({
  accepted: false,
  message: [`${head} (${String(faults.length)} faults):`, ...faults.map((fault) => `- ${fault}`)].join("\n"),
});

const refused = (why: string) => ({ accepted: false, message: `Refused: ${why}` });

async function examined(
  setup: Pick<RevisionSetup, "log" | "packages" | "kill">,
  events: readonly LogEvent[],
  candidate: Draft,
  repair: string | undefined,
  tools: string | undefined,
) {
  const early = revisionRefusal(events, repair);
  if (early !== null) return { fault: refused(early) };
  const revisions = join(dirname(setup.log), "revisions");
  const { read: seen, faults } = await draftReading(revisions, candidate, 4, tools);
  if (seen === undefined || faults.length > 0) {
    return { fault: failed("Revision failed checker validation", faults) };
  }
  const replayed = await witnessed(setup, events, seen.verify, repair);
  if (replayed.faults.length > 0) {
    return { fault: failed("Revision failed historical witness checks", replayed.faults) };
  }
  return { seen, notes: replayed.notes };
}

export function revisionRunner(config: RevisionSetup): ReviseRunner {
  const { log, kill } = config;
  return async ({ session, why, repair, candidate, home }) => {
    const events = read(log, TRACE_KINDS);
    const frozen = frozenChecker(events);
    if (frozen === null) return refused("the exam is not drafted and frozen");
    const tools = [home, config.parentBundle].find(
      (dir) => dir !== undefined && existsSync(join(dir, TOOL_TREE_DIR)),
    );
    const checked = await examined(config, events, candidate, repair, tools);
    if ("fault" in checked) return checked.fault;
    const { seen, notes } = checked;
    const found = await draftAuditGate({
      session,
      prompt: openingOf(events)?.prompt ?? "",
      log,
      auditor: config.auditor === undefined ? reviewDraft : config.auditor,
      reader: config.reader,
      revision: frozen.checks,
      required: true,
    })({ ...seen, reading: { ...seen.reading, notes: [...seen.reading.notes, ...notes] } });
    if (found.length > 0) {
      return failed("Revision failed adversarial audit", found);
    }
    if (kill?.aborted === true) return refused("session cancelled");
    const revised = {
      session,
      kind: repair === undefined ? "tune" : "repair",
      why,
      ...keyIfDefined("check", repair),
      parent: { checks: frozen.checks },
      draft: parseJsonAs<JsonObject>(capturedJsonStringify(candidate)),
      draftHash: hashJsonValue(candidate),
    };
    if (openingOf(events)?.attended === true) {
      const short = revised.draftHash.slice(0, 16);
      mkdirSync(join(dirname(log), "revisions"), { recursive: true });
      writeFileSync(join(dirname(log), "revisions", `${short}.json`), `${capturedJsonStringify(revised)}\n`);
      return {
        accepted: false,
        message: `The revision passed validation and audit and awaits operator approval under --hitl: bun tools/campaign/revise.ts --name ${basename(dirname(log))} --candidate ${short} --freeze`,
      };
    }
    append(log, REVISED, revised);
    return { accepted: true, message: "The exam revision stands; a successor campaign continues under it." };
  };
}

export async function freezeCandidate(log: string, candidate: string, packages: () => Map<string, Task>) {
  const file = join(dirname(log), "revisions", `${candidate}.json`);
  if (!/^[a-f0-9]{16}$/u.test(candidate) || !existsSync(file)) {
    throw new Error(`no staged revision candidate ${candidate} at ${file}`);
  }
  const staged = parseJsonAs<JsonObject>(readFileSync(file, "utf8"));
  const record = asRecord(staged.draft);
  // SAFETY: the runner staged this record from a draft that passed `draftReading`; its hash is checked next.
  const draft = record === null ? null : parseJsonAs<Draft>(record);
  const hash = draft === null ? null : hashJsonValue(draft);
  if (draft === null || hash !== staged.draftHash || hash?.startsWith(candidate) !== true) {
    throw new Error(`candidate ${candidate} does not hash to its name`);
  }
  const events = read(log, TRACE_KINDS);
  const frozen = frozenChecker(events);
  if (frozen === null || asRecord(staged.parent)?.checks !== frozen.checks) {
    throw new Error(`candidate ${candidate} was not staged against the frozen checks`);
  }
  const reviewer = openingOf(events)?.seats.reviewer ?? null;
  if (hasJudge(draft.objective) && (reviewer === null || !knownReviewer(reviewer.model))) {
    throw new Error(
      `candidate ${candidate} scores judged items, and the campaign seats no first-party judging reviewer to compare them`,
    );
  }
  const repair = isString(staged.check) ? staged.check : undefined;
  const bundle = join(dirname(log), "revisions", "exams", candidate, "bundle");
  const tools = existsSync(join(bundle, TOOL_TREE_DIR)) ? bundle : undefined;
  const checked = await examined({ log, packages }, events, draft, repair, tools);
  if ("fault" in checked) throw new Error(checked.fault.message);
  const sound = eventsOf(events, "referee.draft").some(
    ({ event: { data } }) =>
      data.verdict === "sound" &&
      data.revision === frozen.checks &&
      data.session === staged.session &&
      data.audited === checked.seen.checker.checks,
  );
  if (!sound) throw new Error(`candidate ${candidate} has no sound audit of its own checks on record`);
  append(log, REVISED, staged);
  return await openSuccessor(log);
}

export function successorName(name: string): string {
  const match = /^(.*)-rev(\d+)$/u.exec(name);
  return match === null ? `${name}-rev2` : `${match[1] ?? name}-rev${String(Number(match[2]) + 1)}`;
}

export function withFlag(flags: readonly string[], flag: string, value: string): string[] {
  const out = flags.map((word, at) =>
    word.startsWith(`${flag}=`) ? `${flag}=${value}` : flags[at - 1] === flag ? value : word,
  );
  return out.some((word) => word === flag || word.startsWith(`${flag}=`)) ? out : [...out, flag, value];
}

function successorOpening(eventsA: readonly LogEvent[], nameA: string, revised: JsonObject, draft: Draft) {
  const { answers: _answers, ...base } = eventsOf(eventsA, "campaign.opened").at(-1)?.event.data ?? {};
  const prior = openingOf(eventsA)?.parent ?? null;
  const epochs = epochsOf(eventsA);
  const attempts = epochs.reduce((sum, { falsePromotion }) => sum + falsePromotion.attempts, 0);
  const tasks = [...writtenTasks(eventsA), ...draft.tasks].map(contentOf);
  return {
    ...base,
    parent: {
      campaign: nameA,
      revised: revised.draftHash ?? null,
      kind: revised.kind ?? null,
      carried: {
        spent: (prior?.carried.spent ?? 0) + billedAll(eventsA),
        sinceStep: stopRule(eventsA).sinceStep,
        attempts: (prior?.carried.attempts ?? 0) + attempts,
        tunedThisEpoch:
          revised.kind === "tune" || (epochs.length === 1 && prior?.carried.tunedThisEpoch === true),
      },
      lineageTasks: [...new Set([...(prior?.lineageTasks ?? []), ...tasks])],
    },
  };
}

async function buildSuccessor(logA: string, logB: string, revised: JsonObject, remainingMoves?: number) {
  const eventsA = read(logA, TRACE_KINDS);
  const [dirA, dirB] = [dirname(logA), dirname(logB)];
  // SAFETY: `openSuccessor` has checked that `revised.draft` is a record before this runs.
  const draft = parseJsonAs<Draft>(revised.draft as JsonObject);
  append(logB, "campaign.opened", successorOpening(eventsA, basename(dirA), revised, draft));
  const setting = eventsOf(eventsA, "campaign.setting").at(-1)?.event.data;
  if (setting !== undefined) append(logB, "campaign.setting", setting);
  for (const each of ["examiner-home", "memory", SEED_FILE]) {
    if (existsSync(join(dirA, each))) cpSync(join(dirA, each), join(dirB, each), COPY);
  }
  const bundle = join(dirA, "revisions", "exams", hashJsonValue(draft).slice(0, 16), "bundle");
  const tools = [bundle, join(dirA, "examiner-home")].find((dir) => existsSync(dir));
  const { faults, read: seen } = await draftReading(dirB, draft, 4, tools);
  if (seen === undefined || faults.length > 0) {
    throw new Error(`the successor's checker reading faulted: ${faults.join("; ")}`);
  }
  const from = { campaign: basename(dirA), draftHash: revised.draftHash ?? null };
  append(logB, "exam.drafted", { session: "rev", from, draft: revised.draft ?? null });
  const word = {
    admitted: new Set<string>(),
    authored: true,
    judge: hasJudge(draft.objective),
    freeze: true,
    despite: "",
  };
  keepReading(logB, seen.checker, seen.reading, word);
  const kept = promoted(eventsA) ?? latestBuilt(eventsA);
  if (kept !== null && existsSync(join(dirA, "states", kept))) {
    const why = `carried from ${basename(dirA)} after exam revision`;
    const { digest } = await importHarness(logB, join(dirA, "states", kept), why);
    append(logB, "build.checkpoint", { session: "rev", harness: digest });
  }
  const receipt = lastLaunch(logA);
  if (receipt === undefined) return;
  const { session: _session, ...rest } = receipt;
  const named = withFlag(receipt.flags, "--name", successorName(basename(dirA)));
  const moves =
    remainingMoves !== undefined && Number.isFinite(remainingMoves) ? Math.max(0, remainingMoves) : null;
  const flags = moves === null ? named : withFlag(named, "--moves", String(moves));
  writeReceipt(logB, "run-1", { ...rest, at: new Date().toISOString(), flags });
}

export async function openSuccessor(logA: string, remainingMoves?: number) {
  const eventsA = read(logA, TRACE_KINDS);
  const revised = eventsOf(eventsA, REVISED).at(-1)?.event.data;
  if (revised === undefined || asRecord(revised.draft) === null || !isString(revised.why)) {
    throw new Error("cannot open successor campaign: log holds no valid exam.revised event");
  }
  const nameA = basename(dirname(logA));
  const nameB = successorName(nameA);
  const logB = join(dirname(dirname(logA)), nameB, LOG_FILE);
  if (!existsSync(logB)) {
    const staging = join(dirname(logA), `successor-${crypto.randomUUID()}`);
    mkdirSync(staging);
    try {
      await buildSuccessor(logA, join(staging, LOG_FILE), revised, remainingMoves);
      renameSync(staging, dirname(logB));
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      if (!existsSync(logB)) throw error;
    }
  }
  const parent = openingOf(read(logB, TRACE_KINDS))?.parent;
  if (parent?.campaign !== nameA || parent.revised !== revised.draftHash) {
    throw new Error(
      `refusing to adopt existing campaign at ${logB}: its opening does not match parent ${nameA}`,
    );
  }
  if (endedOf(read(logA, TRACE_KINDS))?.ending !== "revise") {
    append(logA, "campaign.ended", {
      ...endedData(eventsA, { ending: "revise", why: revised.why }),
      successor: nameB,
    });
  }
  return { name: nameB, log: logB };
}

async function reviseCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: { name: { type: "string" }, candidate: { type: "string" }, freeze: { type: "boolean" } },
  });
  if (values.name === undefined || values.candidate === undefined || values.freeze !== true) {
    throw new Error("usage: bun tools/campaign/revise.ts --name <campaign> --candidate <hash> --freeze");
  }
  const campaign = await openCampaign({ name: values.name });
  const next = await freezeCandidate(campaignLog(values.name), values.candidate, campaign.packages);
  console.log(`revision frozen; successor campaign ${next.name} opened at ${next.log}`);
}

if (import.meta.main) await reviseCommand(Bun.argv.slice(2));
