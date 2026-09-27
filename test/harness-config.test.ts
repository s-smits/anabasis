import { afterAll, describe, expect, it } from "bun:test";
import { tmpdir } from "node:os";

import { loadValidatedBundle } from "../src/author/candidate-check.ts";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import {
  DEFAULT_HARNESS_SETTINGS,
  HARNESS_CONFIG_FILE,
  harnessConfigIssue,
  harnessSettings,
} from "../src/correctness-bundle/harness-config.ts";

const STARTER = join(import.meta.dir, "../starters/pi-built-harness");
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function workspace(config: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "harness-config-"));
  roots.push(root);
  if (config !== null) {
    mkdirSync(join(root, "agent"), { recursive: true });
    writeFileSync(join(root, HARNESS_CONFIG_FILE), config);
  }
  return root;
}

/** The settings a workspace holding `text` resolves to, read through the product's own file path. */
const parsed = (text: string) => harnessSettings(workspace(text));

/** The refusal message for `text`, without the file prefix the bundle contract adds. */
const refusal = (text: string): string | undefined =>
  harnessConfigIssue(workspace(text))?.slice(`${HARNESS_CONFIG_FILE} `.length);

describe("agent/config.yaml", () => {
  it("seeds the starter with exactly the defaults and states the host bounds on an increase or a short solver wall", () => {
    expect(readFileSync(join(STARTER, HARNESS_CONFIG_FILE), "utf8")).toContain(
      "the host refuses a solver or battery value more than ten times its seeded one, or a\n# solver value below a tenth of it; gate walls have no maximum",
    );
    expect(readFileSync(join(STARTER, HARNESS_CONFIG_FILE), "utf8")).not.toContain("far above");
    expect(harnessSettings(STARTER)).toEqual(DEFAULT_HARNESS_SETTINGS);
  });

  it("keeps the default for an absent file, an empty file or an absent key", () => {
    expect(harnessSettings(workspace(null))).toBe(DEFAULT_HARNESS_SETTINGS);
    expect(parsed("")).toEqual(DEFAULT_HARNESS_SETTINGS);
    const changed = parsed("solver:\n  max_turns: 60\ngate:\n  census_minutes: 90\n");
    expect(changed).toEqual({ ...DEFAULT_HARNESS_SETTINGS, maxTurns: 60, censusWallMs: 90 * 60_000 });
  });

  // A gate wall has no maximum, since a stronger witness needs the reference solve longest; a solver
  // wall keeps ten times its default, because the solve wall is part of the measured condition.
  it("admits any gate wall and refuses a solver wall past ten times its default", () => {
    expect(parsed("solver:\n  max_turns: 240\n  solve_minutes: 1200\n")).toMatchObject({
      maxTurns: 240,
      solveMs: 1200 * 60_000,
    });
    expect(parsed("gate:\n  reference_solve_seconds: 86400\n").referenceSolveMs).toBe(86_400_000);
    expect(refusal("gate:\n  census_minutes: 3000\n")).toBeUndefined();
    expect(refusal("solver:\n  max_turns: 241\n")).toBe(
      "solver.max_turns 241 is above what this host allows; choose a value closer to the seeded one",
    );
    expect(refusal("solver:\n  solve_minutes: 1201\n")).toContain("solver.solve_minutes");
  });

  // A one-minute solve wall let every case end in the wall's own submit of a draft the solver had
  // never seen a command return for, so the solver's walls stop at a tenth; the gate's do not. The
  // floor refuses a candidate or a solve, never the read of a recorded bundle that declared one.
  it("refuses a solver wall below a tenth of its default and leaves the gate's alone", () => {
    expect(parsed("solver:\n  solve_minutes: 1\n").solveMs).toBe(60_000);
    const recorded = workspace("solver:\n  solve_minutes: 1\n");
    expect(
      loadValidatedBundle(recorded, { slug: "config" }).findings.find(
        ({ code }) => code === "harness-config-invalid",
      )?.detail,
    ).toBe(
      "agent/config.yaml solver.solve_minutes 1 is below what this host allows; choose a value closer to the seeded one",
    );
    expect(parsed("solver:\n  solve_minutes: 12\n  max_turns: 3\n")).toMatchObject({
      solveMs: 12 * 60_000,
      maxTurns: 3,
    });
    expect(refusal("solver:\n  solve_minutes: 1\n")).toBe(
      "solver.solve_minutes 1 is below what this host allows; choose a value closer to the seeded one",
    );
    expect(refusal("solver:\n  max_turns: 2\n")).toContain("below what this host allows");
    expect(parsed("gate:\n  check_seconds: 1\n").checkWallMs).toBe(1000);
  });

  // The battery width joined the file on 2026-09-18: the harness knows how heavy one of its cases
  // is and what the host has to run them on, so it declares the width instead of the run alone.
  it("lets the harness declare the battery width, up to ten times the seeded one", () => {
    expect(parsed("battery:\n  solve_concurrency: 12\n").solveConcurrency).toBe(12);
    expect(parsed("battery:\n  solve_concurrency: 30\n").solveConcurrency).toBe(30);
    expect(refusal("battery:\n  solve_concurrency: 31\n")).toBe(
      "battery.solve_concurrency 31 is above what this host allows; choose a value closer to the seeded one",
    );
    expect(refusal("battery:\n  solve_concurrency: 0\n")).toContain("positive whole number");
  });

  it("refuses a malformed value, key, section or ordering", () => {
    expect(refusal("solver:\n  max_turns: 2.5\n")).toBe("solver.max_turns must be a positive whole number");
    expect(refusal("solver:\n  max_turns: 0\n")).toContain("positive whole number");
    expect(refusal('solver:\n  max_turns: "30"\n')).toContain("positive whole number");
    expect(refusal("solver:\n  turns: 30\n")).toBe("solver has no setting turns");
    expect(refusal("limits:\n  x: 1\n")).toBe("has no section limits");
    expect(refusal("solver: 3\n")).toBe("solver must be a mapping");
    expect(refusal("- 1\n")).toBe("must be a mapping");
    expect(refusal("solver: [\n")).toContain("is not valid YAML");
    expect(refusal("solver:\n  shell_timeout_seconds: 500\n  shell_timeout_max_seconds: 400\n")).toContain(
      "must not exceed solver.shell_timeout_max_seconds",
    );
  });

  it("refuses a defective config at the bundle contract with its path", () => {
    const root = workspace("battery:\n  solve_concurrency: 31\n");
    expect(harnessConfigIssue(root)).toBe(
      "agent/config.yaml battery.solve_concurrency 31 is above what this host allows; choose a value closer to the seeded one",
    );
    const finding = loadValidatedBundle(root, { slug: "config" }).findings.find(
      ({ code }) => code === "harness-config-invalid",
    );
    expect(finding?.path).toBe(HARNESS_CONFIG_FILE);
    expect(harnessConfigIssue(workspace("solver:\n  solve_minutes: 240\n"))).toBeNull();
    expect(
      loadValidatedBundle(workspace(null), { slug: "config" }).findings.map(({ code }) => code),
    ).not.toContain("harness-config-invalid");
  });
});
