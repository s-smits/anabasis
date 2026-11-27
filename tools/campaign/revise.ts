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
  readonly audit: { readonly session: string; readonly verdict: "sound" };
  readonly witnesses: WitnessSummary;
}

function withMergedToolchain<T>(
  parentBundle: string,
  examinerHome: string | undefined,
  run: (sourceHome: string | undefined) => Promise<T>,
): Promise<T> {
  const parentTools = join(parentBundle, TOOL_TREE_DIR);
  const homeTools = examinerHome === undefined ? null : join(examinerHome, TOOL_TREE_DIR);
  const hasParent = existsSync(parentTools);
  const hasHome = homeTools !== null && existsSync(homeTools);
  if (!hasParent && !hasHome) return run(undefined);
  const scratch = mkdtempSync(join(tmpdir(), "ana-rev-tools-"));
  const target = join(scratch, TOOL_TREE_DIR);
  return Promise.try(async () => {
    if (hasParent) {
      cpSync(parentTools, target, { recursive: true, verbatimSymlinks: true });
      rmSync(join(target, HOST_TOOLS_FILE), { force: true });
    }
    if (hasHome && homeTools !== null && examinerHome !== undefined) {
      cpSync(homeTools, target, { recursive: true, verbatimSymlinks: true });
      refuseNamingHome(target, examinerHome, TOOL_TREE_DIR);
    }
    return await run(scratch);
  }).finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
}

async function verifyWitnesses(input: {
  readonly log: string;
  readonly events: readonly LogEvent[];
  readonly packages: ReadonlyMap<string, Task>;
  readonly verify: Verifier;
  readonly kind: RevisionKind;
  readonly check?: string | undefined;
}): Promise<{ readonly faults: readonly string[]; readonly summary: WitnessSummary }> {
  const { log, events, packages, verify, kind, check } = input;
  const stands = standsOf(events);
  const verdicts = verdictsOf(events);
  const findingChecks = new Map<string, Set<string>>();
  for (const {
    event: { data },
  } of eventsOf(events, "referee.finding")) {
    if (!isString(data.solve) || !isString(data.check)) continue;
    const set = findingChecks.get(data.solve) ?? new Set<string>();
    set.add(data.check);
    findingChecks.set(data.solve, set);
  }
  const loadWitness = (solve: string) => {
    const verdict = verdicts.get(solve);
    const task =
      verdict?.task === undefined || verdict.task === null ? undefined : packages.get(verdict.task);
    if (verdict === undefined || task === undefined || verdict.answer === undefined) return null;
    const files =
      verdict.files === undefined || verdict.files.length === 0
        ? undefined
        : readAnswerFiles(log, verdict.files);
    return { solve, verdict, task, answer: verdict.answer, files };
  };
  const faults: string[] = [];
  const runWitnesses = async (ids: readonly string[], label: string) => {
    const loaded = ids.flatMap((id) => {
      try {
        const witness = loadWitness(id);
        return witness === null ? [] : [witness];
      } catch (error) {
        faults.push(`${label} witness ${id} files could not be read: ${errorMessage(error)}`);
        return [];
      }
    });
    return await pooled(loaded, 4, async (witness) => ({
      witness,
      result: await verify(witness.task, witness.answer, undefined, witness.files),
    }));
  };
  const earnedIds = [...stands.entries()].flatMap(([id, ruling]) => (ruling === "earned" ? [id] : []));
  const earnedResults = await runWitnesses(earnedIds, "earned");
  let earnedRetained = 0;
  for (const { witness, result } of earnedResults) {
    const origBlocking = witness.verdict.checker?.kind === "fail" ? witness.verdict.checker.blocking : [];
    const onCheck =
      check !== undefined &&
      (origBlocking.includes(check) || (findingChecks.get(witness.solve)?.has(check) ?? false));
    if (result.kind !== "fail") {
      faults.push(
        `earned Referee witness ${witness.solve} (${witness.task.taskId}) no longer fails (got ${result.kind})`,
      );
      continue;
    }
    if (kind === "repair" && check !== undefined && onCheck && !result.blocking.includes(check)) {
      faults.push(
        `earned Referee witness ${witness.solve} (${witness.task.taskId}) is no longer blocked by repaired check ${check}`,
      );
      continue;
    }
    earnedRetained += 1;
  }
  let [defectChecked, defectCleared] = [0, 0];
  if (kind === "repair" && check !== undefined) {
    const defectResults = await runWitnesses(defectSolvesFor(events, check), "check-defect");
    defectChecked = defectResults.length;
    for (const { witness, result } of defectResults) {
      if (result.kind === "faulty" || result.kind === "non-result") {
        faults.push(`check-defect witness ${witness.solve} faulted under candidate: ${result.reason}`);
        continue;
      }
      const origBlocking = witness.verdict.checker?.kind === "fail" ? witness.verdict.checker.blocking : [];
      const sole = origBlocking.length === 1 && origBlocking[0] === check;
      const cleared = sole
        ? result.kind === "pass"
        : result.kind === "pass" || (result.kind === "fail" && !result.blocking.includes(check));
      if (cleared) defectCleared += 1;
    }
    if (defectCleared === 0) {
      faults.push(`repair candidate did not clear any check-defect witness for ${check}`);
    }
  }
  return {
    faults,
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
  readonly auditor: RevisionAuditor | null;
  readonly reader: Reader | null;
}): Promise<string | null> {
  const { log, session, parentChecks, prompt, seen, auditor, reader } = input;
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
    notes: seen.reading.notes,
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

export function revisionRunner(config: {
  readonly log: string;
  readonly parentBundle: string;
  readonly packages: () => Map<string, Task>;
  readonly reviewer?: { readonly model?: string | undefined; readonly effort?: string | undefined };
  readonly auditor?: RevisionAuditor | null | undefined;
  readonly width?: number | undefined;
}): ReviseRunner {
  const auditor: RevisionAuditor | null = config.auditor === undefined ? reviewDraft : config.auditor;
  const width = config.width ?? 4;
  return async ({ session, kind, why, check, candidate, home }) => {
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
      return { accepted: false, message: "Refused: parent exam is missing or unfrozen." };
    }
    const revisionsDir = join(dirname(config.log), "revisions");
    const staged = await withMergedToolchain(config.parentBundle, home, (sourceHome) =>
      draftReading(revisionsDir, candidate, width, sourceHome),
    );
    if (staged.faults.length > 0 || staged.read === undefined) {
      return {
        accepted: false,
        message: [
          `Revision failed checker validation (${String(staged.faults.length)} faults):`,
          ...staged.faults.map((fault) => `- ${fault}`),
        ].join("\n"),
      };
    }
    const seen = staged.read;
    const witnessed = await verifyWitnesses({
      log: config.log,
      events,
      packages: config.packages(),
      verify: seen.verify,
      kind,
      check,
    });
    if (witnessed.faults.length > 0) {
      return {
        accepted: false,
        message: [
          `Revision failed historical witness checks (${String(witnessed.faults.length)} faults):`,
          ...witnessed.faults.map((fault) => `- ${fault}`),
        ].join("\n"),
      };
    }
    const audited = await auditRevision({
      log: config.log,
      session,
      parentChecks: frozen.checks,
      prompt: opening?.prompt ?? "",
      seen,
      auditor,
      reader: revisionReader(config.reviewer ?? {}, opening),
    });
    if (audited !== null) return { accepted: false, message: audited };
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
      audit: { session, verdict: "sound" },
      witnesses: witnessed.summary,
    };
    if (opening?.attended === true) {
      mkdirSync(revisionsDir, { recursive: true });
      const shortHash = draftHash.slice(0, 16);
      writeFileSync(join(revisionsDir, `${shortHash}.json`), `${capturedJsonStringify(payload, null, 2)}\n`);
      const name = basename(dirname(config.log));
      return {
        accepted: false,
        awaited: true,
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
  const file = join(dirname(log), "revisions", `${candidate}.json`);
  if (!existsSync(file)) throw new Error(`no staged revision candidate at ${file}`);
  const payload = parseJsonAs<PendingCandidate>(readFileSync(file, "utf8"));
  const events = read(log, TRACE_KINDS);
  const parent = draftOf(events);
  if (parent === null) throw new Error(`${log} holds no drafted exam`);
  const faults = revisionFaults(parent, payload.draft, payload.kind, payload.check);
  if (faults.length > 0) throw new Error(`candidate faults: ${faults.join("; ")}`);
  const refusal = revisionRefusal(events, {
    kind: payload.kind,
    check: payload.check,
    candidate: payload.draft,
    crossFamily: crossFamilyVendors,
  });
  if (refusal !== null) throw new Error(refusal);
  const stagedBundle = join(
    dirname(log),
    "revisions",
    "exams",
    hashJsonValue(payload.draft).slice(0, 16),
    "bundle",
  );
  const seen = await draftReading(
    join(dirname(log), "revisions"),
    payload.draft,
    4,
    existsSync(stagedBundle) ? stagedBundle : undefined,
  );
  if (seen.faults.length > 0 || seen.read === undefined) {
    throw new Error(`candidate no longer passes checker reading: ${seen.faults.join("; ")}`);
  }
  const witnessed = await verifyWitnesses({
    log,
    events,
    packages,
    verify: seen.read.verify,
    kind: payload.kind,
    check: payload.check,
  });
  if (witnessed.faults.length > 0) throw new Error(`witness faults: ${witnessed.faults.join("; ")}`);
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
