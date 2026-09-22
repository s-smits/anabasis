import * as filesystem from "../../../src/meta/filesystem.ts";
import { recordedTaskContent } from "../src/server/task-content.js";
import { controllerRuns, hydrateControllerRun } from "../src/server/current.js";
import { caseRecordRow } from "../../../test/helpers/case-record-row.ts";
import { parseEvidencePage } from "../src/views/evidence.js";
import { tracePointer } from "../../../src/claim/case-record.ts";
import { hashBundle } from "../../../src/claim/bundle-hash.ts";
import { batteryHash, BATTERY_FILES } from "../../../src/claim/fingerprint.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../../../src/meta/filesystem.ts";
import { tmpdir } from "../../../src/meta/os.ts";
import { join } from "../../../src/meta/path.ts";
import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { handleApiRequest, loopbackHost } from "../src/server/api.js";
import { readFilePayload, readJson, safeRunPath, walkRunFiles } from "../src/server/files.js";
import type { EvidenceIssue, ProjectView, RunView } from "../src/models.js";
import type { JsonValue } from "../../../src/meta/json-shape.ts";
import { latestRun, orderedProjects, resolveProject } from "../src/project-selection.js";
import { NO_STORY, readDifficulty, readRequest } from "../src/server/story.js";
import {
  backendSupportsSlot,
  projectBackendChoices,
  setProjectBackendSelection,
} from "../../../src/backends/project-backends.ts";
const HARNESS = ".harness";

const SLUG = "widget";
const RUN = "fullrun-2026-08-15T14-27-55-865Z";

it("parses displayed evidence rows and refuses missing protection or malformed pagination", () => {
  const file = {
    path: "run/census.json",
    category: "gate",
    content: "json",
    modifiedAt: "2026-09-09T12:00:00Z",
    bytes: 0,
    protected: true,
  };
  const page = { files: [file], offset: 0, hasMore: false };
  expect(parseEvidencePage(page)).toEqual(page);
  for (const malformed of [
    null,
    { ...page, offset: -1 },
    { ...page, hasMore: "false" },
    { ...page, files: [{ ...file, protected: null }] },
  ]) {
    expect(() => parseEvidencePage(malformed)).toThrow("File list response");
  }
});

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-observatory-"));
  const campaign = join(root, "campaigns", "widget");
  const epoch = join(campaign, "epoch-widget");
  const iteration = join(epoch, "01-initial");
  const observations = join(campaign, "observability");
  mkdirSync(iteration, { recursive: true });
  mkdirSync(observations, { recursive: true });
  writeFileSync(join(epoch, "campaign.json"), JSON.stringify({ schema: "campaign/v1", domain: "widget" }));
  writeFileSync(
    join(iteration, "iteration.json"),
    JSON.stringify({
      ordinal: 1,
      outcome: "fingerprinted",
      attempts: { brief: 2, tests: 1 },
      feedback: [
        {
          severity: "blocking",
          owner: "brief",
          claim: "Define the accepted representation.",
          evidence: "campaigns/widget/01-initial/census.json",
        },
      ],
      source: { commit: "abc123", dirty: false },
      fingerprint: { agentHash: "agent", correctnessModelHash: "correctness-model" },
    }),
  );
  writeFileSync(join(iteration, "census.json"), JSON.stringify({ verdict: "pass" }));
  writeFileSync(join(iteration, "solvability.json"), JSON.stringify({ hiddenAnswer: 42 }));
  const rows = [
    {
      type: "prompt-ingested",
      id: "prompt-1",
      at: "2026-07-26T12:00:00.000Z",
      contract: "builder",
      role: "brief",
      subjectId: "brief-session",
      turn: 1,
      phase: "brief",
      prompt: "Produce the brief from the admitted ask.",
      steeringTypes: ["start-prompt"],
    },
    {
      type: "steering-ingested",
      id: "steer-1",
      category: "validation-repair",
      authority: "deterministic",
      mode: "must-fix",
      status: "ingested",
      owner: "brief",
      claim: "Repair the representation boundary.",
      evidence: ["campaigns/widget/01-initial/census.json"],
      promptId: "prompt-1",
    },
    {
      type: "hook-activated",
      id: "hook-1",
      hookType: "steering",
      state: "activated",
      label: "brief repair",
      triggerDigest: "trigger",
      renderedDigest: "rendered",
      evidence: ["campaigns/widget/01-initial/census.json"],
    },
    {
      type: "phase-transition",
      id: "phase-1",
      at: "2026-07-26T12:01:00.000Z",
      phase: "gates",
      state: "completed",
      summary: "Observed build gates completed.",
      evidence: ["campaigns/widget/epoch-widget/01-initial/census.json"],
    },
  ];
  writeFileSync(
    join(observations, "epoch-widget.jsonl"),
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  return root;
}

describe("observatory filesystem boundary", () => {
  it("admits IPv4 and IPv6 loopback hosts but not a widened bind", () => {
    expect(loopbackHost("127.0.0.1:4177")).toBe(true);
    expect(loopbackHost("[::1]:4177")).toBe(true);
    expect(loopbackHost("::1")).toBe(true);
    expect(loopbackHost("observatory.internal:4177")).toBe(false);
  });

  it("admits missing descendants inside run roots without requiring their immediate parent", () => {
    const root = fixture();
    expect(safeRunPath(root, "domains/widget/ladder.json")).toBe(
      join(realpathSync(root), "domains/widget/ladder.json"),
    );
  });

  it("refuses traversal and a symlink that escapes the repository", () => {
    const root = fixture();
    const outside = mkdtempSync(join(tmpdir(), "ana-observatory-outside-"));
    writeFileSync(join(outside, "secret.json"), '{"secret":true}');
    mkdirSync(join(root, "domains", "widget"), { recursive: true });
    symlinkSync(outside, join(root, "domains", "widget", "leak"));
    expect(safeRunPath(root, "../../etc/passwd")).toBeNull();
    expect(safeRunPath(root, "domains/widget/leak/secret.json")).toBeNull();
  });

  it("says a refused path was refused instead of reading it as a missing record", () => {
    const root = fixture();
    const outside = mkdtempSync(join(tmpdir(), "ana-observatory-elsewhere-"));
    writeFileSync(join(outside, "opening.json"), JSON.stringify({ runId: "r1" }));
    mkdirSync(join(root, "domains", "widget"), { recursive: true });
    symlinkSync(outside, join(root, "domains", "widget", "linked"));
    const issues: EvidenceIssue[] = [];
    expect(readJson(root, "domains/widget/linked/opening.json", issues)).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("outside the observatory's read boundary");
    // A record that is simply absent stays silent, so the two cases never read alike.
    expect(readJson(root, "campaigns/widget/nothing-here.json", issues)).toBeNull();
    expect(issues).toHaveLength(1);
  });

  it("does not inventory nested Git object stores as run evidence", () => {
    const root = fixture();
    const epoch = join(root, "campaigns", "widget", "epoch-widget");
    mkdirSync(join(epoch, ".git", "objects"), { recursive: true });
    writeFileSync(join(epoch, ".git", "objects", "deadbeef"), "not a recorded record");
    const files = [...walkRunFiles(root, epoch)];
    expect(files.some((file) => file.path.endsWith("/01-initial/iteration.json"))).toBe(true);
    expect(files.some((file) => file.path.includes("/.git/"))).toBe(false);
  });

  it("reads only the display prefix of a large file", () => {
    const root = fixture();
    const path = "campaigns/widget/large.log";
    writeFileSync(join(root, path), "x".repeat(8_000_000));
    const read = spyOn(filesystem, "readSync");
    const whole = spyOn(filesystem, "readFileSync");
    try {
      const result = readFilePayload(root, path, "withhold");
      expect(result.bytes).toBe(8_000_000);
      expect(result.truncated).toBe(true);
      expect(result.value).toBe("x".repeat(2_000_000));
      expect(whole).not.toHaveBeenCalled();
      expect(read.mock.calls.reduce((sum, call) => sum + (call[2]?.length ?? 0), 0)).toBeLessThanOrEqual(
        2_000_001,
      );
      expect(read).toHaveBeenCalled();
    } finally {
      read.mockRestore();
      whole.mockRestore();
    }
  });

  it("withholds reference-side files until a deliberate reveal", () => {
    const root = fixture();
    const path = "campaigns/widget/epoch-widget/01-initial/solvability.json";
    const withheld = readFilePayload(root, path, "withhold");
    expect(withheld.protected).toBe(true);
    expect(withheld.value).toMatchObject({ withheld: true });
    const revealed = readFilePayload(root, path, "reveal");
    expect(revealed.value).toEqual({ hiddenAnswer: 42 });
    const legacy = "campaigns/widget/epoch-widget/01-initial/grader/checks.json";
    mkdirSync(join(root, "campaigns/widget/epoch-widget/01-initial/grader"), { recursive: true });
    writeFileSync(join(root, legacy), JSON.stringify({ hiddenAnswer: 7 }));
    expect(readFilePayload(root, legacy, "withhold").value).toMatchObject({ withheld: true });
  });

  it("lists no runs behind a symlinked campaigns tree instead of aborting the workspace read", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observatory-linked-"));
    const outside = mkdtempSync(join(tmpdir(), "ana-observatory-runs-"));
    mkdirSync(join(outside, "widget", "controller", "run-01"), { recursive: true });
    writeFileSync(
      join(outside, "widget", "controller", "run-01", "opening.json"),
      JSON.stringify({ runId: "run-01" }),
    );
    symlinkSync(outside, join(root, "campaigns"));
    expect(controllerRuns(root)).toEqual([]);
  });

  it("authorises and classifies aliases by their canonical evidence target", async () => {
    const root = fixture();
    const base = "campaigns/widget/epoch-widget/01-initial";
    writeFileSync(join(root, ".env"), "dummy-not-a-credential");
    symlinkSync(join(root, ".env"), join(root, base, "report.json"));
    symlinkSync(join(root, base, "solvability.json"), join(root, base, "summary.json"));
    symlinkSync(join(root, base, "census.json"), join(root, base, "public.json"));
    const request = (path: string, reveal = false) =>
      handleApiRequest(
        root,
        new Request(
          `http://localhost/api/file?path=${encodeURIComponent(path)}&reveal=${reveal ? "1" : "0"}`,
        ),
      );
    try {
      expect(safeRunPath(root, `${base}/report.json`)).toBeNull();
      expect((await request(`${base}/report.json`, true)).status).toBe(400);
      const protectedAlias = await (await request(`${base}/summary.json`)).json();
      expect(protectedAlias).toMatchObject({
        path: `${base}/solvability.json`,
        protected: true,
        value: { withheld: true },
      });
      expect(await (await request(`${base}/summary.json`, true)).json()).toMatchObject({
        value: { hiddenAnswer: 42 },
      });
      expect(await (await request(`${base}/public.json`)).json()).toMatchObject({
        path: `${base}/census.json`,
        protected: false,
        value: { verdict: "pass" },
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps evidence read-only while admitting the explicit project-backend operator action", async () => {
    const root = fixture();
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => handleApiRequest(root, request),
    });
    try {
      const denied = await fetch(`http://127.0.0.1:${server.port}/api/project-backend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "widget", slot: "builder", selection: "claude" }),
      });
      expect(denied.status).toBe(403);

      const admitted = await fetch(`http://127.0.0.1:${server.port}/api/project-backend`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ana-operator-action": "set-project-backend",
        },
        body: JSON.stringify({ projectId: "widget", slot: "builder", selection: "claude" }),
      });
      expect(admitted.status).toBe(200);
      expect(await admitted.json()).toEqual({ ok: true });
      const refreshed = await fetch(`http://127.0.0.1:${server.port}/api/workspace`);
      expect((await refreshed.json()).schema).toBe("ana-observatory/v2");
      expect(JSON.parse(readFileSync(join(root, HARNESS, "backends", "widget.json"), "utf8"))).toEqual({
        builder: { kind: "claude" },
      });
    } finally {
      await server.stop(true);
    }
  });
});

function write(root: string, path: string, value: JsonValue): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, JSON.stringify(value));
}

function storyFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-story-"));
  write(root, `campaigns/${SLUG}/controller/${RUN}/opening.json`, {
    schema: "controller-opening/v1",
    writtenAt: "2026-08-15T14:27:55.900Z",
    runId: RUN,
    continuation: null,
    command: { name: "fullrun", digest: "a00ce3e9" },
    project: { id: SLUG, origin: "operator", requestDigest: "f8714546" },
    modelSlots: {
      builder: { kind: "claude", model: "claude-opus-5", reasoningEffort: "medium" },
      built: { kind: "claude", model: "claude-opus-5", reasoningEffort: "medium" },
      judge: { enabled: false, kind: "claude", model: "claude-opus-5", reasoningEffort: "medium" },
    },
    runtime: { name: "node", version: "24.13.0", platform: "darwin", arch: "arm64" },
    source: { commit: "c4857c85290f7c22f71f9e2248db49e8b15d177c", dirty: false },
  });
  return root;
}

describe("controller metadata", () => {
  it("reads the third slot under the name the opening actually recorded", () => {
    const root = storyFixture();
    write(root, `campaigns/${SLUG}/controller/fullrun-review/opening.json`, {
      schema: "controller-opening/v1",
      writtenAt: "2026-08-19T14:27:55.900Z",
      runId: "fullrun-review",
      command: { name: "fullrun", digest: "a00ce3e9" },
      modelSlots: {
        builder: { kind: "claude", model: "claude-opus-5" },
        built: { kind: "claude", model: "claude-opus-5" },
        review: { enabled: true, kind: "codex", model: "gpt-5.6-luna" },
      },
    });
    const request = readRequest(root, SLUG, "fullrun-review", []);
    expect(request?.slots.map((slot) => [slot.slot, slot.kind])).toEqual([
      ["builder", "claude"],
      ["built", "claude"],
      ["review", "codex"],
    ]);
  });
  it("reads the pinned identities and keeps a disabled slot visible", () => {
    const request = readRequest(storyFixture(), SLUG, RUN, []);
    expect(request?.command).toBe("fullrun");
    expect(request?.host).toBe("node 24.13.0 on darwin arm64");
    expect(request?.dirty).toBe(false);
    expect(request?.slots.map((slot) => [slot.slot, slot.enabled])).toEqual([
      ["builder", true],
      ["built", true],
      ["judge", false],
    ]);
  });
  it("quotes the selector's own reason from the run's last round", () => {
    const root = storyFixture();
    write(root, `campaigns/${SLUG}/difficulty-decisions/${RUN}-aaaa1111.json`, {
      schema: "difficulty-decision/v2",
      difficulty: {
        decision: { action: "hold", currentLevel: 1, nextLevel: 1, rationale: "first round" },
        admitted: 1,
        excluded: [],
      },
    });
    write(root, `campaigns/${SLUG}/difficulty-decisions/${RUN}-i02-bbbb2222.json`, {
      schema: "difficulty-decision/v2",
      difficulty: {
        decision: {
          action: "climb",
          currentLevel: 1,
          nextLevel: 2,
          rationale: "pass-rate interval floor 0.805 sits above the target ceiling 0.75",
        },
        admitted: 2,
        excluded: ["recorded under variant repair-off"],
      },
    });
    const difficulty = readDifficulty(root, SLUG, RUN, []);
    expect(difficulty?.action).toBe("climb");
    expect(difficulty?.standing).toBe("L1");
    expect(difficulty?.rationale).toContain("0.805");
    expect(difficulty?.excluded).toEqual(["recorded under variant repair-off"]);
    expect(difficulty?.source).toContain(`${RUN}-i02-`);
  });
  it("reads the zone and the named exclusions of a placed record", () => {
    const root = storyFixture();
    write(root, `campaigns/${SLUG}/difficulty-decisions/${RUN}-cccc3333.json`, {
      schema: "difficulty-decision/v5",
      difficulty: {
        decision: { action: "placed", rationale: "6/25 …: at the limit", placement: { zone: "on-aim" } },
        admitted: 3,
        excluded: [{ runId: "r2", reason: "claim refused", claimRefused: true }],
      },
    });
    const difficulty = readDifficulty(root, SLUG, RUN, []);
    expect(difficulty?.action).toBe("placed");
    expect(difficulty?.standing).toBe("on-aim");
    expect(difficulty?.excluded).toEqual(["r2: claim refused"]);
  });
  it("reads an earlier difficulty record when no current record exists", () => {
    const root = storyFixture();
    write(root, `campaigns/${SLUG}/rung-decisions/${RUN}-aaaa1111.json`, {
      schema: "rung-decision/v1",
      rung: {
        decision: { action: "hold", currentLevel: 1, nextLevel: 1, rationale: "earlier record" },
        admitted: 1,
        excluded: [],
      },
    });
    const difficulty = readDifficulty(root, SLUG, RUN, []);
    expect(difficulty?.action).toBe("hold");
    expect(difficulty?.rationale).toBe("earlier record");
    expect(difficulty?.source).toContain("/rung-decisions/");
  });
  it("separates a difficulty decision that was never recorded from one that held", () => {
    expect(readDifficulty(storyFixture(), SLUG, RUN, [])).toBeNull();
  });
});

// Project selection over the same view shapes the story reader consumes.
function run(
  projectId: string,
  id: string,
  updatedAt: string,
  status: RunView["status"] = "complete",
): RunView {
  return {
    id,
    projectId,
    title: id,
    status,
    currentPhase: "completed",
    startedAt: updatedAt,
    updatedAt,
    sourceIdentity: null,
    variants: [],
    story: NO_STORY,
    files: [],
    issues: [],
  };
}

it("shows unaccepted attempts separately from failed verdicts and provider non-results", () => {
  const root = fixture();
  const campaign = join(root, "campaigns", "widget");
  const rows = [
    caseRecordRow("passed", "f"),
    caseRecordRow("failed", "f", { truthOk: false, pass: false }),
    caseRecordRow("unaccepted", "f", { acceptedSubmit: false, truthOk: null, pass: false }),
    caseRecordRow("provider", "f", {
      acceptedSubmit: false,
      truthOk: null,
      pass: null,
      runtimeNonResultKind: "provider",
      runtimeNonResult: "provider unavailable",
    }),
  ];
  writeFileSync(
    join(campaign, "case-record.jsonl"),
    rows.map((row, index) => JSON.stringify({ seq: index + 1, row })).join("\n") + "\n",
  );
  const view = run("widget", "run-07", "2026-09-10");
  hydrateControllerRun(root, view);
  expect(view.issues).toEqual([]);
  expect(view.variants.flatMap((variant) => variant.cases.map((item) => item.status))).toEqual([
    "complete",
    "failed",
    "unaccepted",
    "partial",
  ]);
});

function project(id: string, runs: RunView[]): ProjectView {
  return {
    id,
    adopted: true,
    backends: { path: `.harness/backends/${id}.json`, slots: [], error: null },
    runs,
    issues: [],
  };
}

describe("project-first selection", () => {
  it("prefers a live route project, then cache, then the project with the most recent run", () => {
    const alpha = project("alpha", [run("alpha", "alpha-1", "2026-01-01T00:00:00Z")]);
    const beta = project("beta", [run("beta", "beta-1", "2026-01-02T00:00:00Z")]);
    const gamma = project("gamma", [run("gamma", "gamma-1", "2025-01-01T00:00:00Z", "active")]);
    const projects = [alpha, beta, gamma];

    expect(resolveProject(projects, "alpha", "beta")?.id).toBe("alpha");
    expect(resolveProject(projects, "missing", "beta")?.id).toBe("beta");
    expect(resolveProject(projects, null, null)?.id).toBe("beta");
    expect(orderedProjects(projects).map((item) => item.id)).toEqual(["beta", "alpha", "gamma"]);
    const newest = project("newest", [
      run("newest", "old", "2020-01-01T00:00:00Z"),
      { ...run("newest", "new", "2026-01-03T01:00:00+01:00"), updatedAt: "2020-01-01T00:00:00Z" },
    ]);
    const undated = project("undated", [{ ...run("undated", "invalid", "invalid"), startedAt: null }]);
    expect(orderedProjects([undated, gamma, newest, beta]).map((item) => item.id)).toEqual([
      "newest",
      "beta",
      "gamma",
      "undated",
    ]);
  });

  it("the dashboard follows an active run over a newer completed one, else the most recent", () => {
    const completed = run("alpha", "full-run:alpha:completed", "2026-01-02T00:00:00Z");
    const active = run("alpha", "full-run:alpha:active", "2026-01-01T00:00:00Z", "active");
    expect(latestRun(project("alpha", [completed, active]))?.id).toBe("full-run:alpha:active");
    const earlier = run("alpha", "full-run:alpha:earlier", "2026-01-01T00:00:00Z");
    expect(latestRun(project("alpha", [earlier, completed]))?.id).toBe("full-run:alpha:completed");
    expect(latestRun(project("alpha", []))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Backend selection policy projected onto campaigns.
// ---------------------------------------------------------------------------

let roots: string[] = [];
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function campaignRoot(id = "widget"): string {
  const root = mkdtempSync(join(tmpdir(), "ana-project-backends-"));
  roots.push(root);
  const epoch = join(root, "campaigns", id, `epoch-${id}`);
  mkdirSync(epoch, { recursive: true });
  writeFileSync(join(epoch, "campaign.json"), JSON.stringify({ domain: id }));
  return root;
}

describe("project backend support", () => {
  it("names only complete runtime interfaces as selectable", () => {
    expect(backendSupportsSlot("builder", "claude")).toBe(true);
    // Every kind serves the builder row through the one pi host session and its host-enforced tools.
    expect(backendSupportsSlot("builder", "codex")).toBe(true);
    expect(backendSupportsSlot("builder", "openrouter")).toBe(true);
    expect(backendSupportsSlot("built", "codex")).toBe(true);
    // All Built providers use the same Pi tool proxy inside the same host-confined child.
    expect(backendSupportsSlot("built", "claude")).toBe(true);
    expect(backendSupportsSlot("built", "openrouter")).toBe(true);
    expect(backendSupportsSlot("review", "claude")).toBe(true);
    expect(backendSupportsSlot("review", "openrouter")).toBe(true);
    expect(projectBackendChoices("review").map((choice) => choice.value)).toEqual([
      "disabled",
      "inherit",
      "codex",
      "openrouter",
      "claude",
    ]);
  });
});

describe("project backend selection", () => {
  it("atomically updates one side while preserving the others", () => {
    const root = campaignRoot();
    const file = join(root, HARNESS, "backends", "widget.json");
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, JSON.stringify({ builder: { kind: "claude" }, review: { kind: "codex" } }));

    setProjectBackendSelection(root, "widget", "built", "codex");

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      builder: { kind: "claude" },
      review: { kind: "codex" },
      built: { kind: "codex" },
    });
  });

  it("expresses review inheritance and disabled state without silent built inheritance", () => {
    const root = campaignRoot();
    const file = join(root, HARNESS, "backends", "widget.json");
    setProjectBackendSelection(root, "widget", "review", "inherit");
    expect(JSON.parse(readFileSync(file, "utf8")).review).toEqual({ inherit: true });

    // Written, never expressed by deleting the key: the resolver layers default.json under this
    // file per slot, so an absent review slot means "nobody chose" and takes the standing default.
    setProjectBackendSelection(root, "widget", "review", "disabled");
    expect(JSON.parse(readFileSync(file, "utf8")).review).toEqual({ disabled: true });

    // And it survives a later write to an unrelated slot.
    setProjectBackendSelection(root, "widget", "built", "claude");
    expect(JSON.parse(readFileSync(file, "utf8")).review).toEqual({ disabled: true });
  });

  it("writes only the slot it was given — the default fills the rest at resolution", () => {
    // Deliberately NOT seeded from default.json: a copy in every project file is a second owner
    // for the same fact, and it drifts the moment the default changes. resolve.ts layers instead
    // (test/resolve.test.ts: "wins PER SLOT"), which also fixes the pins already on disk.
    const root = campaignRoot();
    mkdirSync(join(root, HARNESS, "backends"), { recursive: true });
    writeFileSync(
      join(root, HARNESS, "backends", "default.json"),
      JSON.stringify({ review: { kind: "claude" } }),
    );

    setProjectBackendSelection(root, "widget", "built", "claude");

    expect(JSON.parse(readFileSync(join(root, HARNESS, "backends", "widget.json"), "utf8"))).toEqual({
      built: { kind: "claude" },
    });
  });

  it("accepts a registry-created project before its first campaign write", () => {
    // Run 14's launch abort (2026-07-28): a fresh project exists only in the registry when the
    // operator's slot flag lands, because selectProject registers the id before any campaign or
    // domains/ directory is written. The guard must read the registry, not only the output trees.
    const root = mkdtempSync(join(tmpdir(), "ana-project-backends-"));
    roots.push(root);
    mkdirSync(join(root, "campaigns"), { recursive: true });
    writeFileSync(
      join(root, "campaigns", "projects.json"),
      JSON.stringify({
        schema: "harness-projects/v1",
        projects: [{ id: "fresh-write", mintedAt: "2026-07-28T00:00:00Z", requests: ["digest-1"] }],
      }),
    );

    const file = setProjectBackendSelection(root, "fresh-write", "built", "claude");

    expect(JSON.parse(readFileSync(file, "utf8")).built).toEqual({ kind: "claude" });
    // An id the registry does not carry still refuses: the registry widens the guard, never opens it.
    expect(() => setProjectBackendSelection(root, "ghost", "builder", "claude")).toThrow(/unknown project/);
  });

  it("refuses unknown projects without writing", () => {
    const root = campaignRoot();
    const file = join(root, HARNESS, "backends", "widget.json");
    expect(() => setProjectBackendSelection(root, "ghost", "builder", "claude")).toThrow(/unknown project/);
    expect(existsSync(file)).toBe(false);
  });

  it("admits openrouter on every slot", () => {
    const root = campaignRoot();
    const file = setProjectBackendSelection(root, "widget", "review", "openrouter");
    expect(JSON.parse(readFileSync(file, "utf8")).review).toEqual({ kind: "openrouter" });
    setProjectBackendSelection(root, "widget", "builder", "openrouter");
    expect(JSON.parse(readFileSync(file, "utf8")).builder).toEqual({ kind: "openrouter" });
  });
});

it("reads only measured public task input and refuses a drifted task set", () => {
  const root = fixture();
  try {
    const campaign = join(root, "campaigns/widget");
    const tree = join(campaign, "versions/measured");
    mkdirSync(join(tree, "agent"), { recursive: true });
    mkdirSync(join(tree, "correctness-model"), { recursive: true });
    mkdirSync(join(tree, "runs/eval"), { recursive: true });
    writeFileSync(join(tree, "agent/index.ts"), "export {};\n");
    const taskPath = join(tree, "correctness-model/tasks.json");
    writeFileSync(
      taskPath,
      JSON.stringify([
        {
          taskId: "timer-01",
          family: "timer",
          publicInput: { board: "esp32", request: "Create a stopwatch" },
          hidden: { secret: "hidden-answer" },
        },
      ]),
    );
    writeFileSync(
      join(tree, "runs/eval/battery.json"),
      JSON.stringify({
        runId: "eval",
        bundleSnapshot: {
          id: "measured",
          agentHash: hashBundle(join(tree, "agent")).hash,
          correctnessModelHash: hashBundle(join(tree, "correctness-model"), {
            excludeTop: [...BATTERY_FILES],
          }).hash,
          taskSetHash: batteryHash(join(tree, "correctness-model")),
        },
      }),
    );
    const row = { runId: "eval", slug: "widget", traces: [tracePointer(tree, "runs/eval/battery.json")] };
    const content = recordedTaskContent(campaign, row);
    expect(content.get("timer-01")?.input).toEqual({ board: "esp32", request: "Create a stopwatch" });
    expect(JSON.stringify([...content])).not.toContain("hidden-answer");
    writeFileSync(taskPath, JSON.stringify([{ taskId: "timer-01", publicInput: "different task" }]));
    expect(recordedTaskContent(campaign, row).size).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
