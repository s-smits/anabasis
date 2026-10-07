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
  it("seeds the starter with exactly the defaults, every wall in seconds, and states the host bounds on a solver wall", () => {
    const seeded = readFileSync(join(STARTER, HARNESS_CONFIG_FILE), "utf8");
    expect(seeded).toContain(
      "the host refuses a solver wall more than ten times its seeded value\n# or below a tenth of it; gate walls have no maximum",
    );
    expect(seeded).not.toMatch(/_minutes|max_turns|battery:/);
    expect(harnessSettings(STARTER)).toEqual(DEFAULT_HARNESS_SETTINGS);
  });

  it("keeps the default for an absent file, an empty file or an absent key", () => {
    expect(harnessSettings(workspace(null))).toBe(DEFAULT_HARNESS_SETTINGS);
    expect(parsed("")).toEqual(DEFAULT_HARNESS_SETTINGS);
    const changed = parsed("solver:\n  solve_seconds: 3600\ngate:\n  check_seconds: 900\n");
    expect(changed).toEqual({ ...DEFAULT_HARNESS_SETTINGS, solveMs: 3_600_000, checkWallMs: 900_000 });
  });

  // The turn count, the census wall and the battery width left the file on 2026-10-07: no recorded
  // solve used more than two turns, the census wall only summed walls the file already sets, and the
  // width is host capacity. A file that still names one is refused, not read around.
  it("refuses the settings the host now owns", () => {
    expect(refusal("solver:\n  max_turns: 60\n")).toBe("solver has no setting max_turns");
    expect(refusal("gate:\n  census_minutes: 90\n")).toBe("gate has no setting census_minutes");
    expect(refusal("battery:\n  solve_concurrency: 3\n")).toBe("has no section battery");
    expect(refusal("solver:\n  shell_timeout_max_seconds: 900\n")).toBe(
      "solver has no setting shell_timeout_max_seconds",
    );
  });

  // A gate wall has no maximum, since a stronger witness needs the reference solve longest; a solver
  // wall keeps ten times its default, because the solve wall is part of the measured condition.
  it("admits any gate wall and refuses a solver wall past ten times its default", () => {
    expect(parsed("solver:\n  solve_seconds: 72000\n").solveMs).toBe(72_000_000);
    expect(parsed("gate:\n  reference_solve_seconds: 86400\n").referenceSolveMs).toBe(86_400_000);
    expect(refusal("gate:\n  check_seconds: 360000\n")).toBeUndefined();
    expect(refusal("solver:\n  shell_command_seconds: 9001\n")).toBe(
      "solver.shell_command_seconds 9001 is above what this host allows; choose a value closer to the seeded one",
    );
    expect(refusal("solver:\n  solve_seconds: 72001\n")).toContain("solver.solve_seconds");
  });

  // A one-minute solve wall let every case end in the wall's own submit of a draft the solver had
  // never seen a command return for, so the solver's walls stop at a tenth; the gate's do not. The
  // floor refuses a candidate or a solve, never the read of a recorded bundle that declared one.
  it("refuses a solver wall below a tenth of its default and leaves the gate's alone", () => {
    expect(parsed("solver:\n  solve_seconds: 60\n").solveMs).toBe(60_000);
    const recorded = workspace("solver:\n  solve_seconds: 60\n");
    expect(
      loadValidatedBundle(recorded, { slug: "config" }).findings.find(
        ({ code }) => code === "harness-config-invalid",
      )?.detail,
    ).toBe(
      "agent/config.yaml solver.solve_seconds 60 is below what this host allows; choose a value closer to the seeded one",
    );
    expect(refusal("solver:\n  solve_seconds: 720\n")).toBeUndefined();
    expect(refusal("solver:\n  shell_command_seconds: 89\n")).toContain("below what this host allows");
    expect(parsed("gate:\n  check_seconds: 1\n").checkWallMs).toBe(1000);
  });

  it("refuses a malformed value, key or section", () => {
    expect(refusal("solver:\n  solve_seconds: 2.5\n")).toBe(
      "solver.solve_seconds must be a positive whole number",
    );
    expect(refusal("solver:\n  solve_seconds: 0\n")).toContain("positive whole number");
    expect(refusal('solver:\n  solve_seconds: "30"\n')).toContain("positive whole number");
    expect(refusal("solver:\n  turns: 30\n")).toBe("solver has no setting turns");
    expect(refusal("limits:\n  x: 1\n")).toBe("has no section limits");
    expect(refusal("solver: 3\n")).toBe("solver must be a mapping");
    expect(refusal("- 1\n")).toBe("must be a mapping");
    expect(refusal("solver: [\n")).toContain("is not valid YAML");
  });

  it("refuses a defective config at the bundle contract with its path", () => {
    const root = workspace("solver:\n  solve_seconds: 72001\n");
    expect(harnessConfigIssue(root)).toBe(
      "agent/config.yaml solver.solve_seconds 72001 is above what this host allows; choose a value closer to the seeded one",
    );
    const finding = loadValidatedBundle(root, { slug: "config" }).findings.find(
      ({ code }) => code === "harness-config-invalid",
    );
    expect(finding?.path).toBe(HARNESS_CONFIG_FILE);
    expect(harnessConfigIssue(workspace("solver:\n  solve_seconds: 14400\n"))).toBeNull();
    expect(
      loadValidatedBundle(workspace(null), { slug: "config" }).findings.map(({ code }) => code),
    ).not.toContain("harness-config-invalid");
  });
});
