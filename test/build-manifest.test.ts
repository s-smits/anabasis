/**
 * What `build-manifest.ts` composes from a frozen snapshot, and what it refuses to launch.
 *
 * The builder is a command, so every rule here spawns it. What each test varies is one argument or
 * one field of the snapshot; the rest is the same launch every time. So one `snapshot()` writes the
 * digest-bound tree trace-review writes and amends it in place, and one `launch()` supplies the
 * standing arguments and reads back what was written. A test states its difference and its
 * assertions, not the ten lines around them.
 *
 * The launches read a generated catalogue and index in the maintained shape, so a hostile variant
 * is one edit of a fixture the test owns; one test lists the live catalogue, which is where the
 * maintained references and this shape are proved to agree. `compose-groups.ts` reads the native
 * prompts a launch writes, for one run or across several, so its tests compose from them.
 */
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { dirname, join, resolve } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { PINNED_BUN_VERSION } from "../src/run/host-runtime-policy.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  ANGLE_COUNT,
  DETERMINISTIC_ROW_TITLES,
  DIGEST_VERDICTS,
  FIX_AUTHORITY,
  GROUND_TRUTH_LANE,
  HARDWARE_TARGET_LANE,
  ISOLATED_ANGLES,
  leafPrompt,
  MIN_AUTO_SESSIONS,
  READ_ONLY_AUTHORITY,
  PUBLIC_ONLY_LANE,
  scratchAuthority,
  TRACE_CHALLENGE_LANE,
} from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.ts";
import {
  agentPrompt,
  buildLanes,
  collectReports,
  type LanesOptions,
  modelCheck,
  renderSynthesis,
} from "../.claude/skills/whole-run-investigation/scripts/investigation.ts";
import {
  type AcrossRuns,
  availableLanes,
  checkComposed,
  type ComposedGroup,
  composeLanes,
  composeRuns,
  type GroupSize,
  loadLaneGroups,
  planGroups,
  readRun,
  runsPreamble,
  writeGroups,
} from "../.claude/skills/whole-run-investigation/scripts/compose-groups.ts";
import {
  MULTI_RUN_OUTCOMES,
  MULTI_RUN_PILES,
  REPORT_SECTIONS,
} from "../.claude/skills/whole-run-investigation/scripts/manifest-reporting.ts";

type View = { label: string; file: string; status: string; required: boolean; bytes: number; sha256: string };
type Status = {
  schema: string;
  capturedAt: string;
  campaign: string;
  repo: string;
  runIds: string[];
  source: { commit: string; dirty: boolean; sourceDigest: string };
  worktree: { path: string; head: string; dirty: boolean };
  runtime: { version: string; executable: string };
  complete: boolean;
  views: View[];
  facts?: { terminalAccounting: TerminalAccounting };
};
/** The part of trace-review's `terminalAccounting` projection the manifest renders. */
type TerminalAccounting = {
  controller: { state: string; error?: string };
  outerCap?: number;
  completedRounds?: number;
  counts: { raw: number | null; real: number | null; controller: number | null };
  parents?: { lastCandidate: string | null; adopted: string | null; accepted: string | null };
};
type Admission = {
  schema: string;
  mode: string;
  state: string;
  identityKey: string;
  lanes: number[];
  triggers: string[];
};
type Task = { name: string; task: string; admission: Admission; scratch: string | null };
type LunaRow = { name: string; task: string; workdir?: string; sandbox?: string; ownedPaths?: string[] };
type Snapshot = ReturnType<typeof snapshot>;
type Edit = (text: string) => string;

const REPO = resolve(import.meta.dirname, "..");
const SKILL = join(REPO, ".claude/skills/whole-run-investigation");
const SCRIPT = join(SKILL, "scripts/build-manifest.ts");
const VALIDATOR = join(SKILL, "scripts/validate-reports.ts");
const OPEN_LANES = ANGLE_COUNT - ISOLATED_ANGLES.size;
const SCAN_VIEW = JSON.stringify({
  findings: [{ rule: "telemetry-constant", battery: "run-1-on", statement: "turns is 1." }],
});
/** The shared instructions every launch carries; the tests that are not about them use these. */
const SHARED = [
  "## Orientation",
  "",
  "1. The product is a link budget checker.",
  "2. Loose end: usb-pd is 0/6.",
  "",
  "## The moved variable and prior state",
  "",
  "none",
  "",
  "## Hard rules",
  "",
  "- HARD_RULE: never quote campaign text.",
  "",
].join("\n");
/** The operator directive a firmware run's journal records, which names three boards. */
const FIRMWARE_REQUEST =
  "Build a harness that writes firmware for ESP32, Raspberry Pi Pico and Arduino Uno, where the code must compile.";
/** The lane titles of the maintained catalogue, so the fixture reads like the real one. */
const LANE_TITLES = [
  "Request-to-verdict chain",
  "Executable verifier dependency closure",
  "Authoring-to-host contract compatibility",
  "Operating guide and roster truth",
  "Limit slack against the reference",
  "Check discrimination and binding",
  "Valid-alternative rejection challenge",
  "Public disclosure and one-recipe",
  "Rehearsal instrument reach",
  "Difficulty calibration loop",
  "Submit decision against rehearsal evidence",
  "Epoch Reviewer standing duties",
  "Public-safe feedback sufficiency",
  "Finding routing and recurrence",
  "Harness-versus-evaluation triage hand-off",
  "Judge disagreement adjudication",
  "Round hand-off census",
  "Same-task repair measurement",
  "Semantic repair closure",
  "Task movement and attribution",
  "Source-delta reach",
  "Solver process and walls",
  "Trace challenge",
  "Time, spend and provider waits",
  "Failure mechanism and non-result honesty",
  "Builder memory and posture",
];
const pad = (number: number): string => String(number).padStart(2, "0");
const laneName = (number: number): string => `lane_${pad(number)}`;
const sha256 = (body: string): string =>
  new Bun.CryptoHasher("sha256").update(new TextEncoder().encode(body)).digest("hex");
const byteLength = (body: string): number => new TextEncoder().encode(body).byteLength;
const laneNames = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, index) => laneName(from + index));
const allLanes = (): number[] => Array.from({ length: ANGLE_COUNT }, (_, index) => index + 1);
/** The session names a full sweep produces when every isolated lane fired: each isolated lane
 *  alone, and the open lanes between them in contiguous groups, the lanes after the ground-truth
 *  lane in one group of their own. */
const FULL_SWEEP = [
  `lanes_01_${pad(PUBLIC_ONLY_LANE - 1)}`,
  laneName(PUBLIC_ONLY_LANE),
  `lanes_${pad(PUBLIC_ONLY_LANE + 1)}_${pad(TRACE_CHALLENGE_LANE - 1)}`,
  laneName(TRACE_CHALLENGE_LANE),
  `lanes_${pad(TRACE_CHALLENGE_LANE + 1)}_${pad(GROUND_TRUTH_LANE - 1)}`,
  laneName(GROUND_TRUTH_LANE),
  ...(ANGLE_COUNT > GROUND_TRUTH_LANE ? [`lanes_${pad(GROUND_TRUTH_LANE + 1)}_${pad(ANGLE_COUNT)}`] : []),
];

afterEach(cleanupScratch);

function defaultView(verified: number): string {
  return JSON.stringify({
    controller: {
      state: "recorded",
      terminalReason: "candidate-held",
      denominator: { state: "recorded", total: 50, verified: 47, unaccepted: 0, nonResults: 3 },
    },
    caseRecord: "present",
    batteries: {
      "run-1-on": {
        cases: {
          total: 25,
          verified,
          passed: 18,
          failed: 7,
          unaccepted: 0,
          nonResults: { total: 0, byKind: {} },
        },
        passRate: { successes: 18, n: 25, rate: 0.72, wilson: { lower: 0.524, upper: 0.857 } },
        families: { "usb-pd": { total: 6, verified: 6, passed: 0, unaccepted: 0, nonResults: 0 } },
        identity: { backendPins: ["claude/claude-opus-5"], variants: ["on"], slugs: ["demo"] },
      },
    },
  });
}

/** The trigger paragraph of one fixture lane, in the spelling the manifest carries verbatim. */
function laneTrigger(number: number): string {
  return `Starts from block ${number}'s finding for ${LANE_TITLES[number - 1]?.toLowerCase()}.`;
}

/** A catalogue in the maintained shape: rows A-I, then every lane with its heading on its own
 *  line, a blank line and its `Starts from` paragraph. `lanes` lets a hostile case declare fewer
 *  or more. */
function catalogueText(lanes = ANGLE_COUNT): string {
  const rows = Object.entries(DETERMINISTIC_ROW_TITLES).map(
    ([letter, title]) => `**${letter}. ${title}.** Settled by the primary reviewer.\n`,
  );
  const bodies = Array.from({ length: lanes }, (_, index) => {
    const number = index + 1;
    const title = LANE_TITLES[index] ?? `Lane ${number}`;
    return `**${number}. ${title}.**\n\n${laneTrigger(number)}\n\nRead the recorded rows for ${title.toLowerCase()}.\n`;
  });
  return ["# Review angles\n", "## Deterministic rows A–I\n", ...rows, "## Semantic lanes\n", ...bodies].join(
    "\n",
  );
}

/** The session index: the catalogue's headings byte for byte, one sentence each, no trigger. */
function indexText(lanes = ANGLE_COUNT): string {
  const rows = Object.entries(DETERMINISTIC_ROW_TITLES).map(
    ([letter, title]) => `**${letter}. ${title}.** One sentence.\n`,
  );
  const bodies = Array.from({ length: lanes }, (_, index) => {
    const title = LANE_TITLES[index] ?? `Lane ${index + 1}`;
    return `**${index + 1}. ${title}.** One sentence about ${title.toLowerCase()}.\n`;
  });
  return ["# Session index\n", ...rows, ...bodies].join("\n");
}

/** The fixture catalogue and index on disk, each optionally edited into a hostile variant. */
function references(angles: Edit = (text) => text, index: Edit = (text) => text): string[] {
  const dir = scratchDir("ana-build-references-");
  const anglesPath = join(dir, "review-angles.md");
  const indexPath = join(dir, "session-index.md");
  writeFileSync(anglesPath, angles(catalogueText()));
  writeFileSync(indexPath, index(indexText()));
  return ["--angles", anglesPath, "--index", indexPath];
}

/** The clean commit a snapshot's identity is bound to. The builder resolves HEAD and the dirty flag
 *  itself, so the fixture needs a real repository, not a recorded sha. */
function identityRepo() {
  const path = scratchDir("ana-build-identity-");
  const git = (...args: string[]): void => {
    const result = spawnSync("git", ["-C", path, ...args]);
    if (result.status !== 0) throw new Error(result.stderr);
  };
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  writeFileSync(join(path, "identity.txt"), "clean identity\n");
  writeFileSync(join(path, "package.json"), JSON.stringify({ engines: { bun: PINNED_BUN_VERSION } }));
  git("add", ".");
  git("commit", "-qm", "identity");
  return { path, head: spawnSync("git", ["-C", path, "rev-parse", "HEAD"]).stdout.trim() };
}

/** The campaign a snapshot names: its journal records the operator directive, which names hardware
 *  unless the test says otherwise. */
function recordedCampaign(request: string, runId: string): string {
  const campaign = scratchDir("ana-build-campaign-");
  mkdirSync(join(campaign, "observability"), { recursive: true });
  writeFileSync(
    join(campaign, "observability", `${runId}.jsonl`),
    `${JSON.stringify({ type: "prompt-ingested", contract: "builder", role: "user-directive", prompt: request })}\n`,
  );
  return campaign;
}

/** A complete digest-bound snapshot in the shape trace-review writes, with 25 verified cases, a
 *  complete trace-challenge packet and a firmware request unless the test says otherwise. */
function snapshot(
  options: {
    complete?: boolean;
    runtime?: string;
    verified?: number;
    packet?: boolean;
    request?: string;
    runId?: string;
  } = {},
) {
  const dir = scratchDir("ana-build-snapshot-");
  const runId = options.runId ?? "run-1";
  const campaign = recordedCampaign(options.request ?? FIRMWARE_REQUEST, runId);
  const repo = identityRepo();
  const views: View[] = [];
  const put = (label: string, body: string, file = `${label}.txt`, status = "ok"): void => {
    writeFileSync(join(dir, file), body);
    views.push({ label, file, status, required: true, bytes: byteLength(body), sha256: sha256(body) });
  };
  put("digest", "# deterministic digest\n", "digest.md");
  put(
    "review-yield",
    JSON.stringify({ schema: "wri-review-yield-report/v1", components: [], complete: true }),
    "review-yield.json",
  );
  put("builder", JSON.stringify({ schema: "builder" }));
  put(`${runId}-default`, defaultView(options.verified ?? 25));
  put(`${runId}-scan`, SCAN_VIEW);
  for (const mode of [
    "scorecard",
    "observations-warning",
    "cases-fail",
    "cases-unaccepted",
    "cases-non-result",
    "cases-pass",
  ]) {
    put(`${runId}-${mode}`, "{}\n");
  }

  const challenge = join(dir, "trace-challenge");
  const telemetry = '{"schema":"trace-telemetry/v1"}\n';
  const packet = '{"schema":"whole-run-trace-challenge/v1"}\n';
  if (options.packet !== false) {
    mkdirSync(challenge, { recursive: true });
    writeFileSync(join(challenge, "trace-telemetry.json"), telemetry);
    writeFileSync(join(challenge, "trace-challenge-packet.json"), packet);
    writeFileSync(join(challenge, "trace-challenge-prompt.md"), "# challenge\n");
    writeFileSync(
      join(challenge, "trace-challenge-status.json"),
      JSON.stringify({
        schema: "whole-run-trace-challenge-status/v1",
        complete: true,
        campaign,
        runId,
        telemetry: join(challenge, "trace-telemetry.json"),
        packet: join(challenge, "trace-challenge-packet.json"),
        prompt: join(challenge, "trace-challenge-prompt.md"),
        telemetrySha256: sha256(telemetry),
        packetSha256: sha256(packet),
      }),
    );
  }

  const status: Status = {
    schema: "outcome-snapshot-status/v2",
    capturedAt: "2026-08-14T07:51:39.654Z",
    campaign,
    repo: repo.path,
    runIds: [runId],
    source: { commit: repo.head, dirty: false, sourceDigest: "d".repeat(64) },
    worktree: { path: repo.path, head: repo.head, dirty: false },
    runtime: { version: options.runtime ?? PINNED_BUN_VERSION, executable: Bun.argv[0]! },
    complete: options.complete ?? true,
    views,
  };
  const statusPath = join(dir, "snapshot-status.json");
  const save = (): void => writeFileSync(statusPath, JSON.stringify(status));
  save();

  return {
    dir,
    status,
    /** Change the recorded status the way a different capture would have written it. */
    amend(change: (status: Status) => void) {
      change(status);
      save();
    },
    /** Replace a view's bytes and its frozen digest together, as a capture would. */
    recapture(label: string, body: string, state: string) {
      const view = status.views.find((row) => row.label === label);
      if (view === undefined) throw new Error(`fixture has no ${label} view`);
      writeFileSync(join(dir, view.file), body);
      this.amend(() => {
        view.status = state;
        view.bytes = byteLength(body);
        view.sha256 = sha256(body);
      });
    },
    /** Change bytes behind their frozen digest, which is what drift looks like. */
    corrupt(file: string, body: string) {
      writeFileSync(join(dir, file), body);
    },
  };
}
function notes(body: string): string {
  const path = join(scratchDir("ana-build-notes-"), "notes.md");
  writeFileSync(path, body);
  return path;
}

/** A shared-instructions file, as `wri.ts start` writes one and the primary edits it. */
function sharedInstructions(text: string = SHARED): string {
  const path = join(scratchDir("ana-build-shared-"), "shared-instructions.md");
  writeFileSync(path, text);
  return path;
}

/** A run overview whose one line is `fact`, as the `overview` lane writes one. */
function runOverview(fact = "- RECORDED_FACT: the snapshot is complete."): string {
  const path = join(scratchDir("ana-build-overview-"), "run-overview.md");
  writeFileSync(path, `${fact}\n`);
  return path;
}

/** The two instruction files a launch requires, unless the test passes its own. */
function instructionArgs(args: readonly string[]): string[] {
  return [
    ...(args.includes("--shared-instructions") ? [] : ["--shared-instructions", sharedInstructions()]),
    ...(args.includes("--run-overview") ? [] : ["--run-overview", runOverview()]),
  ];
}

/** The builder against the fixture references, with the standing arguments every launch carries
 *  and readers for what it wrote. The worktree is the snapshot's own: the builder refuses a
 *  requested one that differs, and no test here is about that refusal. */
function launch(snap: Snapshot | null, ...args: string[]) {
  const out = join(scratchDir("ana-build-out-"), "launch");
  const bound =
    snap === null
      ? []
      : [
          "--snapshot",
          snap.dir,
          "--worktree",
          snap.status.worktree.path,
          "--out",
          out,
          ...instructionArgs(args),
        ];
  const refs = args.includes("--angles") ? [] : references();
  const run = spawnSync(Bun.argv[0]!, [SCRIPT, ...bound, ...refs, ...args]);
  const read = (...path: string[]): string => readFileSync(join(out, ...path), "utf8");
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    out,
    tasks: (file = "tasks.json"): Task[] => parseJsonAs<Task[]>(read(file)),
    task: (name: string): Task | undefined =>
      parseJsonAs<Task[]>(read("tasks.json")).find((row) => row.name === name),
    instructions: (): string => read("instructions.md"),
    prompt: (name: string): string => read("prompts", `${name}.md`),
  };
}

describe("what the builder declares", () => {
  it("lists every lane of the live catalogue, marking the isolated ones", () => {
    const listed = spawnSync(Bun.argv[0]!, [SCRIPT, "--list"]);
    const names = listed.stdout
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name): name is string => Boolean(name));

    expect(listed.status).toBe(0);
    expect(names).toEqual(laneNames(1, ANGLE_COUNT));
    for (const [number, reason] of ISOLATED_ANGLES) {
      const row = listed.stdout.split("\n").find((line) => line.startsWith(laneName(number)));
      expect(row).toContain(`isolated: ${reason}`);
    }
  });

  it("lists the fixture catalogue in the same shape", () => {
    const listed = launch(null, "--list");
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain(`${laneName(PUBLIC_ONLY_LANE).padEnd(12)} ${PUBLIC_ONLY_LANE}. `);
    expect(listed.stdout.match(/^lane_\d{2}/gm)).toHaveLength(ANGLE_COUNT);
  });

  it("refuses a catalogue one lane short or one lane over, a missing row, or a misplaced row", () => {
    for (const lanes of [ANGLE_COUNT - 1, ANGLE_COUNT + 1]) {
      const result = launch(
        null,
        "--list",
        ...references(
          () => catalogueText(lanes),
          () => indexText(lanes),
        ),
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain(
        `catalogue-lane-count: review-angle catalogue must declare lanes 1-${ANGLE_COUNT}`,
      );
    }

    const missing = launch(null, "--list", ...references((text) => text.replace(/^\*\*H\..*\n/m, "")));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain(
      "catalogue-lane-count: review-angle catalogue must declare deterministic rows A-I",
    );

    const misplaced = launch(
      null,
      "--list",
      ...references((text) => {
        const row = /^\*\*I\..*\n/m.exec(text)?.[0] ?? "";
        return text.replace(row, "").replace("**2. ", `${row}\n**2. `);
      }),
    );
    expect(misplaced.status).toBe(2);
    expect(misplaced.stderr).toContain("keep deterministic rows A-I before lane 1");
  });

  it("refuses a lane whose body has no `Starts from` paragraph", () => {
    const result = launch(
      null,
      "--list",
      ...references((text) => text.replace(laneTrigger(3), "Begins with block 3's finding.")),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      "lane-without-trigger: lane 3 must carry exactly one paragraph beginning `Starts from`",
    );
  });

  it("refuses a session index whose titles or lanes no longer match the catalogue", () => {
    const drifted = launch(
      null,
      "--list",
      ...references(
        (text) => text,
        (text) => text.replace("**4. Operating guide and roster truth.**", "**4. Operating guide truth.**"),
      ),
    );
    expect(drifted.status).toBe(2);
    expect(drifted.stderr).toContain("session-index-drift: session index title for lane_04");

    const short = launch(
      null,
      "--list",
      ...references(
        (text) => text,
        () => indexText(ANGLE_COUNT - 1),
      ),
    );
    expect(short.status).toBe(2);
    expect(short.stderr).toContain(`session-index-drift: session index must declare lanes 1-${ANGLE_COUNT}`);
  });
});

describe("what a launch composes", () => {
  it("derives the facts, bodies and triggers, leaving only the notes authored", () => {
    const result = launch(
      snapshot(),
      "--notes",
      notes("## lane_05\nusb-pd is 0/6 on one variant.\n\n## custom:devil\nArgue the opposite.\n"),
    );
    const tasks = result.tasks();
    const instructions = result.instructions();

    expect(result.status).toBe(0);
    expect(tasks.map((task) => task.name)).toEqual(["lane_05", "devil"]);
    // The launcher transport carries exactly the same rows, and nothing else.
    const launcherTasks = result.tasks("luna-tasks.json");
    expect(launcherTasks).toHaveLength(tasks.length);
    expect(launcherTasks.every((task) => Object.keys(task).sort().join(",") === "name,task")).toBe(true);
    // The body and the trigger came from the catalogue, not from the notes file.
    expect(tasks[0]?.task).toContain(`startsFrom: lane 05: ${laneTrigger(5)}`);
    expect(tasks[0]?.task).toContain("Read the recorded rows for limit slack against the reference.");
    expect(tasks[0]?.task).toContain("assignedLanes: 05");
    expect(tasks[0]?.task).toContain("usb-pd is 0/6 on one variant.");
    expect(tasks[0]?.admission).toEqual({
      schema: "wri-progressive-admission/v2",
      mode: "targeted",
      state: "active",
      identityKey: "lane_05",
      lanes: [5],
      triggers: [laneTrigger(5)],
    });
    for (const other of ["**A. ", "**H. ", "**4. ", "**6. "]) expect(tasks[0]?.task).not.toContain(other);
    // A directed task carries its own scope bound instead of a standing lane body.
    expect(tasks[1]?.task).toContain("directed contradiction task");
    expect(tasks[1]?.admission.lanes).toEqual([]);
    // Procedure loading names the launcher, not the different measured-source fixture.
    expect(instructions).toContain(`Review procedure: \`${join(SKILL, "SKILL.md")}\``);
    // Every count below came from the JSON views rather than a reviewer retyping them.
    expect(instructions).toContain("50 total = 47 verified + 0 unaccepted + 3 non-results");
    expect(instructions).toContain("usb-pd 0/6");
    expect(instructions).toContain("Wilson [0.524, 0.857]");
    expect(instructions).toContain("telemetry-constant");
    // The shared instructions arrive whole, before the facts, and the run overview after them.
    expect(instructions).toContain(SHARED.trim());
    expect(instructions).toContain("## Run overview");
    expect(instructions).toContain("RECORDED_FACT");
    expect(instructions.indexOf("## Controller facts")).toBeLessThan(instructions.indexOf("## Run overview"));
    for (const verdict of DIGEST_VERDICTS) {
      expect(instructions.match(new RegExp(`^- ${verdict}:`, "gm"))).toHaveLength(1);
    }
    for (const section of REPORT_SECTIONS) expect(instructions).toContain(`\`### ${section}\``);
    expect(instructions).toContain("2. Loose end: usb-pd is 0/6.");
    expect(instructions.indexOf("## Orientation")).toBeLessThan(instructions.indexOf("## Controller facts"));
    expect(instructions).not.toContain("angle");
  });

  it("states terminal accounting as trace-review projected it, and never sums it from the views", () => {
    const snap = snapshot();
    const unprojected = launch(snap, "--notes", notes("## lane_05\nLook.\n")).instructions();
    // The default view's battery holds 25 cases; a sum of it is not the controller's count.
    expect(unprojected).toContain("raw not recorded; real not recorded; controller-terminal not recorded");
    expect(unprojected).toContain("last candidate not recorded");

    snap.amend((status) => {
      status.facts = {
        terminalAccounting: {
          controller: { state: "refused", error: "terminal.json is not a recorded terminal" },
          counts: { raw: null, real: null, controller: null },
        },
      };
    });
    const refused = launch(snap, "--notes", notes("## lane_05\nLook.\n")).instructions();
    expect(refused).toContain(
      "Controller evidence refused by its strict reader: terminal.json is not a recorded terminal.",
    );

    snap.amend((status) => {
      status.facts = {
        terminalAccounting: {
          controller: { state: "recorded" },
          outerCap: 6,
          completedRounds: 4,
          counts: { raw: 50, real: 47, controller: 4 },
          parents: { lastCandidate: "abc123", adopted: null, accepted: "def456" },
        },
      };
    });
    const recorded = launch(snap, "--notes", notes("## lane_05\nLook.\n")).instructions();
    expect(recorded).toContain("outer-controller cap 6; completed controller rounds 4.");
    expect(recorded).toContain("raw 50; real 47; controller-terminal 4.");
    expect(recorded).toContain("last candidate abc123; adopted not recorded; accepted def456.");
    expect(recorded).not.toContain("strict reader");
  });

  it("keeps outcome context out of the public-only lane across native and launcher transports", () => {
    const publicLane = laneName(PUBLIC_ONLY_LANE);
    const result = launch(
      snapshot(),
      "--sessions",
      `2,${PUBLIC_ONLY_LANE}`,
      "--transport",
      "native",
      "--notes",
      notes(`## ${publicLane}\nFORBIDDEN_DIRECTION: all passed.\n`),
    );
    const common = result.instructions();
    const tasks = result.tasks("luna-tasks.json");

    expect(result.status).toBe(0);
    const task = tasks.find((row) => row.name === publicLane);
    for (const prompt of [result.prompt(publicLane), `${common}\n${task?.task}`]) {
      expect(prompt).toContain("Independent blind review");
      expect(prompt).toContain("original request");
      expect(prompt).toContain("accepted artifact bytes");
      expect(prompt).toContain(`Lane ${PUBLIC_ONLY_LANE} freezes its public-only corpus`);
      expect(prompt).toContain("You are an isolated lane");
      for (const forbidden of [
        "FORBIDDEN_DIRECTION",
        "usb-pd 0/6",
        "Wilson [0.524",
        "telemetry-constant",
        "## Controller facts",
        "Loose end",
        "RECORDED_FACT",
      ]) {
        expect(prompt).not.toContain(forbidden);
      }
      // The hard rules reach the blind lane although the rest of the shared instructions do not.
      expect(prompt).toContain("HARD_RULE");
    }
    // The lane that is not public-only still receives the evidence, and no isolation rule.
    const open = tasks.find((row) => row.name === "lane_02")?.task;
    expect(open).toContain("usb-pd 0/6");
    expect(open).not.toContain("You are an isolated lane");
  });

  // A ground-truth lane given the run overview froze its compiler verdicts already knowing every case
  // had passed (custom-opus 198d70, 2026-09-30), so it gets the blind file the public-only lane gets.
  it("keeps outcome context out of the ground-truth lane, which may still write its scratch", () => {
    const truthLane = laneName(GROUND_TRUTH_LANE);
    const result = launch(
      snapshot(),
      "--sessions",
      `2,${GROUND_TRUTH_LANE}`,
      "--notes",
      notes(`## ${truthLane}\nFORBIDDEN_DIRECTION: all passed.\n`),
    );
    const task = result.task(truthLane);
    const prompt = leafPrompt(result.instructions(), task?.task ?? "", task?.scratch ?? null);

    expect(result.status).toBe(0);
    expect(prompt).toContain("Independent blind review");
    expect(prompt).toContain(`Lane ${GROUND_TRUTH_LANE} also runs the recorded toolchain`);
    for (const forbidden of ["FORBIDDEN_DIRECTION", "usb-pd 0/6", "Wilson [0.524", "## Controller facts"]) {
      expect(prompt).not.toContain(forbidden);
    }
    expect(prompt.endsWith(scratchAuthority(task?.scratch ?? ""))).toBe(true);
    expect(result.task("lane_02")?.task).toContain("usb-pd 0/6");
  });

  // The trace challenge lane of custom-opus 350009 was sent the run orientation under the blind file
  // a ground-truth lane brought, and called its own review contaminated (2026-10-01).
  it("keeps outcome context out of the trace challenge lane, which still reads its private packet", () => {
    const traceLane = laneName(TRACE_CHALLENGE_LANE);
    const result = launch(
      snapshot(),
      "--sessions",
      `2,${TRACE_CHALLENGE_LANE}`,
      "--notes",
      notes(`## ${traceLane}\nFORBIDDEN_DIRECTION: all passed.\n`),
    );
    const prompt = leafPrompt(result.instructions(), result.task(traceLane)?.task ?? "");

    expect(result.status).toBe(0);
    expect(prompt).toContain("Independent blind review");
    expect(prompt).toContain(`Private lane ${TRACE_CHALLENGE_LANE} trace evidence`);
    for (const forbidden of ["FORBIDDEN_DIRECTION", "usb-pd 0/6", "Wilson [0.524", "## Controller facts"]) {
      expect(prompt).not.toContain(forbidden);
    }
    expect(result.task("lane_02")?.task).toContain("usb-pd 0/6");
  });

  it("groups a contiguous range under one heading and adds direction to it", () => {
    const result = launch(
      snapshot(),
      "--sessions",
      "1-4,9",
      "--transport",
      "native",
      "--notes",
      notes("## lanes_01_04\nFollow the validity chain.\n"),
    );
    const tasks = result.tasks();

    expect(result.status).toBe(0);
    expect(tasks.map((task) => task.name)).toEqual(["lanes_01_04", "lane_09"]);
    expect(tasks[0]?.task).toContain("assignedLanes: 01, 02, 03, 04");
    expect(tasks[0]?.task).toContain("Follow the validity chain.");
    expect(tasks[0]?.task).toContain("each headed exactly `## lane_NN`");
    expect(tasks[0]?.task).not.toContain("expectedHeading:");
    expect(tasks[0]?.admission.lanes).toEqual([1, 2, 3, 4]);
    expect(tasks[0]?.admission.triggers).toEqual([1, 2, 3, 4].map(laneTrigger));
    expect(existsSync(join(result.out, "prompts", "lanes_01_04.md"))).toBe(true);
  });

  it("seats each fired isolated lane alone under --auto and hands the packet to the trace lane only", () => {
    const result = launch(snapshot(), "--auto", String(FULL_SWEEP.length), "--transport", "native");
    const tasks = result.tasks();
    const traceLane = laneName(TRACE_CHALLENGE_LANE);
    const privateNote = `Private lane ${TRACE_CHALLENGE_LANE} trace evidence`;

    expect(result.status).toBe(0);
    expect(tasks.map((task) => task.name)).toEqual(FULL_SWEEP);
    expect(tasks.every((task) => task.admission.mode === "exhaustive")).toBe(true);
    expect(tasks.flatMap((task) => task.admission.lanes)).toEqual(allLanes());
    expect(result.task(traceLane)?.task).toContain(privateNote);
    expect(result.task(traceLane)?.task).toContain("You are an isolated lane");
    expect(
      tasks.filter((task) => task.name !== traceLane).every((task) => !task.task.includes(privateNote)),
    ).toBe(true);
    expect(result.prompt(FULL_SWEEP[0]!)).toContain("# Your assignment");
    // A native Claude lane may repair what it proved; the prompt a Luna lane is sent stays read-only.
    for (const name of FULL_SWEEP) {
      expect(result.prompt(name)).toContain(FIX_AUTHORITY);
      expect(result.prompt(name)).not.toContain(READ_ONLY_AUTHORITY);
    }
    const luna = leafPrompt(result.instructions(), result.task(FULL_SWEEP[0]!)?.task ?? "");
    expect(luna).toContain(READ_ONLY_AUTHORITY);
    expect(luna).not.toContain(FIX_AUTHORITY);
  });

  it("leaves an unfired isolated lane out of --auto and refuses selecting it by hand", () => {
    const unfired = snapshot({ verified: 0 });
    const auto = launch(unfired, "--auto", String(MIN_AUTO_SESSIONS), "--transport", "native");
    expect(auto.status).toBe(0);
    // Contiguous open groups and no isolated seat: the exact cut is the partitioner's tie-break.
    expect(auto.tasks()).toHaveLength(MIN_AUTO_SESSIONS);
    expect(auto.tasks().every((task) => /^lanes_\d{2}_\d{2}$/.test(task.name))).toBe(true);
    expect(auto.stderr).toContain(`isolated-lane-untriggered: lane ${PUBLIC_ONLY_LANE}`);
    expect(auto.stderr).toContain(`isolated-lane-untriggered: lane ${TRACE_CHALLENGE_LANE}`);
    expect(auto.stderr).toContain(`isolated-lane-untriggered: lane ${GROUND_TRUTH_LANE}`);
    const admitted = auto.tasks().flatMap((task) => task.admission.lanes);
    expect(admitted).toEqual(allLanes().filter((lane) => !ISOLATED_ANGLES.has(lane)));
    expect(admitted).toHaveLength(OPEN_LANES);

    const selected = launch(unfired, "--sessions", String(PUBLIC_ONLY_LANE), "--notes", notes(""));
    expect(selected.status).toBe(2);
    expect(selected.stderr).toContain(`isolated-lane-untriggered: lane ${PUBLIC_ONLY_LANE}`);
    expect(selected.stderr).toContain("no battery recorded a verified case");
    expect(existsSync(selected.out)).toBe(false);

    const noPacket = launch(
      snapshot({ packet: false }),
      "--notes",
      notes(`## ${laneName(TRACE_CHALLENGE_LANE)}\nInspect the traces.\n`),
    );
    expect(noPacket.status).toBe(2);
    expect(noPacket.stderr).toContain(`isolated-lane-untriggered: lane ${TRACE_CHALLENGE_LANE}`);
    expect(noPacket.stderr).toContain("carries no trace-challenge packet");

    // Verified cases alone do not open the ground-truth lane: the request must name a board.
    const truss = snapshot({ request: "Build a harness that designs steel roof trusses to Eurocode 3." });
    const noBoard = launch(truss, "--sessions", String(GROUND_TRUTH_LANE), "--notes", notes(""));
    expect(noBoard.status).toBe(2);
    expect(noBoard.stderr).toContain(`isolated-lane-untriggered: lane ${GROUND_TRUTH_LANE}`);
    expect(noBoard.stderr).toContain("names a hardware target");
  });

  // Lane 30 must build an adapter and freeze its verdicts to a file of its own before it reads any
  // verdict, and a read-only session can do neither.
  it("gives each hardware session one writable scratch its prompt names, and keeps every other read-only", () => {
    const result = launch(
      snapshot(),
      "--sessions",
      `5,${HARDWARE_TARGET_LANE},${GROUND_TRUTH_LANE}`,
      "--notes",
      notes(""),
    );
    expect(result.status).toBe(0);
    const luna = parseJsonAs<LunaRow[]>(readFileSync(join(result.out, "luna-tasks.json"), "utf8"));
    const instructions = result.instructions();
    for (const lane of [HARDWARE_TARGET_LANE, GROUND_TRUTH_LANE]) {
      const name = laneName(lane);
      const scratch = join(result.out, "hw-scratch", name);
      const task = result.task(name);
      expect(task?.scratch).toBe(scratch);
      expect(task?.task).toContain(`Writable scratch: \`${scratch}\``);
      expect(existsSync(scratch)).toBe(true);
      expect(luna.find((row) => row.name === name)).toMatchObject({
        workdir: scratch,
        sandbox: "workspace-write",
        ownedPaths: [scratch],
      });
      const prompt = leafPrompt(instructions, task?.task ?? "", task?.scratch ?? null);
      expect(prompt.endsWith(scratchAuthority(scratch))).toBe(true);
      expect(prompt).not.toContain(READ_ONLY_AUTHORITY);
    }
    const open = result.task(laneName(5));
    expect(open?.scratch).toBeNull();
    expect(open?.task).not.toContain("Writable scratch");
    expect(luna.find((row) => row.name === laneName(5))).toEqual({
      name: laneName(5),
      task: open?.task ?? "",
    });
    expect(leafPrompt(instructions, open?.task ?? "", null).endsWith(READ_ONLY_AUTHORITY)).toBe(true);
  });

  it("hands the Luna launcher the concurrency cap it was given, and refuses one to the native transport", () => {
    const capped = launch(snapshot(), "--sessions", "5,6", "--notes", notes(""), "--max-active", "4");
    expect(capped.status).toBe(0);
    expect(capped.stdout).toContain("--reasoning-effort max --max-active 4");
    const refused = [
      ["--max-active", "0"],
      ["--transport", "native", "--max-active", "4"],
    ];
    for (const args of refused) {
      const result = launch(snapshot(), "--sessions", "5", "--notes", notes(""), ...args);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("--max-active takes a positive count of concurrent Luna sessions");
    }
  });

  // Both hardware lanes died in 38 ms on 2026-09-30 when --out sat outside every Git work tree,
  // because Codex starts only inside one. The Luna launcher now tells Codex to start anyway for a
  // session that owns all it can write, so where --out sits is no longer the launch's question.
  it("launches a hardware session from an --out outside every Git work tree", () => {
    const snap = snapshot();
    const root = scratchDir("ana-build-outside-git-");
    const recorded = join(root, "launcher-args.json");
    const launcher = join(root, "fake-launcher.ts");
    writeFileSync(
      launcher,
      `await Bun.write(${JSON.stringify(recorded)}, JSON.stringify(Bun.argv.slice(2)));\n`,
    );
    const out = join(root, "lanes");
    const result = spawnSync(
      Bun.argv[0]!,
      [
        SCRIPT,
        "--snapshot",
        snap.dir,
        "--worktree",
        snap.status.worktree.path,
        "--out",
        out,
        ...references(),
        "--sessions",
        `5,${HARDWARE_TARGET_LANE},${GROUND_TRUTH_LANE}`,
        "--notes",
        notes(""),
        ...instructionArgs([]),
        "--launch",
      ],
      // Git looks no higher than the scratch root, so no work tree holds --out wherever tests run.
      { env: { ...Bun.env, WRI_LUNA_LAUNCHER: launcher, GIT_CEILING_DIRECTORIES: dirname(root) } },
    );
    expect(result.stderr).not.toContain("outside any Git work tree");
    expect(result.status).toBe(0);
    const args = parseJsonAs<string[]>(readFileSync(recorded, "utf8"));
    expect(args[args.indexOf("--tasks-file") + 1]).toBe(join(out, "luna-tasks.json"));
    expect(args[args.indexOf("--output-dir") + 1]).toBe(join(out, "luna-output"));
    const luna = parseJsonAs<LunaRow[]>(readFileSync(join(out, "luna-tasks.json"), "utf8"));
    const scratch = join(out, "hw-scratch", laneName(HARDWARE_TARGET_LANE));
    expect(luna.find((row) => row.name === laneName(HARDWARE_TARGET_LANE))).toMatchObject({
      workdir: scratch,
      sandbox: "workspace-write",
      ownedPaths: [scratch],
    });
    expect(existsSync(scratch)).toBe(true);
  });

  it("launches from an incomplete snapshot and names each failed view with its captured error", () => {
    // A failed view is not a fact, and hiding the whole review behind it made the reviewer write
    // the instruction packet by hand. The sessions are told which view failed and why.
    const snap = snapshot({ complete: false });
    snap.recapture(
      "run-1-scan",
      "COMMAND FAILED: outcome /campaigns/demo run-1 --scan\n\nerror: terminal.json: battery run-1-i03 has no record at any derived path\n",
      "failed",
    );

    const result = launch(snap, "--notes", notes("## lane_08\nsomething\n"));
    expect(result.status).toBe(0);
    expect(result.instructions()).toContain(
      "- `run-1-scan` (failed): error: terminal.json: battery run-1-i03 has no record at any derived path",
    );
    expect(result.instructions()).not.toContain("- `run-1-scan`\n");
  });
});

describe("what a launch refuses", () => {
  it("refuses shared instructions with a section left blank, and a launch without them", () => {
    const blank = sharedInstructions(SHARED.replace("none", "<!-- AUTHOR: what moved -->"));
    const unfilled = launch(snapshot(), "--sessions", "5", "--shared-instructions", blank);
    expect(unfilled.status).toBe(2);
    expect(unfilled.stderr).toContain("## The moved variable and prior state");
    expect(existsSync(unfilled.out)).toBe(false);

    // A comment is dropped from what the lanes read; the section it sits in still counts as filled.
    const commented = sharedInstructions(SHARED.replace("none", "none\n<!-- PRIVATE_NOTE -->"));
    const filled = launch(snapshot(), "--sessions", "5", "--shared-instructions", commented);
    expect(filled.status).toBe(0);
    expect(filled.instructions()).not.toContain("PRIVATE_NOTE");

    const out = join(scratchDir("ana-build-out-"), "launch");
    const snap = snapshot();
    const bare = spawnSync(Bun.argv[0]!, [
      SCRIPT,
      "--snapshot",
      snap.dir,
      "--worktree",
      snap.status.worktree.path,
      "--out",
      out,
      ...references(),
      "--sessions",
      "5",
    ]);
    expect(bare.status).toBe(2);
    expect(bare.stderr).toContain("--shared-instructions <shared-instructions.md> --run-overview");
  });

  it("refuses notes under --auto, which directs no lane", () => {
    const result = launch(
      snapshot(),
      "--auto",
      String(FULL_SWEEP.length),
      "--notes",
      notes("## lane_05\nx\n"),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--auto takes no notes");
  });

  it("reports every refusal at once and writes nothing", () => {
    const result = launch(
      snapshot(),
      "--notes",
      notes("## row_E\nsettle from preflight\n\n## lane_99\ntypo\n\n## lane_03\n\n## custom:lane_03\nx\n"),
    );

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("row E (fingerprint and gate census) is settled by the primary reviewer");
    expect(result.stderr).toContain("unknown lane `lane_99`");
    expect(result.stderr).toContain("`lane_03` has no direction");
    expect(result.stderr).toContain("collides with the declared lane");
    expect(existsSync(result.out)).toBe(false);
  });

  it("refuses a range that shares a session with an isolated lane", () => {
    const result = launch(snapshot(), "--sessions", `${PUBLIC_ONLY_LANE - 1}-${PUBLIC_ONLY_LANE + 1}`);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      `lane ${PUBLIC_ONLY_LANE} ${ISOLATED_ANGLES.get(PUBLIC_ONLY_LANE)} and must be its own session`,
    );
    expect(existsSync(result.out)).toBe(false);
  });

  it("refuses a misspelled flag, a retired flag and a relative --out before reading anything", () => {
    const misspelled = launch(snapshot(), "--sesions", "4");
    expect(misspelled.status).toBe(2);
    expect(misspelled.stderr).toContain('unknown option "--sesions"');

    const retired = launch(snapshot(), "--auto", "5", "--diagnostics");
    expect(retired.status).toBe(2);
    expect(retired.stderr).toContain('unknown option "--diagnostics"');

    const relative = launch(null, "--snapshot", "/x", "--worktree", "/x", "--out", "rel", "--sessions", "4");
    expect(relative.status).toBe(2);
    expect(relative.stderr).toContain("--out must be an absolute path");
  });

  it("rejects an auto review that cannot seat each isolated lane alone", () => {
    const belowFloor = launch(snapshot(), "--auto", String(MIN_AUTO_SESSIONS - 1));
    expect(belowFloor.status).toBe(2);
    expect(belowFloor.stderr).toContain(`at least ${MIN_AUTO_SESSIONS} semantic sessions`);
    expect(existsSync(belowFloor.out)).toBe(false);

    // Every isolated lane fired, and each needs a cut on each side it has a neighbour: fewer
    // sessions than the full sweep cannot seat them alone.
    const tooFew = launch(snapshot(), "--auto", String(FULL_SWEEP.length - 1));
    expect(tooFew.status).toBe(2);
    expect(tooFew.stderr).toContain(
      `cannot seat each isolated lane alone; ask for at least ${FULL_SWEEP.length}`,
    );
  });

  it("requires the private packet's digests to match its status when the trace lane is admitted", () => {
    const snap = snapshot();
    writeFileSync(join(snap.dir, "trace-challenge", "trace-telemetry.json"), '{"schema":"edited"}\n');

    const result = launch(
      snap,
      "--notes",
      notes(`## ${laneName(TRACE_CHALLENGE_LANE)}\nInspect recurring solver traces.\n`),
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(
      `lane ${TRACE_CHALLENGE_LANE} trace-challenge telemetry digest does not match its status record`,
    );
  });

  it("refuses a snapshot taken with a Bun the measured worktree does not pin", () => {
    const result = launch(snapshot({ runtime: "0.0.0" }), "--notes", notes("## lane_08\nsomething\n"));

    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`absolute Bun ${PINNED_BUN_VERSION} executable`);
    expect(result.stderr).toContain("received 0.0.0");
  });

  it("refuses snapshot bytes changed after trace-review froze their digest", () => {
    const snap = snapshot();
    snap.corrupt("run-1-default.txt", "{}\n");

    const result = launch(snap, "--notes", notes("## lane_08\nsomething\n"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("run-1-default byte count drifted");
  });

  it("refuses a complete flag that omits one required deterministic view", () => {
    const snap = snapshot();
    snap.amend((status) => {
      status.views = status.views.filter((view) => view.label !== "run-1-cases-non-result");
    });

    const result = launch(snap, "--notes", notes("## lane_08\nsomething\n"));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("missing required views: run-1-cases-non-result");
  });

  it("refuses a snapshot that names multiple runs or a stale source revision", () => {
    const multi = snapshot();
    multi.amend((status) => {
      status.runIds = ["run-1", "run-2"];
    });
    const multiResult = launch(multi, "--notes", notes("## lane_05\nrun identity.\n"));
    expect(multiResult.status).toBe(2);
    expect(multiResult.stderr).toContain("exactly one concrete runId");

    const stale = snapshot();
    stale.amend((status) => {
      status.source.commit = "e".repeat(40);
    });
    const staleResult = launch(
      stale,
      "--revision",
      "e".repeat(40),
      "--notes",
      notes("## lane_05\nrun identity.\n"),
    );
    expect(staleResult.status).toBe(2);
    expect(staleResult.stderr).toContain("differs from worktree HEAD");
  });
});

/** One run as `wri.ts read` leaves its review: the state naming the run, its campaign's opening
 *  with the source commit, and, for a run with a snapshot, the native prompts a launch wrote. */
function reviewedRun(runId: string, snap: Snapshot | null, ...launchArgs: string[]) {
  const review = scratchDir("ana-build-review-");
  const campaign = snap?.status.campaign ?? scratchDir("ana-build-campaign-");
  const commit = snap?.status.source.commit ?? "f".repeat(40);
  mkdirSync(join(campaign, "controller", runId), { recursive: true });
  writeFileSync(
    join(campaign, "controller", runId, "opening.json"),
    JSON.stringify({ runId, source: { commit, dirty: false, sourceDigest: "d".repeat(64) } }),
  );
  if (snap === null) {
    writeFileSync(join(review, "timeline.txt"), "timeline\n");
  } else {
    const result = launch(snap, "--transport", "native", ...launchArgs);
    if (result.status !== 0) throw new Error(result.stderr);
    renameSync(result.out, join(review, "lanes"));
    symlinkSync(snap.dir, join(review, "snapshot"));
  }
  writeFileSync(
    join(review, "wri-review.json"),
    JSON.stringify({
      schema: "wri-review/v2",
      reviewDir: review,
      campaign,
      runId,
      repo: snap?.status.worktree.path ?? campaign,
      scope: {
        tier: snap === null ? "probe" : "standard",
        why: snap === null ? "no scored case yet" : "one battery",
        terminal: { outcome: "aborted", reason: "stopped" },
        batteries: snap === null ? [] : [{ battery: runId }],
        cases: { verified: snap === null ? 0 : 25, unaccepted: 0, nonResult: 0 },
      },
    }),
  );
  return { review, campaign, commit, runId };
}

/** Plan and compose a reading across `reviews` the way `wri.ts lanes` does, into a fresh directory. */
function composeAcross(reviews: readonly string[], size: GroupSize, reading: AcrossRuns = "cross-run") {
  const outDir = scratchDir("ana-build-multi-");
  const groups = loadLaneGroups();
  const runs = reviews.map((review) => readRun(review));
  const available = new Set(
    runs.flatMap((run) => [...run.available]).filter((lane) => !groups.alone.has(lane)),
  );
  const preamble = runsPreamble(runs, [], reading);
  const composed: ComposedGroup[] = planGroups(groups, available, size).map((group) => {
    const made = composeRuns(runs, group.lanes, { outDir, preamble, remoteHost: null, reading });
    return { ...group, ...made, problems: checkComposed(made.text, group.lanes, { shared: SHARED.trim() }) };
  });
  writeGroups(
    outDir,
    composed,
    runs.map((run) => run.id),
  );
  return { outDir, composed };
}

describe("what the group composer makes of a launch", () => {
  it("keeps the shared instructions in an open group when an isolated lane shared its launch, and the isolated lane blind", () => {
    const result = launch(snapshot(), "--sessions", `2,3,${PUBLIC_ONLY_LANE}`, "--transport", "native");
    expect(result.status).toBe(0);
    // The launch held a blind lane, so every prompt opens with the blind file.
    expect(result.prompt("lane_02").startsWith("# Independent blind review")).toBe(true);

    const plan = planGroups(loadLaneGroups(), availableLanes(join(result.out, "prompts")), { agents: 2 });
    expect(plan.map((group) => group.lanes)).toEqual([[PUBLIC_ONLY_LANE], [2, 3]]);
    const open = composeLanes(result.out, [2, 3], null);
    expect(checkComposed(open.text, [2, 3], { blind: open.blind, shared: SHARED.trim() })).toEqual([]);
    expect(open.text).toContain("## Run overview");
    expect(open.text).toContain("RECORDED_FACT");
    expect(open.text).not.toContain("# Independent blind review");
    expect(open.text.match(/^# Your assignment$/gm)).toHaveLength(1);
    const blind = composeLanes(result.out, [PUBLIC_ONLY_LANE], null);
    expect(blind.blind).toBe(true);
    expect(checkComposed(blind.text, [PUBLIC_ONLY_LANE], { blind: true, shared: SHARED.trim() })).toEqual([]);
    expect(blind.text).toContain("# Independent blind review");
    expect(blind.text).not.toContain("RECORDED_FACT");
  });

  it("refuses a group whose prompt lost the shared instructions or carries a stale copy", () => {
    const result = launch(snapshot(), "--sessions", "2,3", "--transport", "native");
    const { text } = composeLanes(result.out, [2, 3], null);
    expect(checkComposed(text, [2, 3], { shared: SHARED.trim() })).toEqual([]);
    expect(checkComposed(text, [2, 3], { shared: `${SHARED.trim()}\n- EDITED_AFTER_BUILD.` })).toEqual([
      "the prompt does not carry shared-instructions.md as it now reads; rebuild the per-run prompts",
    ]);
    const lost = text.replace(/^## Run overview[^\n]*$/m, "## Something else");
    expect(checkComposed(lost, [2, 3])).toContain(
      "no `## Run overview`: the shared instructions did not reach the composed prompt",
    );
  });

  it("reads one lane group across named runs, each at its own source, a probe run named for what it can answer", () => {
    const first = reviewedRun(
      "run-a",
      snapshot(),
      "--sessions",
      `2,3,31,34,${PUBLIC_ONLY_LANE}`,
      "--run-overview",
      runOverview("- FACT_OF_A."),
    );
    const second = reviewedRun(
      "run-b",
      snapshot(),
      "--sessions",
      "2,3,31,34",
      "--run-overview",
      runOverview("- FACT_OF_B."),
    );
    const probe = reviewedRun("run-p", null);
    const lead = join(first.review, "lanes", "native-output", "lane_02.md");
    mkdirSync(dirname(lead), { recursive: true });
    writeFileSync(lead, "## lane_02\n");
    const runs = [first, second, probe];

    // Six components over three runs is two lanes a subagent, cut along the theme tree; the
    // isolated lane stays with its own run.
    const { outDir: multi, composed } = composeAcross(
      runs.map((run) => run.review),
      { components: 2 },
    );
    expect(composed.flatMap((group) => group.problems)).toEqual([]);
    const groups = parseJsonAs<{ session: string; runs: string[] }[]>(
      readFileSync(join(multi, "groups.json"), "utf8"),
    );
    expect(groups.map((group) => group.session)).toEqual(["lanes_02_34", "lanes_03_31"]);
    expect(groups.every((group) => group.runs.join() === "run-a,run-b,run-p")).toBe(true);

    const prompt = readFileSync(join(multi, "lanes_02_34.md"), "utf8");
    for (const run of runs) {
      for (const identity of [run.runId, run.campaign, realpathSync(run.review), run.commit]) {
        expect(prompt).toContain(identity);
      }
    }
    expect(probe.commit).not.toBe(first.commit);
    expect(prompt).toContain("different source commits");
    // The shared instructions both runs carry are said once; each run's own overview stays under that run.
    expect(prompt.split(SHARED.trim())).toHaveLength(2);
    expect(prompt.match(/^## Orientation$/gm)).toHaveLength(1);
    expect(prompt.match(/^### Run overview/gm)).toHaveLength(2);
    expect(prompt.indexOf("FACT_OF_A")).toBeLessThan(prompt.indexOf("## Run run-b"));
    expect(prompt.indexOf("FACT_OF_B")).toBeGreaterThan(prompt.indexOf("## Run run-b"));
    expect(prompt).toContain("## Run run-p (no snapshot)");
    expect(prompt).not.toContain("## Assignments in this launch");
    expect(prompt.match(/^# Your assignment$/gm)).toHaveLength(1);
    // Each lane names its trigger, or why there is none, in every run, and an earlier report as a lead.
    for (const lane of ["02", "34"]) {
      const block = prompt.slice(prompt.indexOf(`Lane ${lane} in each run:`));
      expect(block).toContain(`\`run-a\`: ${laneTrigger(Number(lane)).replace(/\.$/, "")}`);
      expect(block).toContain(`\`run-b\`: ${laneTrigger(Number(lane)).replace(/\.$/, "")}`);
      expect(block).toContain("`run-p`: no snapshot");
    }
    expect(prompt).toContain(`Earlier report: \`${realpathSync(lead)}\``);
    // The report contract names exactly the labels the validator accepts.
    for (const label of [...MULTI_RUN_PILES, ...MULTI_RUN_OUTCOMES]) expect(prompt).toContain(`\`${label}\``);

    // The independent multi-run reading names no earlier report and opens no other reading.
    const independent = composeAcross(
      runs.map((run) => run.review),
      { components: 2 },
      "multi-run",
    );
    const alone = independent.composed[0]?.text ?? "";
    expect(alone).not.toContain("Earlier report");
    expect(alone).toContain("do not open the per-run or cross-run lane reports");
    expect(alone).toContain("- Do not read any other lane's prompt or report.");

    // One report per group in the asked shape is what the validator accepts.
    const finding = "- One mechanism.\n  owner: controller-source\n  pile: every\n  outcome: patch";
    const section = (lane: string): string =>
      [
        `## lane_${lane}`,
        ...REPORT_SECTIONS.flatMap((name) => [`### ${name}`, name === "Findings" ? finding : "x"]),
      ].join("\n");
    mkdirSync(join(multi, "native-output"));
    for (const [session, lanes] of [
      ["lanes_02_34", ["02", "34"]],
      ["lanes_03_31", ["03", "31"]],
    ] as const) {
      writeFileSync(
        join(multi, "native-output", `${session}.md`),
        [`# Multi-run: ${session}`, ...lanes.map(section)].join("\n\n"),
      );
    }
    const validated = spawnSync(Bun.argv[0]!, [VALIDATOR, "--groups", join(multi, "groups.json")]);
    expect(validated.stderr).toBe("");
    expect(validated.status).toBe(0);
  });

  it("sizes each subagent by lanes, splitting a theme only when it does not fit", () => {
    const runs = ["run-a", "run-b"].map(
      (id) => reviewedRun(id, snapshot(), "--sessions", "2,3,31,34").review,
    );
    const sessions = (components: number): string[] =>
      composeAcross(runs, { components }).composed.map((group) => group.name);
    expect(sessions(4)).toEqual(["lanes_02_34_03_31"]);
    expect(sessions(2)).toEqual(["lanes_02_34", "lanes_03_31"]);
    expect(sessions(1)).toEqual(["lane_02", "lane_34", "lane_03", "lane_31"]);
    const agents = (count: number): string[] =>
      composeAcross(runs, { agents: count }).composed.map((group) => group.name);
    expect(agents(1)).toEqual(["lanes_02_34_03_31"]);
    // Two groups of two tie, and the left one is split first.
    expect(agents(3)).toEqual(["lane_02", "lane_34", "lanes_03_31"]);
  });
});

/** An investigation as `wri.ts start` leaves it once the primary filled the shared instructions:
 *  each run's review under it, holding its snapshot, its state and its run overview. */
function investigation(runIds: readonly string[], shared: string = SHARED) {
  const out = scratchDir("ana-build-investigation-");
  const runs = runIds.map((runId) => {
    const snap = snapshot({ runId });
    const review = join(out, runId);
    const controller = join(snap.status.campaign, "controller", runId);
    mkdirSync(controller, { recursive: true });
    writeFileSync(
      join(controller, "opening.json"),
      JSON.stringify({
        runId,
        source: { commit: snap.status.source.commit, dirty: false, sourceDigest: "d".repeat(64) },
      }),
    );
    mkdirSync(review, { recursive: true });
    symlinkSync(snap.dir, join(review, "snapshot"));
    writeFileSync(join(review, "run-overview.md"), `- OVERVIEW_OF_${runId}.\n`);
    writeFileSync(
      join(review, "wri-review.json"),
      JSON.stringify({
        schema: "wri-review/v2",
        reviewDir: review,
        campaign: snap.status.campaign,
        runId,
        repo: snap.status.worktree.path,
        scope: {
          tier: "standard",
          why: "one battery",
          terminal: { outcome: "aborted", reason: "stopped" },
          batteries: [{ battery: runId }],
          cases: { verified: 25, unaccepted: 0, nonResult: 0 },
        },
        steps: [],
      }),
    );
    return { runId, review };
  });
  writeFileSync(join(out, "shared-instructions.md"), shared);
  writeFileSync(
    join(out, "wri-investigation.json"),
    JSON.stringify({ schema: "wri-investigation/v1", preset: "test", runs }),
  );
  return { out, runs };
}

/** The lanes and readings the investigation tests build, with one difference each test states. */
function lanesOptions(over: Partial<LanesOptions> = {}): LanesOptions {
  return {
    lanes: `2,3,31,34,${PUBLIC_ONLY_LANE}`,
    tier: "all",
    size: { agents: 3 },
    readings: "per-run,multi-run",
    remoteHost: null,
    prior: null,
    ...over,
  };
}

/** A lane report in the shape the validator accepts, or one missing its sections. */
function laneReport(lane: number, kind: "valid" | "torn" = "valid"): string {
  if (kind === "torn") return `## ${laneName(lane)}\n\nnothing here\n`;
  const finding = "- One mechanism.\n  owner: controller-source";
  return [
    `## ${laneName(lane)}`,
    ...REPORT_SECTIONS.flatMap((name) => [`### ${name}`, name === "Findings" ? finding : "x"]),
  ].join("\n");
}

function writeReport(review: string, lane: number, kind: "valid" | "torn" = "valid"): void {
  const dir = join(review, "lanes", "native-output");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${laneName(lane)}.md`), laneReport(lane, kind));
}

const groupSessions = (path: string): string[] =>
  parseJsonAs<{ session: string }[]>(readFileSync(path, "utf8")).map((row) => row.session);

describe("an investigation, from its lanes to its synthesis", () => {
  it("builds each run's open and isolated lanes apart, composes every reading and writes one launch entry per agent", () => {
    const { out, runs } = investigation(["run-a", "run-b"]);
    const { launch: launchPath } = buildLanes(out, lanesOptions());
    const blindLane = laneName(PUBLIC_ONLY_LANE);

    for (const run of runs) {
      expect(existsSync(join(run.review, "lanes-isolated", "prompts", `${blindLane}.md`))).toBe(true);
      expect(existsSync(join(run.review, "lanes", "prompts", `${blindLane}.md`))).toBe(false);
      expect(groupSessions(join(run.review, "lanes", "groups", "groups.json"))).toEqual([
        "lanes_02_34",
        "lanes_03_31",
      ]);
      const open = readFileSync(join(run.review, "lanes", "groups", "lanes_02_34.md"), "utf8");
      expect(open).toContain(SHARED.trim());
      expect(open).toContain(`OVERVIEW_OF_${run.runId}`);
      const blind = readFileSync(join(run.review, "lanes-isolated", "groups", `${blindLane}.md`), "utf8");
      expect(blind).toContain("# Independent blind review");
      expect(blind).not.toContain("Loose end");
      expect(blind).toContain("HARD_RULE");
    }
    // The multi-run reading leaves the isolated lane per run, carries the shared instructions once,
    // and names no other reading's report.
    expect(groupSessions(join(out, "multi-run", "groups.json"))).toEqual([
      "lane_02",
      "lane_34",
      "lanes_03_31",
    ]);
    const multi = readFileSync(join(out, "multi-run", "lanes_03_31.md"), "utf8");
    expect(multi.split(SHARED.trim())).toHaveLength(2);
    expect(multi).not.toContain("Earlier report");

    const launchText = readFileSync(launchPath, "utf8");
    const prompts = [
      ...launchText.matchAll(/^Read (\S+) whole and do exactly what it says; it is your whole task\.$/gm),
    ];
    expect(prompts).toHaveLength(3 + 3 + 3);
    for (const [line, prompt = ""] of prompts) {
      expect(existsSync(prompt)).toBe(true);
      expect(line).toBe(agentPrompt(prompt));
      expect(launchText).toContain(modelCheck(prompt));
    }
    expect(launchText).toContain(
      `- report: \`${join(runs[0]!.review, "lanes", "native-output", "lane_02.md")}\``,
    );
    expect(launchText).toContain(
      `- report: \`${join(out, "multi-run", "native-output", "lanes_03_31.md")}\``,
    );
  });

  it("refuses a blank authored section, a cross-run reading with no per-run report, and a group that outlived the shared instructions", () => {
    const blank = investigation(["run-a"], SHARED.replace("none", "<!-- AUTHOR: what moved -->"));
    expect(() => buildLanes(blank.out, lanesOptions({ readings: "per-run" }))).toThrow(
      "fill or delete the blank section(s) ## The moved variable and prior state",
    );

    const { out, runs } = investigation(["run-a", "run-b"]);
    buildLanes(out, lanesOptions({ readings: "per-run" }));
    expect(() => buildLanes(out, lanesOptions({ readings: "cross-run" }))).toThrow(
      "cross-run reads the per-run reports as leads, and run-a, run-b has none yet",
    );
    for (const run of runs) writeReport(run.review, 2);
    writeFileSync(join(out, "shared-instructions.md"), `${SHARED}- EDITED_AFTER_BUILD.\n`);
    expect(() => buildLanes(out, lanesOptions({ readings: "cross-run" }))).toThrow(
      "refused, no launch.md written",
    );
    expect(existsSync(join(out, "launch.md"))).toBe(false);
  });

  it("collects every expected report as ok, missing or invalid, and renders the synthesis prompt from that index", () => {
    const { out, runs } = investigation(["run-a", "run-b"]);
    buildLanes(out, lanesOptions());
    const first = runs[0]!.review;

    const before = collectReports(out);
    expect(before.readings).toEqual([
      { reading: "per-run", ok: 0, of: 6 },
      { reading: "multi-run", ok: 0, of: 3 },
    ]);
    expect(readFileSync(before.index, "utf8")).toContain("| lanes_02_34 | run-a | 2, 34 | missing |");

    writeReport(first, 2);
    writeReport(first, 34);
    writeReport(first, 3, "torn");
    const after = collectReports(out);
    expect(after.readings[0]).toEqual({ reading: "per-run", ok: 1, of: 6 });
    const index = readFileSync(after.index, "utf8");
    expect(index).toContain("| lanes_02_34 | run-a | 2, 34 | ok |");
    expect(index).toContain("| lanes_03_31 | run-a | 3, 31 | invalid |");
    expect(index).toContain("- lanes_03_31: lane_03:");

    const { prompt, incomplete } = renderSynthesis(out, null);
    const text = readFileSync(prompt, "utf8");
    expect(incomplete).toEqual(["per-run 1/6 ok", "multi-run 0/3 ok"]);
    expect(text).toContain(SHARED.trim());
    expect(text).toContain("| lanes_02_34 | run-a | 2, 34 | ok |");
    expect(text).toContain("`finding | readings | runs | corpus count | owner | outcome`");
    expect(text).toContain(join(out, "synthesis.md"));
    expect(text).not.toMatch(/\{(out|synthesis|reports|sharedInstructions)\}|<!--/);
  });
});
