import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { type PublicVerdict, bundleSlug, resolveTask } from "../src/run/bundle-entry.ts";
import { exportBundle } from "../src/run/bundle-export.ts";
import { MATCHING_ACCEPTS, writeMatchingBuildFixture } from "./helpers/matching-fixture.ts";

const REPO_ROOT = resolve(import.meta.dir, "..");
const scratch = mkdtempSync(join(tmpdir(), "ana-bundle-export-"));
const slugDir = join(scratch, "matching");
const outDir = join(scratch, "exported");
writeMatchingBuildFixture(slugDir);
const exported = exportBundle(REPO_ROOT, slugDir, outDir);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function bunIn(cwd: string, args: string[]) {
  const result = Bun.spawnSync([Bun.argv[0] ?? "bun", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function check(taskId: string, artifact: JsonValue) {
  const artifactPath = join(scratch, `${taskId}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(artifactPath, JSON.stringify(artifact));
  const run = bunIn(outDir, [
    "run",
    "--silent",
    "check",
    "--",
    taskId,
    artifactPath,
    join(scratch, "checks"),
  ]);
  const verdict =
    /* SAFETY: the check script prints exactly one JSON document, the PublicVerdict it computed; a non-JSON stdout fails this parse and the test with it. */ JSON.parse(
      run.stdout,
    ) as PublicVerdict;
  return { ...verdict, code: run.code, stderr: run.stderr };
}

describe("an exported Built Harness bundle", () => {
  it("inherits expectations only for the same public task and refuses unsafe task paths", () => {
    const recorded = resolveTask(slugDir, "t1");
    const file = join(scratch, "task.json");
    const publicTask = {
      taskId: recorded.taskId,
      family: recorded.family,
      publicInput: recorded.publicInput,
    };
    writeFileSync(file, JSON.stringify(publicTask));
    expect(resolveTask(slugDir, file, "check").hidden).toEqual(recorded.hidden);
    writeFileSync(file, JSON.stringify({ ...publicTask, publicInput: { changed: true } }));
    expect(() => resolveTask(slugDir, file, "check")).toThrow(/expectations/);
    expect(resolveTask(slugDir, file).hidden).toEqual([]);
    writeFileSync(file, JSON.stringify({ ...publicTask, taskId: "new-task" }));
    expect(() => resolveTask(slugDir, file, "check")).toThrow(/expectations/);
    writeFileSync(file, JSON.stringify({ ...publicTask, taskId: "../escaped", hidden: [] }));
    expect(() => resolveTask(slugDir, file)).toThrow(/taskId/);
    writeFileSync(file, JSON.stringify({ ...publicTask, hidden: [null] }));
    expect(() => resolveTask(slugDir, file, "check")).toThrow(/hidden/);
    writeFileSync(file, JSON.stringify({ ...publicTask, taskId: "new-task", hidden: recorded.hidden }));
    expect(resolveTask(slugDir, file, "check").hidden).toEqual(recorded.hidden);
  });
  it("carries the bundle, the source it imports, the lock and two entries", () => {
    for (const entry of [
      "agent",
      "correctness-model",
      "src",
      "vendor",
      "starters",
      "tools",
      "bun.lock",
      ".bun-version",
      "package.json",
      "README.md",
      "harness.json",
    ]) {
      expect(exported.entries).toContain(entry);
    }
    expect(exported.toolTree).toBe("absent");
    const manifest = /* SAFETY: the export wrote this manifest itself with these two keys. */ JSON.parse(
      readFileSync(join(outDir, "package.json"), "utf8"),
    ) as { name: string; workspaces: string[] };
    expect(manifest.name).toBe("matching");
    expect(manifest.workspaces).toEqual([
      "vendor/agent-bundle",
      "vendor/correctness-model-bundle",
      "vendor/correctness-model-prims",
    ]);
    const readme = readFileSync(join(outDir, "README.md"), "utf8");
    expect(readme).toContain("bun run solve -- ");
    expect(readme).toContain("bun run check -- ");
    expect(readme).toContain("CLAUDE_BUILT_MODEL");
    expect(readme).toContain("## Take the Harness along");
    expect(readFileSync(join(outDir, ".harness", "backends", "default.json"), "utf8")).toContain(
      '"disabled": true',
    );
  });

  it("refuses a non-bundle and a non-empty target", () => {
    const empty = join(scratch, "not-a-bundle");
    mkdirSync(empty, { recursive: true });
    expect(() => exportBundle(REPO_ROOT, empty, join(scratch, "unused"))).toThrow(/no agent\//);
    const refused = bunIn(REPO_ROOT, ["tools/harness/cli.ts", "export", empty, join(scratch, "unused")]);
    expect(refused.code).toBe(2);
    expect(refused.stderr.trim()).toBe(`${empty}: not a Built Harness bundle (no agent/)`);
    expect(() => exportBundle(REPO_ROOT, slugDir, outDir)).toThrow(/not empty/);
  });

  it("copies an adopted tool-tree link and internal links, and names escaping or dangling links it leaves out", () => {
    const bundle = join(scratch, "linked-tools");
    const tools = join(scratch, "adopted-tools");
    const target = join(scratch, "linked-export");
    writeMatchingBuildFixture(bundle);
    const brief = join(bundle, "correctness-model", "brief.json");
    writeFileSync(
      brief,
      readFileSync(brief, "utf8").replace(/"evidence":\s*\{/, '"requiredToolIds": ["tool"], $&'),
    );
    mkdirSync(tools);
    writeFileSync(join(tools, "tool"), "tool bytes");
    symlinkSync("tool", join(tools, "relative-tool"));
    symlinkSync(join(tools, "tool"), join(tools, "absolute-tool"));
    symlinkSync(tools, join(bundle, ".toolchain"));
    expect(exportBundle(REPO_ROOT, bundle, target).toolTree).toBe("copied");
    for (const name of ["tool", "relative-tool", "absolute-tool"]) {
      expect(readFileSync(join(target, ".toolchain", name), "utf8")).toBe("tool bytes");
    }
    const outside = join(scratch, "adopted-tools-outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel"), "outside bytes");
    symlinkSync(outside, join(tools, "unselected"));
    symlinkSync(join(scratch, "missing"), join(tools, "dangling"));
    const leaving = join(scratch, "leaving-export");
    expect(exportBundle(REPO_ROOT, bundle, leaving).leftOut.toSorted()).toEqual(["dangling", "unselected"]);
    expect(existsSync(join(leaving, ".toolchain", "unselected"))).toBe(false);
    expect(readFileSync(join(leaving, ".toolchain", "tool"), "utf8")).toBe("tool bytes");
    const header = readFileSync(join(leaving, "README.md"), "utf8").split("\n")[2];
    expect(header).toMatch(
      /host PATH: (dangling|unselected), (dangling|unselected)\. Its checks run: tool\.$/,
    );
  });

  it("names a retained version after the project its record names, not its run id", () => {
    const version = join(scratch, "truss-run-i02");
    writeMatchingBuildFixture(version);
    writeFileSync(join(version, "version.json"), JSON.stringify({ fingerprint: { slug: "the-project" } }));
    expect(bundleSlug(version)).toBe("the-project");
    expect(bundleSlug(slugDir)).toBe("matching");
    expect(bundleSlug(outDir)).toBe("matching");
  });

  it("installs frozen from the copied lock", () => {
    const install = bunIn(outDir, ["install", "--frozen-lockfile"]);
    expect(install.stderr.replace(/\n$/, "")).toBe("");
    expect(install.code).toBe(0);
    expect(existsSync(join(outDir, "node_modules", "@ana", "correctness-model-bundle"))).toBe(true);
    expect(existsSync(join(outDir, "node_modules", "@earendil-works", "pi-ai"))).toBe(true);
  }, 60_000);

  it("passes a known-correct artifact through `bun run check` and names the failed check for a wrong one", () => {
    const accept = MATCHING_ACCEPTS[0];
    if (accept === undefined) throw new Error("fixture has no accept control");
    const good = check(accept.taskId, accept.artifact);
    expect(good.stderr).toBe("");
    expect({
      pass: good.pass,
      truthOk: good.truthOk,
      failedCheckIds: good.failedCheckIds,
      code: good.code,
    }).toEqual({
      pass: true,
      truthOk: true,
      failedCheckIds: [],
      code: 0,
    });
    expect(existsSync(good.evidencePath)).toBe(true);
    // The evaluator ignores extra fields, but ordinary public submission admission refuses them.
    const outsideSchema = check(accept.taskId, { ...accept.artifact, extra: true });
    expect(outsideSchema.pass).toBe(false);
    expect(outsideSchema.truthOk).toBeNull();
    expect(outsideSchema.code).toBe(1);
    // Only the public verdict fields reach stdout; the issue text stays in the evidence file.
    const wrong = check(accept.taskId, {
      assignments: [
        { part: "alpha", slot: "s4" },
        { part: "beta", slot: "s3" },
      ],
    });
    expect(wrong.pass).toBe(false);
    expect(wrong.truthOk).toBe(false);
    expect(wrong.failedCheckIds).toContain("expected-binding");
    expect(wrong.code).toBe(1);
  }, 60_000);
});
