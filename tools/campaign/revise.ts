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
import { proposalsOf } from "#src/kernel/history.ts";
import { ranUnder, standsOf, verdictsOf } from "#src/kernel/solves.ts";
import { HOST_TOOLS_FILE, type Task, type Verifier } from "#src/kernel/verify.ts";
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
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { campaignLog, examinerSession, openCampaign } from "./campaign.ts";
import { draftReading } from "./exam.ts";
import { crossFamilyVendors } from "./round.ts";
import { openSuccessor } from "./successor.ts";

export type RevisionAuditor = (reader: Reader, target: DraftAuditCase) => Promise<DraftAuditFinding>;

const MAX_REVISION_AUDITS = 2;

interface WitnessSummary {
  readonly earnedChecked: number;
  readonly earnedRetained: number;
  readonly defectChecked: number;
  readonly defectCleared: number;
}

interface PendingCandidate {
  readonly session: string;
  readonly kind: RevisionKind;
  readonly why: string;
  readonly check?: string;
  readonly parent: { readonly draft: string; readonly checks: string };
  readonly draft: Draft;
  readonly draftHash: string;
  readonly checker: { readonly contract: string; readonly checks: string };
  readonly reading: { readonly faults: readonly string[]; readonly notes: readonly string[] };
  readonly audit: { readonly session: string; readonly verdict: "sound" | "none" };
  readonly witnesses: WitnessSummary;
}

function withMergedToolchain<T>(
  parentBundle: string,
  examinerHome: string | undefined,
  run: (sourceHome: string | undefined) => Promise<T>,
): Promise<T> {
  const parentTools = join(parentBundle, TOOL_TREE_DIR);
  const hasParent = existsSync(parentTools);
  const home =
    examinerHome !== undefined && existsSync(join(examinerHome, TOOL_TREE_DIR))
      ? { dir: examinerHome, tools: join(examinerHome, TOOL_TREE_DIR) }
      : null;
  if (!hasParent && home === null) return run(undefined);
  const scratch = mkdtempSync(join(tmpdir(), "ana-rev-tools-"));
  const target = join(scratch, TOOL_TREE_DIR);
  return Promise.try(async () => {
    if (hasParent) {
      cpSync(parentTools, target, { recursive: true, verbatimSymlinks: true });
      rmSync(join(target, HOST_TOOLS_FILE), { force: true });
    }
    if (home !== null) {
      cpSync(home.tools, target, { recursive: true, verbatimSymlinks: true });
      refuseNamingHome(target, home.dir, TOOL_TREE_DIR);
    }
    return await run(scratch);
  }).finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
}

function witnessLoader(log: string, events: readonly LogEvent[], packages: ReadonlyMap<string, Task>) {
  const verdicts = verdictsOf(events);
  const solveVersion = new Map(ranUnder(events).map(({ id, under }) => [id, under.task]));
  const byTaskId = new Map<string, Task>([
    ...proposalsOf(events).flatMap((proposal) =>
      proposal.task === null ? [] : [[proposal.task.taskId, proposal.task] as const],
    ),
    ...[...packages.values()].map((entry) => [entry.taskId, entry] as const),
  ]);
  return (ids: readonly string[], label: string, faults: string[], verify: Verifier, kill?: AbortSignal) => {
    const loaded = ids.flatMap((solve) => {
      try {
        const verdict = verdicts.get(solve);
        const version = solveVersion.get(solve);
        const task =
          (version === undefined ? undefined : packages.get(version)) ??
          (verdict?.task === undefined || verdict.task === null
            ? undefined
            : (packages.get(verdict.task) ?? byTaskId.get(verdict.task)));
        if (verdict === undefined || task === undefined || verdict.answer === undefined) {
          const taskLabel = isString(verdict?.task) ? ` on ${verdict.task}` : "";
          faults.push(`${label} witness${taskLabel} could not be loaded (missing task package or answer)`);
          return [];
        }
        const files =
          verdict.files === undefined || verdict.files.length === 0
            ? undefined
            : readAnswerFiles(log, verdict.files);
        return [{ solve, verdict, task, answer: verdict.answer, files }];
      } catch {
        const taskId = verdicts.get(solve)?.task;
        const taskLabel = isString(taskId) ? ` on ${taskId}` : "";
        faults.push(`${label} witness${taskLabel} deliverable files could not be read`);
        return [];
      }
    });
    return pooled(loaded, 4, async (witness) => ({
      witness,
      result: await verify(witness.task, witness.answer, kill, witness.files),
    }));
  };
}

async function verifyWitnesses(input: {
  readonly log: string;
  readonly events: readonly LogEvent[];
  readonly packages: ReadonlyMap<string, Task>;
  readonly verify: Verifier;
  readonly kind: RevisionKind;
  readonly check?: string | undefined;
  readonly kill?: AbortSignal | undefined;
}): Promise<{
  readonly faults: readonly string[];
  readonly notes: readonly string[];
  readonly summary: WitnessSummary;
}> {
  const { log, events, packages, verify, kind, check, kill } = input;
  const runWitnesses = witnessLoader(log, events, packages);
  const faults: string[] = [];
  const notes: string[] = [];
  const origBlockingOf = (
    witness: {
      readonly task: Task;
      readonly verdict: {
        readonly checker?:
          | { readonly kind: string; readonly blocking?: readonly string[] }
          | null
          | undefined;
      };
    },
    result: Awaited<ReturnType<Verifier>>,
    label: string,
  ): readonly string[] | null => {
    if (result.kind === "faulty" || result.kind === "non-result") {
      faults.push(`${label} witness on ${witness.task.taskId} faulted under candidate: ${result.reason}`);
      return null;
    }
    return witness.verdict.checker?.kind === "fail" ? (witness.verdict.checker.blocking ?? []) : [];
  };
  const earnedIds = [...standsOf(events).entries()].flatMap(([id, ruling]) =>
    ruling === "earned" ? [id] : [],
  );
  const earnedResults = await runWitnesses(earnedIds, "earned", faults, verify, kill);
  let [earnedRetained, repairedCheckFlips] = [0, 0];
  for (const { witness, result } of earnedResults) {
    const origBlocking = origBlockingOf(witness, result, "earned Referee");
    if (origBlocking === null) continue;
    const untouched =
      kind === "repair" && check !== undefined ? origBlocking.filter((id) => id !== check) : origBlocking;
    const soleRepaired =
      kind === "repair" && check !== undefined && origBlocking.length > 0 && untouched.length === 0;
    if (soleRepaired) {
      if (result.kind === "fail" && result.blocking.includes(check)) earnedRetained += 1;
      else repairedCheckFlips += 1;
      continue;
    }
    if (result.kind !== "fail") {
      faults.push(`earned Referee witness on ${witness.task.taskId} no longer fails (got ${result.kind})`);
      continue;
    }
    if (untouched.length > 0 && !untouched.some((id) => result.blocking.includes(id))) {
      faults.push(
        `earned Referee witness on ${witness.task.taskId} is no longer blocked by any untouched check (${untouched.join(", ")})`,
      );
      continue;
    }
    earnedRetained += 1;
  }
  if (repairedCheckFlips > 0 && check !== undefined) {
    notes.push(
      `${String(repairedCheckFlips)} historical earned witness${repairedCheckFlips === 1 ? "" : "es"} solely on repaired check ${check} now pass; probe ${check} to verify it still enforces its published rule without over-relaxing.`,
    );
  }
  let [defectChecked, defectCleared] = [0, 0];
  if (kind === "repair" && check !== undefined) {
    const defectResults = await runWitnesses(
      defectSolvesFor(events, check),
      "check-defect",
      faults,
      verify,
      kill,
    );
    defectChecked = defectResults.length;
    const uncleared: string[] = [];
    for (const { witness, result } of defectResults) {
      const origBlocking = origBlockingOf(witness, result, "check-defect");
      if (origBlocking === null) continue;
      const sole = origBlocking.length === 1 && origBlocking[0] === check;
      const cleared = sole
        ? result.kind === "pass"
        : result.kind === "pass" || (result.kind === "fail" && !result.blocking.includes(check));
      if (cleared) defectCleared += 1;
      else uncleared.push(witness.task.taskId);
    }
    if (defectChecked === 0 || defectCleared === 0) {
      faults.push(`repair candidate did not clear any check-defect witness for ${check}`);
    } else if (uncleared.length > 0) {
      const tasks = [...new Set(uncleared)].join(", ");
      faults.push(
        `repair candidate left ${String(uncleared.length)}/${String(defectChecked)} check-defect witnesses uncleared for ${check} (tasks: ${tasks})`,
      );
    }
  }
  return {
    faults,
    notes,
    summary: { earnedChecked: earnedResults.length, earnedRetained, defectChecked, defectCleared },
  };
}

function revisionReader(
  reviewer: { readonly model?: string | undefined; readonly effort?: string | undefined },
  opening: ReturnType<typeof openingOf>,
): Reader | null {
  const recorded = opening?.seats.reviewer ?? null;
  const model = reviewer.model ?? recorded?.model;
  if (model === undefined) return null;
  const effort = reviewer.effort ?? recorded?.effort ?? "high";
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
  readonly seen: NonNullable<Awaited<ReturnType<typeof draftReading>>["read"]>;
  readonly extraNotes: readonly string[];
  readonly auditor: RevisionAuditor | null;
  readonly reader: Reader | null;
}): Promise<string | null> {
  const { log, session, parentChecks, prompt, seen, extraNotes, auditor, reader } = input;
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
  if (auditor === null) return null;
  if (reader === null) return "Refused: no reviewer configured to audit the revision.";
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
    notes: [...seen.reading.notes, ...extraNotes],
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

async function validateCandidate(input: {
  readonly log: string;
  readonly events: readonly LogEvent[];
  readonly candidate: Draft;
  readonly kind: RevisionKind;
  readonly check?: string | undefined;
  readonly packages: ReadonlyMap<string, Task>;
  readonly width: number;
  readonly sourceHome?: string | undefined;
  readonly kill?: AbortSignal | undefined;
}): Promise<
  | { readonly ok: false; readonly message: string }
  | {
      readonly ok: true;
      readonly seen: NonNullable<Awaited<ReturnType<typeof draftReading>>["read"]>;
      readonly witnessed: Awaited<ReturnType<typeof verifyWitnesses>>;
    }
> {
  const { log, events, candidate, kind, check, packages, width, sourceHome, kill } = input;
  const staged = await draftReading(join(dirname(log), "revisions"), candidate, width, sourceHome);
  if (staged.faults.length > 0 || staged.read === undefined) {
    return {
      ok: false,
      message: [
        `Revision failed checker validation (${String(staged.faults.length)} faults):`,
        ...staged.faults.map((fault) => `- ${fault}`),
      ].join("\n"),
    };
  }
  const witnessed = await verifyWitnesses({
    log,
    events,
    packages,
    verify: staged.read.verify,
    kind,
    check,
    kill,
  });
  if (witnessed.faults.length > 0) {
    return {
      ok: false,
      message: [
        `Revision failed historical witness checks (${String(witnessed.faults.length)} faults):`,
        ...witnessed.faults.map((fault) => `- ${fault}`),
      ].join("\n"),
    };
  }
  return { ok: true, seen: staged.read, witnessed };
}

export function revisionRunner(config: {
  readonly log: string;
  readonly parentBundle: string;
  readonly packages: () => Map<string, Task>;
  readonly reviewer?: { readonly model?: string | undefined; readonly effort?: string | undefined };
  readonly auditor?: RevisionAuditor | null | undefined;
  readonly width?: number | undefined;
  readonly kill?: AbortSignal | undefined;
}): ReviseRunner {
  const auditor: RevisionAuditor | null = config.auditor === undefined ? reviewDraft : config.auditor;
  const width = config.width ?? 4;
  const cancelled = () => config.kill?.aborted === true;
  return async ({ session, kind, why, check, candidate, home }) => {
    if (cancelled()) return { accepted: false, message: "Refused: session cancelled." };
    const events = read(config.log, TRACE_KINDS);
    const opening = openingOf(events);
    const parent = draftOf(events);
    const frozen = frozenChecker(events);
    const reviewerModel = config.reviewer?.model ?? opening?.seats.reviewer?.model ?? null;
    const gate = (logEvents: readonly LogEvent[]) =>
      revisionRefusal(logEvents, {
        kind,
        check,
        candidate,
        reviewer: reviewerModel,
        requireReviewer: auditor === reviewDraft,
        crossFamily: crossFamilyVendors,
      });
    const refusal = gate(events);
    if (refusal !== null) return { accepted: false, message: `Refused: ${refusal}` };
    if (parent === null || frozen === null) {
      throw new Error("parent exam is missing or unfrozen");
    }
    const checked = await withMergedToolchain(config.parentBundle, home, (sourceHome) =>
      validateCandidate({
        log: config.log,
        events,
        candidate,
        kind,
        check,
        packages: config.packages(),
        width,
        sourceHome,
        kill: config.kill,
      }),
    );
    if (!checked.ok) return { accepted: false, message: checked.message };
    const { seen, witnessed } = checked;
    const audited = await auditRevision({
      log: config.log,
      session,
      parentChecks: frozen.checks,
      prompt: opening?.prompt ?? "",
      seen,
      extraNotes: witnessed.notes,
      auditor,
      reader: revisionReader(config.reviewer ?? {}, opening),
    });
    if (audited !== null) return { accepted: false, message: audited };
    if (cancelled()) return { accepted: false, message: "Refused: session cancelled." };
    const lateRefusal = gate(read(config.log, TRACE_KINDS));
    if (lateRefusal !== null) return { accepted: false, message: `Refused: ${lateRefusal}` };
    const draftHash = hashJsonValue(candidate);
    const payload: PendingCandidate = {
      session,
      kind,
      why,
      ...keyIfDefined("check", check),
      parent: { draft: hashJsonValue(parent), checks: frozen.checks },
      draft: candidate,
      draftHash,
      checker: seen.checker,
      reading: { faults: [...seen.reading.faults], notes: [...seen.reading.notes] },
      audit: { session, verdict: auditor === null ? "none" : "sound" },
      witnesses: witnessed.summary,
    };
    const revisionsDir = join(dirname(config.log), "revisions");
    if (opening?.attended === true) {
      mkdirSync(revisionsDir, { recursive: true });
      const shortHash = draftHash.slice(0, 16);
      writeFileSync(join(revisionsDir, `${shortHash}.json`), `${capturedJsonStringify(payload, null, 2)}\n`);
      const name = basename(dirname(config.log));
      return {
        accepted: false,
        message: `The revision passed validation and audit and awaits operator approval under --hitl: bun tools/campaign/revise.ts --name ${name} --candidate ${shortHash} --freeze`,
      };
    }
    try {
      append(config.log, "exam.revised", parseJsonAs<JsonObject>(capturedJsonStringify(payload)));
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
  packages: ReadonlyMap<string, Task>,
): Promise<{ readonly name: string; readonly log: string }> {
  if (!/^[a-f0-9]{16}$/u.test(candidate)) {
    throw new Error(`invalid candidate hash ${JSON.stringify(candidate)}`);
  }
  const file = join(dirname(log), "revisions", `${candidate}.json`);
  if (!existsSync(file)) throw new Error(`no staged revision candidate at ${file}`);
  const payload = parseJsonAs<PendingCandidate>(readFileSync(file, "utf8"));
  const actualHash = hashJsonValue(payload.draft);
  if (actualHash !== payload.draftHash || !actualHash.startsWith(candidate)) {
    throw new Error(`candidate ${candidate} hash mismatch (draft hashes to ${actualHash.slice(0, 16)})`);
  }
  const events = read(log, TRACE_KINDS);
  if (eventsOf(events, "exam.revised").at(-1)?.event.data.draftHash === payload.draftHash) {
    return await openSuccessor(log);
  }
  const parent = draftOf(events);
  const frozen = frozenChecker(events);
  if (parent === null || frozen === null) throw new Error(`${log} holds no frozen drafted exam`);
  if (payload.parent.checks !== frozen.checks) {
    throw new Error(`candidate parent checks ${payload.parent.checks} do not match frozen ${frozen.checks}`);
  }
  const auditedSound = eventsOf(events, "referee.draft").some(
    ({ event: { data } }) =>
      data.verdict === "sound" && data.revision === frozen.checks && data.session === payload.audit.session,
  );
  if (payload.audit.verdict !== "sound" || !auditedSound) {
    throw new Error(`candidate ${candidate} has no logged sound adversarial audit for ${frozen.checks}`);
  }
  const faults = revisionFaults(parent, payload.draft, payload.kind, payload.check);
  if (faults.length > 0) throw new Error(`candidate faults: ${faults.join("; ")}`);
  const refusal = revisionRefusal(events, {
    kind: payload.kind,
    check: payload.check,
    candidate: payload.draft,
    crossFamily: crossFamilyVendors,
  });
  if (refusal !== null) throw new Error(refusal);
  const stagedBundle = join(dirname(log), "revisions", "exams", actualHash.slice(0, 16), "bundle");
  const checked = await withMergedToolchain(stagedBundle, undefined, (sourceHome) =>
    validateCandidate({
      log,
      events,
      candidate: payload.draft,
      kind: payload.kind,
      check: payload.check,
      packages,
      width: 4,
      sourceHome,
    }),
  );
  if (!checked.ok) throw new Error(checked.message);
  append(log, "exam.revised", parseJsonAs<JsonObject>(capturedJsonStringify(payload)));
  return await openSuccessor(log);
}

async function reviseCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, candidate } = values;
  if (name === undefined || candidate === undefined || !values.freeze) {
    throw new Error("usage: bun tools/campaign/revise.ts --name <campaign> --candidate <hash> --freeze");
  }
  const log = campaignLog(name);
  const campaign = await openCampaign({ name });
  const next = await freezeCandidate(log, candidate, campaign.packages());
  console.log(`revision frozen; successor campaign ${next.name} opened at ${next.log}`);
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await reviseCommand(Bun.argv.slice(2));
