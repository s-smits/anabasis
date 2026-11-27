import { stopRule } from "#src/campaign/admission.ts";
import { epochsOf } from "#src/campaign/climb.ts";
import { isRevisionKind, openingOf, type RevisionKind } from "#src/campaign/opening.ts";
import { type Draft, draftOf } from "#src/examiner/draft.ts";
import { hasJudge } from "#src/kernel/contract.ts";
import { contentOf, writtenTasks } from "#src/kernel/history.ts";
import { append, eventsOf, LOG_FILE, type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { endedData, endedOf, latestBuilt, promoted } from "#src/kernel/reports.ts";
import { cpSync, existsSync, mkdirSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { keepReading } from "../eval/accept.ts";
import { lastLaunch, writeReceipt } from "../runs/receipt.ts";
import { SEED_FILE } from "../runs/registry.ts";
import { draftReading, stageExam } from "./exam.ts";
import { importHarness } from "./import.ts";

const REV_SUFFIX = /^(.*)-rev(\d+)$/u;
const COPY_OPTS = { recursive: true, verbatimSymlinks: true } as const;

export function successorName(name: string): string {
  const match = REV_SUFFIX.exec(name);
  if (match === null) return `${name}-rev2`;
  const [, prefix = name, raw = "2"] = match;
  return `${prefix}-rev${String(Number(raw) + 1)}`;
}

export function rewriteNameFlag(flags: readonly string[], from: string, to: string): string[] {
  const out: string[] = [];
  for (let at = 0; at < flags.length; at += 1) {
    const word = flags[at] ?? "";
    if (word === `--name=${from}`) {
      out.push(`--name=${to}`);
    } else if (word === "--name" && flags[at + 1] === from) {
      out.push("--name", to);
      at += 1;
    } else {
      out.push(word);
    }
  }
  return out;
}

function revisionEvent(events: readonly LogEvent[]): {
  readonly kind: RevisionKind;
  readonly why: string;
  readonly draftHash: string;
  readonly draftObj: JsonObject;
  readonly draft: Draft;
} {
  const data = eventsOf(events, "exam.revised").at(-1)?.event.data;
  const draftRaw = asRecord(data?.draft);
  const kind = data?.kind;
  if (
    data === undefined ||
    draftRaw === null ||
    !isString(data.draftHash) ||
    !isString(data.why) ||
    !isRevisionKind(kind)
  ) {
    throw new Error("cannot open successor campaign: log holds no valid exam.revised event");
  }
  return {
    kind,
    why: data.why,
    draftHash: data.draftHash,
    draftObj: draftRaw,
    draft: parseJsonAs<Draft>(draftRaw),
  };
}

function carriedFrom(eventsA: readonly LogEvent[], kind: RevisionKind) {
  const prior = openingOf(eventsA)?.parent?.carried;
  const attempts = epochsOf(eventsA).reduce((sum, epoch) => sum + epoch.falsePromotion.attempts, 0);
  return {
    spent: (prior?.spent ?? 0) + billedAll(eventsA),
    sinceStep: stopRule(eventsA).sinceStep,
    attempts: (prior?.attempts ?? 0) + attempts,
    tunes: (prior?.tunes ?? 0) + (kind === "tune" ? 1 : 0),
  };
}

function lineageFrom(eventsA: readonly LogEvent[], nextDraft: Draft): string[] {
  const prior = openingOf(eventsA)?.parent?.lineageTasks ?? [];
  const parentExamples = draftOf(eventsA)?.tasks ?? [];
  return [
    ...new Set([
      ...prior,
      ...writtenTasks(eventsA).map(contentOf),
      ...parentExamples.map(contentOf),
      ...nextDraft.tasks.map(contentOf),
    ]),
  ];
}

function copyTreeIfMissing(from: string, to: string): void {
  if (existsSync(from) && !existsSync(to)) cpSync(from, to, COPY_OPTS);
}

function writeSuccessorOpening(
  logB: string,
  eventsA: readonly LogEvent[],
  eventsB: readonly LogEvent[],
  nameA: string,
  rev: ReturnType<typeof revisionEvent>,
): void {
  if (eventsOf(eventsB, "campaign.opened").length === 0) {
    const { answers: _answers, ...base } = eventsOf(eventsA, "campaign.opened").at(-1)?.event.data ?? {};
    append(logB, "campaign.opened", {
      ...base,
      parent: {
        campaign: nameA,
        revised: rev.draftHash,
        kind: rev.kind,
        carried: carriedFrom(eventsA, rev.kind),
        lineageTasks: lineageFrom(eventsA, rev.draft),
      },
    });
  }
  if (eventsOf(eventsB, "campaign.setting").length === 0) {
    const setting = eventsOf(eventsA, "campaign.setting").at(-1)?.event.data;
    if (setting !== undefined) append(logB, "campaign.setting", { ...setting });
  }
}

export async function openSuccessor(logA: string): Promise<{ readonly name: string; readonly log: string }> {
  const eventsA = read(logA, TRACE_KINDS);
  const rev = revisionEvent(eventsA);
  const dirA = dirname(logA);
  const nameA = basename(dirA);
  const nameB = successorName(nameA);
  const dirB = join(dirname(dirA), nameB);
  const logB = join(dirB, LOG_FILE);
  mkdirSync(dirB, { recursive: true });
  const eventsB = existsSync(logB) ? read(logB, TRACE_KINDS) : [];
  writeSuccessorOpening(logB, eventsA, eventsB, nameA, rev);
  copyTreeIfMissing(join(dirA, "examiner-home"), join(dirB, "examiner-home"));
  copyTreeIfMissing(join(dirA, "memory"), join(dirB, "memory"));
  copyTreeIfMissing(join(dirA, SEED_FILE), join(dirB, SEED_FILE));
  const stagedTools = join(dirA, "revisions", "exams", hashJsonValue(rev.draft).slice(0, 16), "bundle");
  const sourceHome = existsSync(stagedTools)
    ? stagedTools
    : existsSync(join(dirA, "examiner-home"))
      ? join(dirA, "examiner-home")
      : undefined;
  stageExam(dirB, rev.draft, sourceHome);
  if (eventsOf(eventsB, "exam.drafted").length === 0) {
    append(logB, "exam.drafted", {
      session: "rev",
      from: { campaign: nameA, draftHash: rev.draftHash },
      draft: rev.draftObj,
    });
  }
  if (eventsOf(eventsB, "contract.frozen").length === 0) {
    const { faults, read: seen } = await draftReading(dirB, rev.draft, 4);
    if (faults.length > 0 || seen === undefined) {
      throw new Error(`successor ${nameB} failed checker reading: ${faults.join("; ")}`);
    }
    keepReading(logB, seen.checker, seen.reading, {
      admitted: new Set(),
      authored: true,
      judge: hasJudge(rev.draft.objective),
      freeze: true,
      despite: "",
    });
  }
  const carriedHarness = promoted(eventsA) ?? latestBuilt(eventsA);
  const harnessDir = carriedHarness === null ? null : join(dirA, "states", carriedHarness);
  if (carriedHarness !== null && harnessDir !== null && existsSync(harnessDir)) {
    const imported = await importHarness(logB, harnessDir, `carried from ${nameA} after exam revision`);
    if (latestBuilt(read(logB, TRACE_KINDS)) !== imported.digest) {
      append(logB, "build.checkpoint", { session: "rev", harness: imported.digest });
    }
  }
  const receiptA = lastLaunch(logA);
  if (receiptA !== undefined && lastLaunch(logB) === undefined) {
    const { session: _session, ...kept } = receiptA;
    writeReceipt(logB, "run-1", {
      ...kept,
      at: new Date().toISOString(),
      flags: rewriteNameFlag(receiptA.flags, nameA, nameB),
    });
  }
  if (endedOf(eventsA)?.ending !== "revise") {
    append(logA, "campaign.ended", {
      ...endedData(eventsA, { ending: "revise", why: rev.why }),
      successor: nameB,
    });
  }
  return { name: nameB, log: logB };
}
