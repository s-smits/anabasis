import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import {
  STALE_AGE_MS,
  TEMP_SCRATCH_QUARANTINE_PREFIX,
  cleanStaleTempRootScratch,
} from "../src/meta/temp-scratch-clean.ts";

const MODULE = join(import.meta.dir, "../src/meta/temp-scratch-clean.ts");

/** Set an entry's modification time beyond the cleanup age threshold. */
function backdate(path: string): void {
  const staleSeconds = (Date.now() - STALE_AGE_MS - 60 * 60 * 1000) / 1000;
  utimesSync(path, staleSeconds, staleSeconds);
}

describe("stale temp scratch cleanup", () => {
  // 2026-08-30/31: about 150,000 leaked product mkdtemp directories stalled every fresh child
  // spawn in getdirentries64. The launch sweep removes product-owned stale entries from that root
  // without recursively walking them on the controller's critical path.
  test("quarantines stale ana- entries and leaves fresh and foreign ones", () => {
    const root = mkdtempSync(`${tmpdir()}/scratch-clean-root-`);
    try {
      const staleDir = join(root, "ana-leaked-gate");
      mkdirSync(join(staleDir, "nested"), { recursive: true });
      writeFileSync(join(staleDir, "nested", "artifact.json"), "{}");
      backdate(staleDir);
      const staleCampaign = join(root, "ana-leaked-campaign");
      mkdirSync(staleCampaign);
      backdate(staleCampaign);
      const live = join(root, "ana-live-run");
      mkdirSync(live);
      const foreign = join(root, "other-tool-scratch");
      mkdirSync(foreign);
      backdate(foreign);
      // A controller running past the stale window keeps its worker bundles at their original
      // mtime; a sibling launch moving them would break every later Built case of the live run.
      const workerBundle = join(root, "ana-pi-built-abc123");
      mkdirSync(workerBundle);
      backdate(workerBundle);
      const toolBundle = join(root, "ana-generated-tools-def456");
      mkdirSync(toolBundle);
      backdate(toolBundle);

      const report = cleanStaleTempRootScratch(root, { reclaim: false });

      expect(report).toEqual({ removed: 2, failed: 0, deadlineHit: false, reclaimerPid: null });
      expect(existsSync(staleDir)).toBe(false);
      expect(existsSync(staleCampaign)).toBe(false);
      expect(existsSync(live)).toBe(true);
      expect(existsSync(foreign)).toBe(true);
      expect(existsSync(workerBundle)).toBe(true);
      expect(existsSync(toolBundle)).toBe(true);
      const quarantine = readdirSync(root).find((name) => name.startsWith(TEMP_SCRATCH_QUARANTINE_PREFIX));
      expect(quarantine).toBeDefined();
      expect(existsSync(join(root, quarantine!, "ana-leaked-gate", "nested", "artifact.json"))).toBe(true);
      expect(existsSync(join(root, quarantine!, "ana-leaked-campaign"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an absent or unreadable root cleans nothing and never throws", () => {
    expect(() => cleanStaleTempRootScratch("/nonexistent-root/nope")).not.toThrow();
    expect(cleanStaleTempRootScratch("/nonexistent-root/nope")).toEqual({
      removed: 0,
      failed: 0,
      deadlineHit: false,
      reclaimerPid: null,
    });
  });

  test("a detached reclaimer removes the quarantine after the sweep returns", async () => {
    const root = mkdtempSync(`${tmpdir()}/scratch-clean-root-`);
    try {
      const staleDir = join(root, "ana-leaked-gate");
      mkdirSync(join(staleDir, "nested"), { recursive: true });
      writeFileSync(join(staleDir, "nested", "artifact.json"), "{}");
      backdate(staleDir);

      const report = cleanStaleTempRootScratch(root);

      expect(report.removed).toBe(1);
      expect(report.reclaimerPid).not.toBeNull();
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && readdirSync(root).length > 0) await Bun.sleep(25);
      expect(readdirSync(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // The launcher gives each run a private root under the disk-backed temp directory and nothing
  // else removed it, so finished runs' roots accumulated beside every later one.
  test.each([
    ["removes a launcher-made run root", "ana-quick-run-abc123", false],
    ["keeps an ordinary TMPDIR", "scratch-plain-tmp", true],
  ])("the exit of a controller that %s", async (_label, name, kept) => {
    const parent = mkdtempSync(`${tmpdir()}/run-root-parent-`);
    try {
      const root = join(parent, name);
      mkdirSync(root);
      const script = `import { removeRunTempRootAtExit } from ${JSON.stringify(MODULE)};
removeRunTempRootAtExit();
await Bun.write(${JSON.stringify(join(root, "cell", "artifact.json"))}, "{}");`;
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { ...Bun.env, ANA_TEST_TMPDIR: root, TMPDIR: root },
        stdio: ["ignore", "ignore", "inherit"],
      });
      expect(await child.exited).toBe(0);
      expect(existsSync(root)).toBe(kept);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  test("a run root the exit cannot remove whole keeps the controller's exit code", async () => {
    const parent = mkdtempSync(`${tmpdir()}/run-root-parent-`);
    const root = join(parent, "ana-quick-run-abc123");
    const readOnly = join(root, "cache");
    try {
      mkdirSync(readOnly, { recursive: true });
      writeFileSync(join(readOnly, "module"), "{}");
      chmodSync(readOnly, 0o555);
      const script = `import { removeRunTempRootAtExit } from ${JSON.stringify(MODULE)};
removeRunTempRootAtExit();
process.exit(3);`;
      const child = Bun.spawn([process.execPath, "-e", script], {
        env: { ...Bun.env, ANA_TEST_TMPDIR: root, TMPDIR: root },
        stdio: ["ignore", "ignore", "inherit"],
      });
      expect(await child.exited).toBe(3);
      expect(existsSync(join(readOnly, "module"))).toBe(true);
    } finally {
      chmodSync(readOnly, 0o755);
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
