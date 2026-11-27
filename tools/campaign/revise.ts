import type { ThinkingLevel } from "@earendil-works/pi-ai";
import {
  type DraftAuditCase,
  type DraftAuditFinding,
  formatDraftFinding,
  persistedDraftDefects,
  replayDraftProbes,
  reviewDraft,
} from "#src/audit/draft-audit.ts";
import type { Reader } from "#src/audit/auditor.ts";
import { refuseNamingHome } from "#src/builder/store.ts";
import { openingOf, type RevisionKind } from "#src/campaign/opening.ts";
import { type Draft, draftOf } from "#src/examiner/draft.ts";
import { defectSolvesFor, type ReviseRunner, revisionFaults, revisionRefusal } from "#src/examiner/revise.ts";
import { frozenChecker } from "#src/kernel/acceptance.ts";
import { readAnswerFiles } from "#src/kernel/answer-files.ts";
import { append, eventsOf, type LogEvent, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { standsOf, verdictsOf } from "#src/kernel/solves.ts";
import { blockingOf, decides, type Task, type Verifier } from "#src/kernel/verify.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { pooled } from "#src/meta/pool.ts";
import { parseArgs } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { campaignLog, examinerSession, openCampaign } from "./campaign.ts";
import { draftReading } from "./exam.ts";
import { crossFamilyVendors } from "./round.ts";
import { openSuccessor } from "./successor.ts";

export type RevisionAuditor = (reader: Reader, target: DraftAuditCase) => Promise<DraftAuditFinding>;

const MAX_REVISION_AUDITS = 3;

type Asked = Omit<Parameters<ReviseRunner>[0], "home">;
type Seen = NonNullable<Awaited<ReturnType<typeof draftReading>>["read"]>;

interface WitnessSummary {
  readonly earnedChecked: number;
  readonly earnedRetained: number;
  readonly defectChecked: number;
  readonly defectCleared: number;
}

interface Checked {
  readonly seen: Seen;
  readonly notes: readonly string[];
  readonly witnesses: WitnessSummary;
}

interface RevisionRecord {
  readonly session: string;
  readonly kind: RevisionKind;
  readonly why: string;
  readonly check?: string;
  readonly parent: { readonly draft: string; readonly checks: string };
  readonly draft: Draft;
  readonly draftHash: string;
  readonly checker: { readonly contract: string; readonly checks: string };
  readonly reading: { readonly faults: readonly string[]; readonly notes: readonly string[] };
  readonly audit: { readonly session: string; readonly verdict: "sound" };
  readonly witnesses: WitnessSummary;
}

const listed = (head: string, faults: readonly string[]): string =>
  [`${head} (${String(faults.length)} faults):`, ...faults.map((fault) => `- ${fault}`)].join("\n");

function frozenParent(events: readonly LogEvent[]): { readonly draft: Draft; readonly checks: string } {
  const draft = draftOf(events);
  const frozen = frozenChecker(events);
  if (draft === null || frozen === null) throw new Error("parent exam is missing or unfrozen");
  return { draft, checks: frozen.checks };
}

async function withMergedToolchain<T>(
  parentBundle: string,
  examinerHome: string | undefined,
  run: (sourceHome: string) => Promise<T>,
): Promise<T> {
  const scratch = mkdtempSync(join(tmpdir(), "ana-rev-tools-"));
  const target = join(scratch, TOOL_TREE_DIR);
  try {
    cpSync(join(parentBundle, TOOL_TREE_DIR), target, { recursive: true, verbatimSymlinks: true });
    if (examinerHome !== undefined && existsSync(join(examinerHome, TOOL_TREE_DIR))) {
      cpSync(join(examinerHome, TOOL_TREE_DIR), target, { recursive: true, verbatimSymlinks: true });
      refuseNamingHome(target, examinerHome, TOOL_TREE_DIR);
    }
    return await run(scratch);
  } finally {
    rmSync(scratch, { recursive: true });
  }
}

interface Witness {
  readonly task: string;
  readonly before: readonly string[];
  readonly after: readonly string[];
}

function witnessRunner(input: {
  readonly log: string;
  readonly events: readonly LogEvent[];
  readonly packages: ReadonlyMap<string, Task>;
  readonly verify: Verifier;
  readonly kill?: AbortSignal | undefined;
  readonly faults: string[];
}) {
  const { log, verify, kill, faults } = input;
  const verdicts = verdictsOf(input.events);
  const byTaskId = new Map([...input.packages.values()].map((entry) => [entry.taskId, entry] as const));
  return async (ids: readonly string[], label: string): Promise<Witness[]> => {
    const loaded = ids.flatMap((solve) => {
      const verdict = verdicts.get(solve);
      const taskId = verdict?.task ?? null;
      const named = taskId === null ? "" : ` on ${taskId}`;
      const task = taskId === null ? undefined : byTaskId.get(taskId);
      if (verdict === undefined || task === undefined) {
        faults.push(`${label} witness${named} could not be loaded (missing task package)`);
        return [];
      }
      const before = blockingOf(verdict.checker);
      try {
        const files = readAnswerFiles(log, verdict.files ?? []);
        return before.length === 0 ? [] : [{ task, answer: verdict.answer, files, before }];
      } catch {
        faults.push(`${label} witness${named} deliverable files could not be read`);
        return [];
      }
    });
    const ran = await pooled(loaded, 4, async ({ task, answer, files, before }) => ({
      task,
      before,
      result: await verify(task, answer, kill, files),
    }));
    return ran.flatMap(({ task, before, result }) => {
      if (decides(result)) return [{ task: task.taskId, before, after: blockingOf(result) }];
      faults.push(`${label} witness on ${task.taskId} faulted under candidate: ${result.reason}`);
      return [];
    });
  };
}

async function verifyWitnesses(input: {
  readonly log: string;
  readonly events: readonly LogEvent[];
  readonly packages: ReadonlyMap<string, Task>;
  readonly verify: Verifier;
  readonly repaired: string | undefined;
  readonly kill?: AbortSignal | undefined;
}): Promise<{
  readonly faults: readonly string[];
  readonly notes: readonly string[];
  readonly summary: WitnessSummary;
}> {
  const { events, repaired } = input;
  const faults: string[] = [];
  const notes: string[] = [];
  const rerun = witnessRunner({ ...input, faults });
  const untouched = (before: readonly string[]) => before.filter((id) => id !== repaired);
  const earned = await rerun(
    [...standsOf(events).entries()].flatMap(([id, ruling]) => (ruling === "earned" ? [id] : [])),
    "earned Referee",
  );
  let [earnedRetained, flips] = [0, 0];
  for (const { task, before, after } of earned) {
    const left = untouched(before);
    const guarding = left.length === 0 ? before : left;
    if (after.some((id) => guarding.includes(id))) earnedRetained += 1;
    else if (left.length === 0) flips += 1;
    else if (after.length === 0) faults.push(`earned Referee witness on ${task} no longer fails`);
    else {
      faults.push(
        `earned Referee witness on ${task} is no longer blocked by any untouched check (${left.join(", ")})`,
      );
    }
  }
  if (flips > 0) {
    notes.push(
      `${String(flips)} historical earned witness${flips === 1 ? "" : "es"} solely on repaired check ${String(repaired)} now pass; probe ${String(repaired)} to verify it still enforces its published rule without over-relaxing.`,
    );
  }
  const summary = { earnedChecked: earned.length, earnedRetained, defectChecked: 0, defectCleared: 0 };
  if (repaired === undefined) return { faults, notes, summary };
  const defects = await rerun(defectSolvesFor(events, repaired), "check-defect");
  const uncleared = defects.filter(
    ({ before, after }) => after.length > 0 && (untouched(before).length === 0 || after.includes(repaired)),
  );
  if (uncleared.length === defects.length) {
    faults.push(`repair candidate did not clear any check-defect witness for ${repaired}`);
  } else if (uncleared.length > 0) {
    faults.push(
      `repair candidate left ${String(uncleared.length)}/${String(defects.length)} check-defect witnesses uncleared for ${repaired} (tasks: ${[...new Set(uncleared.map(({ task }) => task))].join(", ")})`,
    );
  }
  return {
    faults,
    notes,
    summary: { ...summary, defectChecked: defects.length, defectCleared: defects.length - uncleared.length },
  };
}

function revisionReader(model: string, effort: string): Reader {
  return {
    model: modelNamed(model),
    // SAFETY: effort is validated by the backend on call.
    effort: effort as ThinkingLevel,
    models: examinerSession,
  };
}

async function auditRevision(input: {
  readonly log: string;
  readonly session: string;
  readonly parentChecks: string;
  readonly prompt: string;
  readonly checked: Checked;
  readonly auditor: RevisionAuditor;
  readonly reader: Reader;
}): Promise<string | null> {
  const { log, session, parentChecks, prompt, checked, auditor, reader } = input;
  const { seen } = checked;
  const seeded = persistedDraftDefects(read(log, TRACE_KINDS), parentChecks);
  const [verifiedFixed, unverified]: [string[], string[]] = [[], []];
  for (const prior of seeded.prior) {
    const replay = await replayDraftProbes(prior, {
      contract: seen.contract,
      verify: seen.verify,
      tasks: seen.tasks,
      controls: seen.controls,
    });
    if (replay.stillBroken.length > 0) {
      return [
        "Revision failed prior audit defect probes:",
        ...replay.stillBroken.map((fault) => `- ${fault}`),
      ].join("\n");
    }
    verifiedFixed.push(...replay.verifiedFixed);
    unverified.push(...replay.unverified);
  }
  if (seeded.audits >= MAX_REVISION_AUDITS) {
    return `Refused: revision audit cap (${String(MAX_REVISION_AUDITS)}) reached without a sound audit${unverified.length > 0 ? ` (${String(unverified.length)} unverified prior defect findings)` : ""}.`;
  }
  const review = await auditor(reader, {
    session,
    pass: seeded.audits + 1,
    revision: parentChecks,
    prompt,
    contract: seen.contract,
    checks: seen.checks,
    verify: seen.verify,
    tasks: seen.tasks,
    controls: seen.controls,
    notes: [...seen.reading.notes, ...checked.notes],
    priorFindings: unverified,
    verifiedFixed,
    log,
  });
  if (review.verdict === "skipped") {
    return `Refused: adversarial audit skipped (${review.error ?? "reviewer unavailable"}); revision not committed.`;
  }
  if (review.verdict === "defects") {
    return [
      "Revision failed adversarial audit:",
      ...review.findings.map((finding) => `- ${formatDraftFinding(finding)}`),
    ].join("\n");
  }
  return null;
}

async function validated(input: {
  readonly log: string;
  readonly events: readonly LogEvent[];
  readonly asked: Asked;
  readonly packages: ReadonlyMap<string, Task>;
  readonly sourceHome?: string | undefined;
  readonly kill?: AbortSignal | undefined;
}): Promise<string | Checked> {
  const { log, asked, sourceHome } = input;
  const staged = await draftReading(join(dirname(log), "revisions"), asked.candidate, 4, sourceHome);
  if (staged.read === undefined || staged.faults.length > 0) {
    return listed("Revision failed checker validation", staged.faults);
  }
  const witnessed = await verifyWitnesses({
    log,
    events: input.events,
    packages: input.packages,
    kill: input.kill,
    verify: staged.read.verify,
    repaired: asked.kind === "repair" ? asked.check : undefined,
  });
  return witnessed.faults.length > 0
    ? listed("Revision failed historical witness checks", witnessed.faults)
    : { seen: staged.read, notes: witnessed.notes, witnesses: witnessed.summary };
}

function recordOf(
  asked: Asked,
  events: readonly LogEvent[],
  checked: Checked,
  audited: string,
): RevisionRecord {
  const parent = frozenParent(events);
  const { seen } = checked;
  return {
    session: asked.session,
    kind: asked.kind,
    why: asked.why,
    ...keyIfDefined("check", asked.check),
    parent: { draft: hashJsonValue(parent.draft), checks: parent.checks },
    draft: asked.candidate,
    draftHash: hashJsonValue(asked.candidate),
    checker: seen.checker,
    reading: { faults: [...seen.reading.faults], notes: [...seen.reading.notes] },
    audit: { session: audited, verdict: "sound" },
    witnesses: checked.witnesses,
  };
}

const recorded = (record: RevisionRecord): JsonObject =>
  parseJsonAs<JsonObject>(capturedJsonStringify(record));

export function revisionRunner(config: {
  readonly log: string;
  readonly parentBundle: string;
  readonly packages: () => Map<string, Task>;
  readonly reviewer?: { readonly model?: string | undefined; readonly effort?: string | undefined };
  readonly auditor?: RevisionAuditor | undefined;
  readonly kill?: AbortSignal | undefined;
}): ReviseRunner {
  const auditor = config.auditor ?? reviewDraft;
  return async ({ home, ...asked }) => {
    const events = read(config.log, TRACE_KINDS);
    const opening = openingOf(events);
    const seat = opening?.seats.reviewer ?? null;
    const reviewer = config.reviewer?.model ?? seat?.model;
    const gate = (logEvents: readonly LogEvent[]) =>
      config.kill?.aborted === true
        ? "session cancelled."
        : revisionRefusal(logEvents, {
            kind: asked.kind,
            check: asked.check,
            candidate: asked.candidate,
            reviewer: reviewer ?? null,
            crossFamily: crossFamilyVendors,
          });
    const refusal = gate(events);
    if (refusal !== null) return { accepted: false, message: `Refused: ${refusal}` };
    if (reviewer === undefined) {
      return { accepted: false, message: "Refused: no reviewer is configured to audit the revision." };
    }
    const checked = await withMergedToolchain(config.parentBundle, home, (sourceHome) =>
      validated({
        log: config.log,
        events,
        asked,
        packages: config.packages(),
        sourceHome,
        kill: config.kill,
      }),
    );
    if (isString(checked)) return { accepted: false, message: checked };
    const audited = await auditRevision({
      log: config.log,
      session: asked.session,
      parentChecks: frozenParent(events).checks,
      prompt: opening?.prompt ?? "",
      checked,
      auditor,
      reader: revisionReader(reviewer, config.reviewer?.effort ?? seat?.effort ?? "high"),
    });
    if (audited !== null) return { accepted: false, message: audited };
    const lateRefusal = gate(read(config.log, TRACE_KINDS));
    if (lateRefusal !== null) return { accepted: false, message: `Refused: ${lateRefusal}` };
    const record = recordOf(asked, events, checked, asked.session);
    if (opening?.attended === true) {
      const revisionsDir = join(dirname(config.log), "revisions");
      const shortHash = record.draftHash.slice(0, 16);
      mkdirSync(revisionsDir, { recursive: true });
      writeFileSync(join(revisionsDir, `${shortHash}.json`), `${capturedJsonStringify(record, null, 2)}\n`);
      return {
        accepted: false,
        message: `The revision passed validation and audit and awaits operator approval under --hitl: bun tools/campaign/revise.ts --name ${basename(dirname(config.log))} --candidate ${shortHash} --freeze`,
      };
    }
    try {
      append(config.log, "exam.revised", recorded(record));
    } catch (error) {
      return { accepted: false, message: `Refused: ${errorMessage(error)}` };
    }
    return {
      accepted: true,
      message:
        "The exam revision stands and is recorded. This campaign hands off to its successor; the session ends here.",
    };
  };
}

const OPTIONS = {
  name: { type: "string" },
  candidate: { type: "string" },
  freeze: { type: "boolean", default: false },
} as const;

export async function freezeCandidate(
  log: string,
  candidate: string,
  packages: () => Promise<ReadonlyMap<string, Task>>,
): Promise<{ readonly name: string; readonly log: string }> {
  if (!/^[a-f0-9]{16}$/u.test(candidate)) {
    throw new Error(`invalid candidate hash ${JSON.stringify(candidate)}`);
  }
  const file = join(dirname(log), "revisions", `${candidate}.json`);
  if (!existsSync(file)) throw new Error(`no staged revision candidate at ${file}`);
  const staged = parseJsonAs<RevisionRecord>(readFileSync(file, "utf8"));
  const draftHash = hashJsonValue(staged.draft);
  if (!draftHash.startsWith(candidate)) {
    throw new Error(`candidate ${candidate} hash mismatch (draft hashes to ${draftHash.slice(0, 16)})`);
  }
  const events = read(log, TRACE_KINDS);
  if (eventsOf(events, "exam.revised").at(-1)?.event.data.draftHash === draftHash) {
    return await openSuccessor(log);
  }
  const asked: Asked = {
    session: staged.session,
    kind: staged.kind,
    why: staged.why,
    check: staged.check,
    candidate: staged.draft,
  };
  const refusal = revisionRefusal(events, { ...asked, crossFamily: crossFamilyVendors });
  if (refusal !== null) throw new Error(refusal);
  const parent = frozenParent(events);
  const auditedSound = eventsOf(events, "referee.draft").some(
    ({ event: { data } }) =>
      data.verdict === "sound" && data.revision === parent.checks && data.session === staged.audit.session,
  );
  if (!auditedSound) {
    throw new Error(`candidate ${candidate} has no logged sound adversarial audit for ${parent.checks}`);
  }
  const faults = revisionFaults(parent.draft, staged.draft, staged.kind, staged.check);
  if (faults.length > 0) throw new Error(`candidate faults: ${faults.join("; ")}`);
  const checked = await validated({ log, events, asked, packages: await packages() });
  if (isString(checked)) throw new Error(checked);
  append(log, "exam.revised", recorded(recordOf(asked, events, checked, staged.audit.session)));
  return await openSuccessor(log);
}

async function reviseCommand(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, candidate } = values;
  if (name === undefined || candidate === undefined || !values.freeze) {
    throw new Error("usage: bun tools/campaign/revise.ts --name <campaign> --candidate <hash> --freeze");
  }
  const next = await freezeCandidate(campaignLog(name), candidate, async () =>
    (await openCampaign({ name })).packages(),
  );
  console.log(`revision frozen; successor campaign ${next.name} opened at ${next.log}`);
}

if (import.meta.main) await reviseCommand(Bun.argv.slice(2));
