/**
 * Run a segment of the real build on the real backend: one seeded start, the production toolkit,
 * and as many steps as the segment covers — three of the twenty checkpoints rather than all of them.
 *
 * The unit is deliberately not "a turn". Inside one step the session already runs its own
 * tool-calling loop, and it decides for itself what to do; a segment is a contiguous stretch of the
 * production checkpoint sequence, seeded at the point you want to measure and stopped where your
 * question is answered.
 *
 * This exists so a simulation never hand-builds a session. Hand-building means knowing the Builder
 * slot's defaults, that `repoRoot` is what completes the credential from `.env`, that reported
 * spend arrives on the event stream rather than on the turn result, and that a provider limit is
 * retried on a declared backoff before it counts as a non-result. Getting any of them wrong
 * produces a refusal that looks like a product finding.
 *
 * It uses `builderSlot`, `builderSessionOpener`, `campaignBuilderMount` and `runBuilderTurn` — the
 * run's own slot, host session, toolkit and turn loop. It is not a subagent: no Task tool, no
 * second harness, one provider session carrying its own state.
 *
 * Usage, from the tree whose behaviour you are measuring:
 *
 *   bun .claude/skills/system-path-simulation/scripts/run-segment.mts \
 *     --backend claude --effort high --campaign-dir /abs/scratch/epoch \
 *     --step builder:/abs/scratch/kickoff.txt \
 *     --step tests:/abs/scratch/tasks-step.txt
 *
 * Each `--step` is `role:path`, run in order on ONE session, so the second step sees what the first
 * did. Roles label the supplied steps; every step uses the same ordinary Builder session.
 * Omit the label and the step is named `builder`.
 *
 * Three optional inputs bind the segment to its question:
 *   --seed-dir /abs/adopted-tree    copy a real tree into the workspace before the session opens.
 *                                   `initWorkspace` then runs over the result exactly as
 *                                   `runBuilderCampaign` runs it: the starter pack when there is no
 *                                   `.git`, the controller-owned exclude rules, the `.toolchain/bun`
 *                                   link and the package scopes, all repointed at THIS tree.
 *   --predictions /abs/note.md      embed the pre-registered predictions verbatim, with digest
 *   --accept-unreachable "<reason>" run predictions that name a gate or controller stage anyway
 *   --system-file /abs/system.txt   exact captured system bytes; omitted keeps workspace card.
 *   --json                          full result including the per-turn tool trail, for adjudication
 *   --check                         run every provider-free refusal, then exit 0 before any
 *                                   credential, module graph or provider is touched
 *
 * Two more bound the segment and make the joins between steps real:
 *   --max-builder-turns 15                  total turn budget across every step; valid range is 1-15
 *   --step role:/abs/file.txt@4     let that step take up to 4 turns, so the actor can be deliberate
 *   --handover /abs/handover.mts    a module the segment runs BETWEEN steps: it decides whether the
 *                                   next step opens at all, and may write the next step's prompt
 *
 * The handover module is where a multi-stage question stops being prose. Production does not hand
 * one stage's output straight to the next stage: a controller reads it, decides, and composes the
 * next input. A segment whose step 2 prompt was hand-written by the operator has stubbed exactly
 * that join, which is usually the join under test ("did the handover actually come through?").
 * Import the real controller function in the module and let it answer:
 *
 *   export async function handover(ctx) {                    // ctx: see HandoverContext below
 *     const move = selectNextMoveFromDisk(ctx.campaignDir);  // the REAL selector, not a guess
 *     if (move.action !== "climb") return { ok: false, reason: `selector chose ${move.action}` };
 *     return { ok: true, reason: "selector chose climb", nextPrompt: climbKickoff(move) };
 *   }
 */

import { sha256, sha256OfFile } from "#src/meta/digest.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from "#src/meta/filesystem.ts";
import { basename, dirname, isAbsolute, join, relative, resolve } from "#src/meta/path.ts";
import { gitText } from "#skills/main/git.ts";
import { BUILDER_TURN_SETTLE_MS } from "#src/author/builder-turn-loop.ts";

import {
  type SegmentCall,
  completedSegment,
  runSegmentLoop,
  type HandoverContext,
  type HandoverVerdict,
  type SegmentStep,
  type TrailRow,
} from "./segment-loop.mts";
import type { AgentTurnResult, TurnUsage } from "#src/backends/backend-types.ts";
import type { CampaignBuilderCondition } from "#src/author/campaign-epoch.ts";
import { type BackendKind, defaultModelOf } from "#src/backends/resolve.ts";
import { type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { asRecord, isFunction, isString } from "#src/meta/json-shape.ts";
import type { OpenRecord } from "#src/meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull } from "#src/meta/optional-key.ts";
import { hasText } from "#src/meta/text.ts";

const die: ExitWith = exitWith("run-segment");

/** The tree this script was read from — the same tree whose `src/` it just imported, so a copy in a
 *  scratch worktree measures that worktree instead of the primary checkout. */
const REPO_ROOT = resolve(dirname(Bun.fileURLToPath(import.meta.url)), "../../../..");
const BACKENDS: BackendKind[] = ["claude", "codex", "openrouter"];

/** What `--handover` must export. The host can prove the module exports a function; that it takes a
 *  handover context is the operator's claim, and this predicate is where that claim is named. */
type HandoverFn = (ctx: HandoverContext) => Promise<HandoverVerdict> | HandoverVerdict;
const ROLES: SegmentCall["role"][] = [
  "brief",
  "tests",
  "tools-spec",
  "accept-controls",
  "hardener",
  "correctness-model-author",
  "tools-author",
  "memory",
  "builder",
];

/** One stage of the segment. Extra turns reuse the session with the helper continuation below;
 * this does not reproduce production admission feedback. */
const steps: SegmentStep[] = [];

/** What a segment can never produce. It mounts the authoring roster alone, so a prediction about a
 *  controller gate or a stage behind one is unreachable by construction. On 2026-09-15 a five-turn
 *  census condition ran 78 minutes and 70 authoring calls before result.json showed absentGates and
 *  all three predictions untriggered. The scan reads only the pre-registered part and refuses before
 *  any backend opens; --accept-unreachable "<reason>" keeps a deliberate absence question. */
const SEGMENT_UNREACHABLE: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(?:harness_inspect|harness_trial|correctness_check|submit)\b/, "a controller gate"],
  [/\bcensus\b/i, "the control census"],
  [/\bF2\b|\bsolvability\b|\breference solve\b/i, "F2 solvability"],
  [/\badopt(?:s|ed|ion)?\b/i, "adoption"],
  [/\bbattery\b|\bmeasurement\b/i, "a measured battery"],
];
/** The total turn budget for the whole segment, steps and their continuations together. Fifteen is
 *  the operator's rule of 2026-08-19, replacing the ten-turn limit: it leaves room for a natural
 *  multi-stage transition while preserving the rule that a segment which cannot answer inside
 *  about fifteen turns is badly staged. Seed it later or ask something narrower rather than
 *  letting it run on. The budget is a stop, not a failure: the segment reports
 *  `turn-budget-reached` and whatever it had learned by then, which is the honest reading. */
const SEGMENT_TURN_LIMIT = 15;
/** The continuation this script sends when a step is allowed more than one turn. It is the script's
 *  own text, not production's — production's continuation carries submit refusals this segment has
 *  no gate stack to produce. Say so in the evidence rather than letting it read as product prose;
 *  `--continue-file` replaces it when the stage under test has its own continuation. */
const DEFAULT_CONTINUATION =
  "Continue the step you are on. If you have already answered it completely, say so in one line and stop rather than restating your answer.";
type SeedCopy = { dir: string; files: Map<string, string>; committed: boolean };

const SEGMENT_IDENTITY = [
  "-c",
  "user.name=segment",
  "-c",
  "user.email=segment@ana.local",
  "-c",
  "commit.gpgsign=false",
];

const isHandover = (value: unknown): value is HandoverFn => isFunction(value);
const parsed = parseOrDie(die, {
  values: [
    "backend",
    "effort",
    "campaign-dir",
    "seed-dir",
    "predictions",
    "slug",
    "model",
    "provider-pin",
    "timeout-ms",
    "max-builder-turns",
    "continue-file",
    "system-file",
    "handover",
    "accept-unreachable",
  ],
  repeatable: ["step"],
  flags: ["no-tools", "json", "check"],
});
const single = parsed.single;

for (const value of parsed.repeated.get("step") ?? []) {
  const marker = value.indexOf(":");
  const role = marker === -1 ? "builder" : value.slice(0, marker);
  const spec = marker === -1 ? value : value.slice(marker + 1);
  const at = spec.lastIndexOf("@");
  const suffix = at === -1 ? null : spec.slice(at + 1);
  const hasAllowance = suffix !== null && /^\d+$/.test(suffix);
  const wholePathExists = existsSync(resolve(spec));
  if (suffix !== null && !hasAllowance && !wholePathExists) {
    die(`step turn allowance must be a positive integer, got "${suffix}"`);
  }
  const path = hasAllowance ? spec.slice(0, at) : spec;
  const turns = hasAllowance ? Number(suffix) : 1;
  if (!ROLES.includes(role)) die(`step role "${role}" is not a checkpoint — one of ${ROLES.join(", ")}`);
  if (!Number.isInteger(turns) || turns < 1) {
    die(`step turn allowance must be a positive integer, got "${suffix ?? ""}"`);
  }
  if (!isAbsolute(path)) die(`step prompt file must be an absolute path, got ${JSON.stringify(path)}`);
  if (!existsSync(path)) die(`step prompt file does not exist: ${path}`);
  let prompt: string;
  try {
    prompt = readFileSync(path, "utf8");
  } catch (error) {
    const detail = errorMessage(error);
    die(`could not read step prompt file ${path}: ${detail}`);
  }
  if (prompt.trim() === "") die(`step prompt file is empty: ${path}`);
  steps.push({ call: { role, prompt, steeringTypes: ["start-prompt"] }, turns });
}

if (steps.length === 0) die("pass at least one --step [role:]<prompt-file>[@turns]");

const backendName = single.get("backend") ?? "claude";
const backend = BACKENDS.find((id) => id === backendName);
if (backend === undefined) die(`--backend must be one of ${BACKENDS.join(", ")}`);

/** Required on purpose. An unstated effort is an unmeasured condition, and a rehearsal that opened
 *  at an inherited `xhigh` read as a finding about the prompt. */
const effort = single.get("effort");
if (!hasText(effort)) {
  die("--effort is required (claude: low|medium|high|xhigh|max; codex/openrouter: their own vocabulary)");
}

/** The epoch directory the segment runs in. `campaignBuilderMount` creates its `workspace/` and
 *  `.oss/` beneath it and binds the real isolation policy to them, so the session writes where a
 *  production session writes. The checks below require a fresh physical path beneath `.scratch/`;
 *  a lexical child through a symlink and a live campaign path both refuse. */
const campaignDir = single.get("campaign-dir");
if (!hasText(campaignDir)) die("--campaign-dir is required (absolute path to a scratch epoch directory)");
if (!isAbsolute(campaignDir)) {
  die(`--campaign-dir must be an absolute path, got ${JSON.stringify(campaignDir)}`);
}
const campaignPath = resolve(campaignDir);
function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}
function physicalPotentialPath(path: string): string {
  let existing = path;
  const tail: string[] = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) die(`could not resolve an existing ancestor for ${path}`);
    tail.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync(existing), ...tail);
}
/** The real isolation rule is `repoRoot ⊇ epochDir ⊇ workspace`, so an epoch under `/tmp` refuses
 *  deep inside `deriveCandidateIsolation`. Refuse it here instead, where the message can name the
 *  fix: this is the same class as the scratch tree that had no `node_modules` above it. */
if (!inside(REPO_ROOT, campaignPath)) {
  die(
    `--campaign-dir must sit inside the run tree (${REPO_ROOT}) — the candidate isolation binding requires repoRoot ⊇ epoch ⊇ workspace. Use e.g. ${REPO_ROOT}/.scratch/segment`,
  );
}
const scratchRoot = resolve(REPO_ROOT, ".scratch");
if (!inside(scratchRoot, campaignPath)) {
  die(
    `--campaign-dir must sit under the run tree's .scratch directory (${scratchRoot}) so a simulation cannot mutate live campaign evidence`,
  );
}
const physicalScratchRoot = physicalPotentialPath(scratchRoot);
const physicalCampaignPath = physicalPotentialPath(campaignPath);
if (!inside(physicalScratchRoot, physicalCampaignPath)) {
  die(`--campaign-dir resolves outside the run tree's .scratch directory through a symlink: ${campaignPath}`);
}
let campaignEntries: string[] = [];
if (existsSync(campaignPath)) {
  const campaignStat = lstatSync(campaignPath);
  if (campaignStat.isSymbolicLink()) {
    die(`--campaign-dir must be a real scratch directory, not a symlink: ${campaignPath}`);
  }
  if (!campaignStat.isDirectory()) die(`--campaign-dir exists and is not a directory: ${campaignPath}`);
  campaignEntries = readdirSync(campaignPath);
}

/** Seed the segment workspace from a real tree — an adopted bundle or an immutable workspace snapshot — so a
 *  seeded-position segment starts from production bytes instead of an empty directory. The copy
 *  happens before the session opens; the seed path is recorded in the evidence so the condition
 *  can be repeated. */
const seedDir = single.get("seed-dir");
if (seedDir !== undefined && !isAbsolute(seedDir)) {
  die(`--seed-dir must be an absolute path, got ${JSON.stringify(seedDir)}`);
}
if (seedDir !== undefined && !existsSync(resolve(seedDir))) {
  die(`--seed-dir does not exist: ${seedDir}`);
}

/** Pre-registered predictions, bound to the run's own output. The file is read before the first
 *  turn and embedded verbatim with its digest, so adjudication can prove the predictions preceded
 *  the behaviour instead of being written around it. */
const predictionsPath = single.get("predictions");
const predictions =
  predictionsPath === undefined
    ? null
    : (() => {
        if (!isAbsolute(predictionsPath)) {
          die(`--predictions must be an absolute path, got ${JSON.stringify(predictionsPath)}`);
        }
        const path = resolve(predictionsPath);
        let text: string;
        try {
          text = readFileSync(path, "utf8");
        } catch (error) {
          const detail = errorMessage(error);
          die(`could not read --predictions ${path}: ${detail}`);
        }
        return { path, sha256: sha256(text), text };
      })();

/** Controller-owned gates. A segment mounts the authoring roster alone, so an actor that looks for
 *  these finds none; the absence is a property of the segment shape, never of the actor. */
const CONTROLLER_GATES = ["harness_inspect", "harness_trial", "correctness_check", "submit"] as const;

const acceptUnreachable = single.get("accept-unreachable");
if (predictions !== null && acceptUnreachable === undefined) {
  const preRegistered = predictions.text.split(/^## Resolutions/m)[0] ?? "";
  const hits = SEGMENT_UNREACHABLE.flatMap(([pattern, surface]) => {
    const match = pattern.exec(preRegistered);
    return match === null ? [] : [`${surface} ("${match[0]}")`];
  });
  if (hits.length > 0) {
    die(
      `--predictions names ${hits.join(", ")}, which a segment never runs: it mounts no ${CONTROLLER_GATES.join(", ")}. ` +
        `Use run-condition.mts (cases/seeded-condition.md) for a gate or controller stage, or pass --accept-unreachable "<reason>" when the absence is the question.`,
    );
  }
}

/** Explicit captured system bytes; omission retains the existing workspace-card default. */
const systemPath = single.get("system-file");
const systemPrompt =
  systemPath === undefined
    ? null
    : (() => {
        if (!isAbsolute(systemPath)) die("--system-file must be an absolute path");
        let text: string;
        try {
          text = readFileSync(systemPath, "utf8");
        } catch {
          die(`could not read --system-file ${systemPath}`);
        }
        if (text.trim() === "") die("--system-file must not be empty");
        return { path: systemPath, text, sha256: sha256(text) };
      })();

const slug = single.get("slug") ?? "segment";
/** An unstated model is the Builder slot's own default, named here so the recorded condition says
 *  which model served it: the slot resolves no model of its own. */
const model = single.get("model") ?? defaultModelOf(backend);
const condition: CampaignBuilderCondition = {
  kind: backend,
  model: model ?? null,
  reasoningEffort: effort,
  ...(() => {
    const pin = single.get("provider-pin")?.split(",").filter(Boolean);
    return pin && pin.length > 0 ? { providerPin: pin } : {};
  })(),
};

/** Production gives a Builder turn six hours (`BUILDER_TURN_SETTLE_MS`). The helper used to default to one
 * hour, which on 2026-09-13 interrupted a natural-condition actor mid-rebuild while its control finished in
 * 21 minutes: the two conditions then ran under different walls. A shorter wall is an explicit part of the
 * condition, passed with `--timeout-ms` and recorded in the JSON. */
const turnTimeoutMs = Number(single.get("timeout-ms") ?? BUILDER_TURN_SETTLE_MS);
if (!Number.isInteger(turnTimeoutMs) || turnTimeoutMs < 1) {
  die(`--timeout-ms must be a positive integer, got ${JSON.stringify(single.get("timeout-ms"))}`);
}
const withTools = !parsed.flags.has("no-tools");
const asJson = parsed.flags.has("json");

const maxTurns = Number(single.get("max-builder-turns") ?? SEGMENT_TURN_LIMIT);
if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > SEGMENT_TURN_LIMIT) {
  die(
    `--max-builder-turns must be an integer from 1 through ${SEGMENT_TURN_LIMIT}, got "${single.get("max-builder-turns")}"`,
  );
}

const continuationPath = single.get("continue-file");
const continuation =
  continuationPath === undefined
    ? DEFAULT_CONTINUATION
    : (() => {
        if (!isAbsolute(continuationPath)) {
          die(`--continue-file must be an absolute path, got ${JSON.stringify(continuationPath)}`);
        }
        try {
          return readFileSync(resolve(continuationPath), "utf8");
        } catch (error) {
          const detail = errorMessage(error);
          die(`could not read --continue-file ${resolve(continuationPath)}: ${detail}`);
        }
      })();

/** The join between two stages. Production never hands one stage's text straight to the next: a
 * controller reads the result, decides whether the next stage opens, and composes its input. */
const handoverPath = single.get("handover");
if (handoverPath !== undefined && !isAbsolute(handoverPath)) {
  die(`--handover must be an absolute path, got ${JSON.stringify(handoverPath)}`);
}
const handoverModule: OpenRecord | null =
  handoverPath === undefined
    ? null
    : await import(resolve(handoverPath)).catch((cause: unknown) => {
        die(`could not load --handover ${resolve(handoverPath)}: ${errorMessage(cause)}`);
      });
const handoverExport = handoverModule === null ? null : handoverModule.handover;
if (handoverPath !== undefined && !isHandover(handoverExport)) {
  die(`--handover module must export a function named "handover": ${handoverPath}`);
}

function note(line: string): void {
  if (!asJson) console.error(line);
}

const workspace = resolve(campaignPath, "workspace");
try {
  const workspaceStat = lstatSync(workspace);
  if (workspaceStat.isSymbolicLink()) {
    die(`workspace must be a real directory inside the scratch condition, not a symlink: ${workspace}`);
  }
  if (!workspaceStat.isDirectory()) die(`workspace path exists and is not a directory: ${workspace}`);
  if (readdirSync(workspace).length > 0) {
    die(
      `workspace already exists and is not empty: ${workspace} — use one fresh scratch directory per condition`,
    );
  }
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
const inheritedCampaignEntries = campaignEntries.filter((entry) => entry !== "workspace");
if (inheritedCampaignEntries.length > 0) {
  die(
    `--campaign-dir already contains prior condition state (${inheritedCampaignEntries.join(", ")}): ${campaignPath} — use one fresh scratch directory per condition`,
  );
}
if (seedDir !== undefined && resolve(seedDir) === workspace) {
  die("--seed-dir must differ from the segment workspace");
}
if (parsed.flags.has("check")) die("preflight passed; --check stops before the session opens", 0);

/** Keep the production backend graph behind every provider-free refusal above. Besides making the
 * boundary literal, this keeps a hostile preflight matrix from loading transports 41 times. */
const [
  buildAgentModule,
  executionModule,
  backendModule,
  runtimeModule,
  workspaceModule,
  sessionEvidenceModule,
  startPromptModule,
  actorModule,
] = await Promise.all([
  import("#src/author/build-agent.ts"),
  import("#src/author/builder-execution.ts"),
  import("#src/run/builder-backend.ts"),
  import("#src/run/builder-runtime.ts"),
  import("#src/author/domain-repo.ts"),
  import("#src/builder/session-evidence.ts"),
  import("#src/author/builder-start-prompt.ts"),
  import("./segment-actor.mts"),
]);
const { BuildAgentTurnNonResult } = buildAgentModule;
const { BuilderExecutionRecorder } = executionModule;
const { builderSessionOpener, builderSlot } = backendModule;
const { BUILDER_WORKSPACE_CARD } = startPromptModule;
const { segmentActor } = actorModule;
const { initWorkspace, writeExcludeRules } = workspaceModule;
const { campaignBuilderMount } = runtimeModule;
const { writeBuilderSessionEvidence } = sessionEvidenceModule;
const mount = withTools ? campaignBuilderMount(REPO_ROOT, slug, campaignPath) : null;
const tools = mount?.tools ?? [];
const toolNames = tools.flatMap((tool) => {
  const named = asRecord(tool)?.name;
  return isString(named) ? [named] : [];
});

/** Production refreshes these on every resumed repository, so a seed's own copies are allowed to move. */
const STARTER_REFRESHED = ["STARTER.md", "starter-pack/"] as const;

/** Regular files under a tree with their digests, keyed by relative path. Links and the runtime,
 *  package and tool trees are left out: initWorkspace repoints them on purpose. */
function regularFileDigests(root: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of new Bun.Glob("**/*").scanSync({
    cwd: root,
    dot: true,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (
      /^(\.git|node_modules|\.toolchain)\//.test(name) ||
      STARTER_REFRESHED.some((prefix) => name.startsWith(prefix))
    ) {
      continue;
    }
    if (lstatSync(join(root, name)).isSymbolicLink()) continue;
    out.set(name, sha256OfFile(join(root, name)));
  }
  return out;
}

function gitInWorkspace(dir: string, args: readonly string[]): void {
  try {
    gitText(dir, ...SEGMENT_IDENTITY, ...args);
  } catch (error) {
    die(`git ${args[0]} on the seeded workspace failed: ${errorMessage(error)}`);
  }
}

/** Copy the seed, then give a history-less seed (a `git archive` export, a copied bundle) its own root
 *  commit. `initWorkspace` lays the production skeleton over any directory without `.git`; on
 *  2026-09-13 that replaced a seeded adopted product with one-line placeholders and both conditions
 *  measured a rebuild from nothing. With the root committed, initWorkspace takes its resume path and
 *  the product bytes stay the position. */
function seedSegmentWorkspace(seed: string, target: string): SeedCopy {
  cpSync(seed, target, { recursive: true, verbatimSymlinks: true });
  const committed = !existsSync(join(target, ".git"));
  if (committed) {
    gitInWorkspace(target, ["init", "-q"]);
    writeExcludeRules(target);
    gitInWorkspace(target, ["add", "-A"]);
    gitInWorkspace(target, ["commit", "-q", "--allow-empty", "-m", `segment: seed from ${seed}`]);
  }
  return { dir: seed, files: regularFileDigests(seed), committed };
}

/** The hostile check the 2026-09-13 conditions lacked: every seeded product byte must still be in place
 *  once initWorkspace has run. A difference is a setup fault and ends the segment before any spend. */
function verifySeedSurvived(seed: SeedCopy, target: string): void {
  const after = regularFileDigests(target);
  const changed = seed.files
    .entries()
    .filter(([name, digest]) => after.get(name) !== digest)
    .map(([name]) => name)
    .toArray();
  if (changed.length > 0) {
    die(
      `seed overwritten after initWorkspace: ${changed.length} of ${seed.files.size} seeded files differ (first: ${changed[0]}); owner simulation setup, not the actor`,
    );
  }
}

const seed = seedDir === undefined ? null : seedSegmentWorkspace(resolve(seedDir), workspace);
/** The same call `runBuilderCampaign` makes before it opens a session, and for the same reason: a
 *  workspace is not a directory of files. It is a Git repository whose `.git/info/exclude` states
 *  the candidate contract, a starter pack the Builder is expected to read, a `.toolchain/bun` link
 *  to this controller's interpreter and the two linked package scopes generated imports resolve
 *  through. `initWorkspace` is idempotent: it re-links the runtime and the scopes on every call and
 *  seeds the starter only when no `.git` is there, so an empty workspace gets the production
 *  skeleton and a seeded one keeps its own history while its links are repointed at THIS tree. A
 *  copied tree's links otherwise still point at the tree it was copied from, which is the recorded
 *  `Cannot find module '@ana/agent-bundle'` fault. */
initWorkspace(workspace);
if (seed !== null) verifySeedSurvived(seed, workspace);

note(`tree        ${REPO_ROOT}`);
note(`backend     ${condition.kind}`);
note(
  `model       ${condition.model ?? "(unresolved)"}${single.has("model") ? "" : " (Builder slot default)"}`,
);
note(`effort      ${condition.reasoningEffort}`);
note(`campaign    ${campaignPath}`);
note(`workspace   ${workspace}`);
note(`tools       ${withTools ? `${tools.length} composed by campaignBuilderMount` : "none (--no-tools)"}`);
if (seed !== null) {
  note(
    `seed        ${seed.dir} → workspace (${seed.files.size} regular files verified${seed.committed ? ", committed as the root" : ", own history kept"})`,
  );
}
note(`skeleton    initWorkspace: starter pack, exclude rules, .toolchain/bun and package scopes`);
if (withTools) {
  note(`roster      ${toolNames.join(", ")}`);
  note(
    `absent      ${CONTROLLER_GATES.join(", ")}: controller-owned gates a segment does not mount; it measures authoring, not admission (cases/authoring-comparison.md)`,
  );
}
if (predictions !== null) note(`predictions ${predictions.path} sha256 ${predictions.sha256.slice(0, 16)}…`);
note(`segment     ${steps.map((s) => `${s.call.role}@${s.turns}`).join(" → ")}`);
note(`budget      ${maxTurns} turns total (asked for ${steps.reduce((sum, s) => sum + s.turns, 0)})`);
note(
  `wall        ${turnTimeoutMs} ms per turn${turnTimeoutMs === BUILDER_TURN_SETTLE_MS ? " (production BUILDER_TURN_SETTLE_MS)" : " (--timeout-ms; production uses " + String(BUILDER_TURN_SETTLE_MS) + ")"}`,
);
note(
  `handover    ${handoverPath === undefined ? "none — each step's prompt is operator-written" : resolve(handoverPath)}`,
);
note("");

/** The per-turn tool-count trail. It does not identify paths read. The recorder's aggregate cannot say which step read what or which turn
 * spent the tokens, so each completed turn carries its own tally and usage. */
const trail: TrailRow[] = [];
let currentStep = "(before first step)";
let turnOrdinal = 0;
let turnStartedAt = Date.now();

class TrailRecorder extends BuilderExecutionRecorder {
  /** `reportedUsage` arrives on the `turn_ended` event, before `turnCompleted` (build-agent.ts),
   *  so the turn's own usage is waiting here when its row is written. */
  private pendingUsage: TurnUsage | null = null;

  override reportedUsage(usage: TurnUsage, ending: "final" | "estimated"): void {
    this.pendingUsage = usage;
    super.reportedUsage(usage, ending);
  }

  override turnCompleted(result: AgentTurnResult): void {
    turnOrdinal += 1;
    const usage = this.pendingUsage;
    this.pendingUsage = null;
    trail.push({
      step: currentStep,
      turn: turnOrdinal,
      status: result.status,
      ms: Date.now() - turnStartedAt,
      toolCalls: { ...result.toolCalls?.byName },
      failedToolCalls: { ...result.toolCalls?.failedByName },
      ...keyIfNotNull("usage", usage === null ? null : { ...usage }),
    });
    super.turnCompleted(result);
  }
}

const recorder = new TrailRecorder();
const openBuilder = builderSessionOpener(builderSlot(condition, REPO_ROOT), workspace);
/** The captured system bytes replace the workspace card, and the session evidence names them. */
function openSegmentSession() {
  if (systemPrompt !== null && mount !== null) {
    writeBuilderSessionEvidence({ ...mount.evidenceInput, tools: mount.tools, framing: systemPrompt.text });
  }
  return openBuilder(tools, systemPrompt?.text ?? BUILDER_WORKSPACE_CARD);
}
let primary: ReturnType<typeof segmentActor> | undefined;

const loop = await (async () => {
  try {
    return await runSegmentLoop({
      steps,
      maxTurns,
      continuation,
      primary: (attemptGate) => {
        primary = segmentActor({
          open: openSegmentSession,
          workspace,
          recorder,
          attemptGate,
          maxTurns,
          turnTimeoutMs,
        });
        return primary;
      },
      trail,
      workspace,
      campaignDir: campaignPath,
      handover: isHandover(handoverExport) ? handoverExport : null,
      classifyError: (error) =>
        error instanceof BuildAgentTurnNonResult ? "non-result" : "script-or-setup-fault",
      beforeTurn: (step) => {
        currentStep = step;
        turnStartedAt = Date.now();
      },
      note,
    });
  } finally {
    await primary?.dispose();
  }
})();
const { results, handovers, spent, stopped } = loop;
if (!asJson) {
  for (const result of results) {
    if (result.text !== undefined) console.log(`\n===== ${result.role} =====\n${result.text}`);
  }
}
if (stopped !== null) note(`stopped     ${stopped} after ${spent} of ${maxTurns} turns`);

/** The recorder is production's own: it holds the served identity, the provider's reported spend and
 *  the per-tool tally. A segment that cannot name the identity that served it has measured an
 *  unknown model, which is not a condition anyone can repeat. */
// Production's own outcome words: a segment that ran every step through is a recorded trail, and
// one the loop stopped ran out of turns, which is what `turn-bound` says there.
const evidence = recorder.finish(completedSegment(steps, loop) ? "recorded" : "turn-bound");

/** The seed is reported as one row, or not at all; `verified` is `true` because `verifySeedSurvived`
 *  has already ended the run if it was not. */
const seedRow =
  seed === null
    ? null
    : { dir: seed.dir, regularFiles: seed.files.size, rootCommitted: seed.committed, verified: true };

if (asJson) {
  console.log(
    JSON.stringify(
      {
        condition,
        ...keyIfNotNull("systemPrompt", systemPrompt),
        campaignDir: campaignPath,
        ...keyIfNotNull("seedDir", seed?.dir ?? null),
        ...keyIfNotNull("seed", seedRow),
        tools: toolNames,
        absentGates: withTools ? [...CONTROLLER_GATES] : [],
        ...keyIfDefined("acceptedUnreachable", acceptUnreachable),
        ...keyIfNotNull("predictions", predictions),
        budget: { maxTurns, spent, stopped, turnTimeoutMs },
        steps: results,
        handovers,
        trail,
        evidence,
      },
      null,
      2,
    ),
  );
} else {
  note("");
  note(
    `identity    ${evidence.runtimeIdentity ? JSON.stringify(evidence.runtimeIdentity) : "(backend reported none)"}`,
  );
  note(`turns       ${evidence.turns} (${spent} of the ${maxTurns}-turn budget)`);
  for (const row of handovers) {
    note(
      `handover    ${row.afterStep}→${row.afterStep + 1} ${row.ok ? "through" : "refused"}${row.wroteNextPrompt ? " (wrote the next prompt)" : ""} — ${row.reason}`,
    );
  }
  note(`tools       ${JSON.stringify(evidence.toolCalls)}`);
  note(`usage       ${JSON.stringify(evidence.usage)}`);
  for (const row of trail) {
    const calls = Object.keys(row.toolCalls).length === 0 ? "no tool call" : JSON.stringify(row.toolCalls);
    const out = row.usage?.outputTokens;
    note(
      `trail       [${row.step}] turn ${row.turn} ${row.status} ${Math.round(row.ms / 1000)}s ${calls}${out === undefined || out === null ? "" : ` out:${out}`}`,
    );
  }
  /** The recorded failure of this script is not a wrong answer, it is an unread one: four conditions ran on
   *  2026-08-17 and their pre-registered predictions sat unresolved while the session moved on. Print
   *  the open list by name so the last thing on the terminal is the work that remains. */
  if (predictions !== null) {
    const ids = [...predictions.text.matchAll(/^(P\d+)\b/gm)].map((m) => m[1]);
    note("");
    note(`UNRESOLVED  ${ids.length === 0 ? "(no P-numbered lines found)" : ids.join(", ")}`);
    note(`            resolve each against the trail and the workspace, then append the resolution to`);
    note(`            ${predictions.path}. The recorded segment still needs its predictions reviewed.`);
  }
}

/** A refused handover and a spent budget are results, not script faults, and they exit non-zero so a
 *  wrapper cannot read an unfinished segment as a cleared path. */
runtimeProcess.exitCode =
  results.every((r) => r.outcome === "completed" || r.outcome === "step-settled") && stopped === null ? 0 : 1;
