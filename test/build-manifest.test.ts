/**
 * What `build-manifest.mjs` composes from a frozen snapshot, and what it refuses to launch.
 *
 * The builder is a command, so every rule here spawns it. What each test varies is one argument or
 * one field of the snapshot; the rest is the same launch every time. So one `snapshot()` writes the
 * digest-bound tree trace-review writes and amends it in place, and one `launch()` supplies the
 * standing arguments and reads back what was written. A test states its difference and its
 * assertions, not the ten lines around them.
 *
 * The launches read a generated catalogue and index in the maintained shape, so a hostile variant
 * is one edit of a fixture the test owns; one test lists the live catalogue, which is where the
 * maintained references and this shape are proved to agree.
 */
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join, resolve } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { PINNED_BUN_VERSION } from "../src/run/host-runtime-policy.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  ANGLE_COUNT,
  DETERMINISTIC_ROW_TITLES,
  DIGEST_VERDICTS,
  ISOLATED_ANGLES,
  MIN_AUTO_SESSIONS,
  PUBLIC_ONLY_LANE,
  TRACE_CHALLENGE_LANE,
} from "../.claude/skills/whole-run-investigation/scripts/catalogue-shape.mjs";
import { REPORT_SECTIONS } from "../.claude/skills/whole-run-investigation/scripts/manifest-reporting.mjs";

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
type Task = { name: string; task: string; admission: Admission };
type Snapshot = ReturnType<typeof snapshot>;
type Edit = (text: string) => string;

const REPO = resolve(import.meta.dirname, "..");
const SKILL = join(REPO, ".claude/skills/whole-run-investigation");
const SCRIPT = join(SKILL, "scripts/build-manifest.mjs");
const OPEN_LANES = ANGLE_COUNT - ISOLATED_ANGLES.size;
const SCAN_VIEW = JSON.stringify({
  findings: [{ rule: "telemetry-constant", battery: "run-1-on", statement: "turns is 1." }],
});
/** Every launch carries one; the tests that are not about it use this one. */
const ORIENTATION =
  "## orientation\n1. The product is a link budget checker.\n2. Loose end: usb-pd is 0/6.\n\n";
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
/** The session names a full sweep produces when both isolated lanes fired: each isolated lane
 *  alone, and the open lanes between them in contiguous groups. */
const FULL_SWEEP = [
  `lanes_01_${pad(PUBLIC_ONLY_LANE - 1)}`,
  laneName(PUBLIC_ONLY_LANE),
  `lanes_${pad(PUBLIC_ONLY_LANE + 1)}_${pad(TRACE_CHALLENGE_LANE - 1)}`,
  laneName(TRACE_CHALLENGE_LANE),
  `lanes_${pad(TRACE_CHALLENGE_LANE + 1)}_${pad(ANGLE_COUNT)}`,
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

/** A complete digest-bound snapshot in the shape trace-review writes, with 25 verified cases and a
 *  complete trace-challenge packet unless the test says otherwise. */
function snapshot(
  options: { complete?: boolean; runtime?: string; verified?: number; packet?: boolean } = {},
) {
  const dir = scratchDir("ana-build-snapshot-");
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
  put("run-1-default", defaultView(options.verified ?? 25));
  put("run-1-scan", SCAN_VIEW);
  for (const mode of [
    "scorecard",
    "observations-warning",
    "cases-fail",
    "cases-unaccepted",
    "cases-non-result",
    "cases-pass",
  ]) {
    put(`run-1-${mode}`, "{}\n");
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
        campaign: "/campaigns/demo",
        runId: "run-1",
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
    campaign: "/campaigns/demo",
    repo: repo.path,
    runIds: ["run-1"],
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
function notes(body: string, orientation: string = ORIENTATION): string {
  const path = join(scratchDir("ana-build-notes-"), "notes.md");
  writeFileSync(path, `${orientation}${body}`);
  return path;
}

/** The builder against the fixture references, with the standing arguments every launch carries
 *  and readers for what it wrote. The worktree is the snapshot's own: the builder refuses a
 *  requested one that differs, and no test here is about that refusal. */
function launch(snap: Snapshot | null, ...args: string[]) {
  const out = join(scratchDir("ana-build-out-"), "launch");
  const bound =
    snap === null ? [] : ["--snapshot", snap.dir, "--worktree", snap.status.worktree.path, "--out", out];
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
    // The moved variable is not in the evidence, so its absence is stated rather than inferred.
    expect(instructions).toContain("was not supplied to the launcher");
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
      expect(prompt).toContain("Independent public-only review");
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
      ]) {
        expect(prompt).not.toContain(forbidden);
      }
    }
    // The lane that is not public-only still receives the evidence, and no isolation rule.
    const open = tasks.find((row) => row.name === "lane_02")?.task;
    expect(open).toContain("usb-pd 0/6");
    expect(open).not.toContain("You are an isolated lane");
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
    const result = launch(
      snapshot(),
      "--auto",
      String(FULL_SWEEP.length),
      "--transport",
      "native",
      "--notes",
      notes(""),
    );
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
  });

  it("leaves an unfired isolated lane out of --auto and refuses selecting it by hand", () => {
    const unfired = snapshot({ verified: 0 });
    const auto = launch(
      unfired,
      "--auto",
      String(MIN_AUTO_SESSIONS),
      "--transport",
      "native",
      "--notes",
      notes(""),
    );
    expect(auto.status).toBe(0);
    // Contiguous open groups and no isolated seat: the exact cut is the partitioner's tie-break.
    expect(auto.tasks()).toHaveLength(MIN_AUTO_SESSIONS);
    expect(auto.tasks().every((task) => /^lanes_\d{2}_\d{2}$/.test(task.name))).toBe(true);
    expect(auto.stderr).toContain(`isolated-lane-untriggered: lane ${PUBLIC_ONLY_LANE}`);
    expect(auto.stderr).toContain(`isolated-lane-untriggered: lane ${TRACE_CHALLENGE_LANE}`);
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
  });

  it("composes one self-contained prompt per session for the codex transport and prints its launch", () => {
    const result = launch(
      snapshot(),
      "--auto",
      String(FULL_SWEEP.length),
      "--effort",
      "max",
      "--transport",
      "codex",
    );
    const rows = result.tasks("codex-tasks.json");
    const instructions = result.instructions().trim();

    expect(result.status).toBe(0);
    expect(rows.map((row) => row.name)).toEqual(FULL_SWEEP);
    for (const row of rows) {
      expect(row.task.startsWith(instructions)).toBe(true);
      expect(row.task.endsWith("Authority: read-only. Do not edit files or change external state.")).toBe(
        true,
      );
    }
    expect(result.stdout).toContain("codex-sessions.mjs launch --tasks-file");
    expect(result.stdout).toContain("--model gpt-5.6-luna --effort max");
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
  it("refuses a launch with no orientation, and one that is longer than the contract", () => {
    const missing = launch(snapshot(), "--notes", notes("## lane_05\nusb-pd is 0/6.\n", ""));
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain("no `## orientation` block");

    const long = `## orientation\n${Array.from({ length: 21 }, (_, i) => `${i + 1}. a fact.`).join("\n")}\n\n`;
    const overLength = launch(snapshot(), "--notes", notes("## lane_05\nusb-pd is 0/6.\n", long));
    expect(overLength.status).toBe(2);
    expect(overLength.stderr).toContain("carries 21 lines");
    expect(existsSync(overLength.out)).toBe(false);
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
    const belowFloor = launch(snapshot(), "--auto", String(MIN_AUTO_SESSIONS - 1), "--notes", notes(""));
    expect(belowFloor.status).toBe(2);
    expect(belowFloor.stderr).toContain(`at least ${MIN_AUTO_SESSIONS} semantic sessions`);
    expect(existsSync(belowFloor.out)).toBe(false);

    // Both isolated lanes fired and neither sits at an end of the catalogue, so each needs a cut
    // on both sides: fewer sessions than the full sweep cannot seat them alone.
    const tooFew = launch(snapshot(), "--auto", String(FULL_SWEEP.length - 1), "--notes", notes(""));
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
