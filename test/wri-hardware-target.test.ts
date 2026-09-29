/**
 * The `target` reader: which boards a run's request and brief name, and which runs asked the same
 * request on other source. A firmware request fires the trigger that starts lanes 29 and 30; a
 * truss request names no board and fires nothing; a run under another request digest, or on the
 * same commit, is never paired.
 */
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import {
  buildHardwareTarget,
  HARDWARE_TRIGGER,
  namedTargets,
  referenceIdentity,
  renderHardwareTarget,
  targetsIn,
} from "../.claude/skills/whole-run-investigation/scripts/hardware-target.ts";

const FIRMWARE =
  "Build a harness that writes firmware for ESP32, Raspberry Pi Pico and Arduino Uno, connecting sensors, displays and lights, where the code must compile.";
const TRUSS =
  "designs lightweight steel trusses to Eurocode 3 and checks every member against its buckling limit";
const DIGEST = "9c0c68b1a4fe";

interface RunSpec {
  slug: string;
  runId: string;
  commit: string;
  openedAt: string;
  digest?: string;
  request?: string;
  domain?: string;
}

afterAll(cleanupScratch);

/** One campaign under `root` with one run: its opening, its journal's directive row and, when a
 *  domain is given, a current epoch whose brief states it. */
function run(root: string, spec: RunSpec): string {
  const campaign = join(root, spec.slug);
  const controller = join(campaign, "controller", spec.runId);
  mkdirSync(controller, { recursive: true });
  writeFileSync(
    join(controller, "opening.json"),
    JSON.stringify({
      runId: spec.runId,
      writtenAt: spec.openedAt,
      project: { requestDigest: spec.digest ?? DIGEST },
      source: { commit: spec.commit, dirty: false, sourceDigest: "e".repeat(64) },
    }),
  );
  if (spec.request !== undefined) {
    mkdirSync(join(campaign, "observability"), { recursive: true });
    const directive = {
      type: "prompt-ingested",
      contract: "builder",
      role: "user-directive",
      prompt: spec.request,
    };
    writeFileSync(
      join(campaign, "observability", `${spec.runId}.jsonl`),
      `{"type":"run-started"}\n${JSON.stringify(directive)}\n`,
    );
  }
  if (spec.domain !== undefined) {
    const brief = join(campaign, "epoch-a", "workspace", "correctness-model");
    mkdirSync(brief, { recursive: true });
    writeFileSync(join(brief, "brief.json"), JSON.stringify({ domain: spec.domain }));
    writeFileSync(
      join(campaign, "epochs.json"),
      JSON.stringify({ schema: "campaign-epochs/v1", current: "epoch-a", epochs: [{ key: "epoch-a" }] }),
    );
  }
  return campaign;
}

const SHA = (digit: string): string => digit.repeat(40);

describe("which hardware a run names", () => {
  it("fires on the firmware request and names each board family once", () => {
    const root = scratchDir("ana-target-");
    const campaign = run(root, {
      slug: "fw-18",
      runId: "run-18",
      commit: SHA("a"),
      openedAt: "2026-09-27T15:01:12.902Z",
      request: FIRMWARE,
      domain: "Arduino-language firmware for Arduino Uno, Raspberry Pi Pico and ESP32",
    });
    const report = buildHardwareTarget({ campaign, runId: "run-18" });

    expect(report.named.map((row) => [row.family, row.text, row.where])).toEqual([
      ["ESP32", "ESP32", "request"],
      ["RP2040", "Raspberry Pi Pico", "request"],
      ["AVR", "Arduino Uno", "request"],
    ]);
    expect(report.triggers.map((row) => row.name)).toEqual([HARDWARE_TRIGGER]);
    expect(report.triggers[0]?.examples[0]).toContain("no other run asked this request on other source");
    expect(renderHardwareTarget(report)).toContain(HARDWARE_TRIGGER);
  });

  it("does not fire on the truss request, whose brief names no board either", () => {
    const root = scratchDir("ana-target-");
    const campaign = run(root, {
      slug: "truss-1",
      runId: "run-1",
      commit: SHA("a"),
      openedAt: "2026-09-27T15:00:00.000Z",
      request: TRUSS,
      domain: "Steel roof truss design to Eurocode 3",
    });
    const report = buildHardwareTarget({ campaign, runId: "run-1" });

    expect(report.named).toEqual([]);
    expect(report.triggers).toEqual([]);
    expect(renderHardwareTarget(report)).toContain("lanes 29 and 30 have nothing to read");
  });

  it("reads a board the brief names when the request is not recorded", () => {
    const root = scratchDir("ana-target-");
    const campaign = run(root, {
      slug: "fw-brief",
      runId: "run-b",
      commit: SHA("a"),
      openedAt: "2026-09-27T15:00:00.000Z",
      domain: "MicroPython drivers for the RP2040",
    });
    expect(namedTargets(campaign, "run-b")).toEqual([{ family: "RP2040", text: "RP2040", where: "brief" }]);
  });

  it("does not read a framework name or an ordinary lowercase word as a board", () => {
    expect(targetsIn("Arduino-language firmware for a pico-scale sensor", "brief")).toEqual([]);
  });
});

describe("which runs asked the same request on other source", () => {
  it("pairs the nearest run on each side and never a same-commit run or another request", () => {
    const root = scratchDir("ana-target-");
    const base = { request: FIRMWARE };
    run(root, {
      ...base,
      slug: "fw-15",
      runId: "run-15",
      commit: SHA("b"),
      openedAt: "2026-09-27T05:25:00.000Z",
    });
    run(root, {
      ...base,
      slug: "fw-16",
      runId: "run-16",
      commit: SHA("a"),
      openedAt: "2026-09-27T14:00:00.000Z",
    });
    const campaign = run(root, {
      ...base,
      slug: "fw-18",
      runId: "run-18",
      commit: SHA("a"),
      openedAt: "2026-09-27T15:01:12.902Z",
    });
    run(root, {
      ...base,
      slug: "fw-19",
      runId: "run-19",
      commit: SHA("c"),
      openedAt: "2026-09-27T20:24:00.000Z",
    });
    run(root, {
      slug: "truss-7",
      runId: "run-7",
      commit: SHA("d"),
      openedAt: "2026-09-27T16:00:00.000Z",
      digest: "ffffffffffff",
      request: TRUSS,
    });

    const report = buildHardwareTarget({ campaign, runId: "run-18" });

    expect(report.sameRequest.map((row) => row.runId)).toEqual(["run-15", "run-19"]);
    expect(report.nearest.before?.runId).toBe("run-15");
    expect(report.nearest.after?.runId).toBe("run-19");
    expect(report.triggers[0]?.examples[0]).toContain(
      `before fw-15/run-15 on bbbbbbbbb, after fw-19/run-19 on ccccccccc (2 run(s) on 2 other commit(s))`,
    );
  });
});

describe("the pinned reference tree", () => {
  it("records a missing tree as a gap, a Git tree by revision and any other tree by content", () => {
    expect(referenceIdentity("/nonexistent/reference-tree").state).toBe("missing");

    const plain = scratchDir("ana-target-ref-");
    writeFileSync(join(plain, "board.h"), "#define LED 2\n");
    const content = referenceIdentity(plain);
    expect(content.state).toBe("content");
    expect(content.contentDigest).toMatch(/^[0-9a-f]{64}$/);

    const repo = scratchDir("ana-target-git-");
    const git = (...args: string[]): void => {
      const result = spawnSync("git", ["-C", repo, ...args]);
      if (result.status !== 0) throw new Error(result.stderr);
    };
    git("init", "-q");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "Test");
    writeFileSync(join(repo, "board.h"), "#define LED 2\n");
    git("add", ".");
    git("commit", "-qm", "reference");
    const pinned = referenceIdentity(repo);
    expect(pinned.state).toBe("git");
    expect(pinned.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(pinned.dirty).toBe(false);
  });
});
