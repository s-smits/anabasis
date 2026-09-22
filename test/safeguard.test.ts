import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  SAFEGUARDS_LOG_FILE,
  SAFEGUARD_INVENTORY,
  createSafeguardContext,
  safeguardLogDir,
  safeguardTempRootPressure,
  safeguardTriggered,
  scanTempRootScratch,
  tempRootScratchPressure,
} from "../src/meta/safeguard.ts";

describe("safeguard log", () => {
  test("appends one bounded line per invocation and never throws", () => {
    const dir = mkdtempSync(`${tmpdir()}/safeguard-`);
    const context = createSafeguardContext(dir);
    safeguardTriggered("5-zero-tool-battery", "first  line\nwith   noise", context);
    safeguardTriggered("5-zero-tool-battery", "x".repeat(900), context);
    const lines = readFileSync(`${dir}/${SAFEGUARDS_LOG_FILE}`, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("| 5-zero-tool-battery | first line with noise");
    // Keep each detail on one bounded line so the log remains easy to search.
    expect(lines[1]?.length).toBeLessThan(600);
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("an unwritable log directory does not throw", () => {
    const context = createSafeguardContext("/proc/1/safeguard-no-write");
    expect(() => safeguardTriggered("t", "detail", context)).not.toThrow();
  });

  // The durable channel belongs to one resolved controller run. Before this, a caller with no run
  // identity - the codex transport's session-data retry was the only one - left its receipt at
  // <process cwd>/SAFEGUARDS_LOG.txt, where no campaigns/<slug>/safeguards/<runId>/ reader finds
  // it and where cwd is as often the operator's checkout as a run directory.
  test("a caller with no run context leaves no receipt under the process cwd", () => {
    const marker = "no-run-context-receipt-must-not-reach-cwd";
    const path = join(runtimeProcess.cwd(), SAFEGUARDS_LOG_FILE);
    expect(() => safeguardTriggered("16-codex-session-data-retry", marker)).not.toThrow();
    const written = existsSync(path) ? readFileSync(path, "utf8") : "";
    expect(written).not.toContain(marker);
  });

  test("the same call with a run context keeps its durable receipt", () => {
    const context = createSafeguardContext(mkdtempSync(`${tmpdir()}/safeguard-owned-`));
    safeguardTriggered("16-codex-session-data-retry", "owned receipt", context);
    expect(readFileSync(join(context.logDir, SAFEGUARDS_LOG_FILE), "utf8")).toContain(
      "| 16-codex-session-data-retry | owned receipt",
    );
  });

  test("a broken stderr remains diagnostic-only and does not suppress the durable line", () => {
    const dir = mkdtempSync(`${tmpdir()}/safeguard-stderr-`);
    const context = createSafeguardContext(dir);
    const original = console.error;
    try {
      console.error = () => {
        throw new Error("stderr closed");
      };
      expect(() => safeguardTriggered("stderr-broken", "still record this", context)).not.toThrow();
    } finally {
      console.error = original;
    }
    expect(readFileSync(`${dir}/${SAFEGUARDS_LOG_FILE}`, "utf8")).toContain(
      "| stderr-broken | still record this",
    );
  });

  test("run contexts keep concurrent diagnostic logs separate", async () => {
    const root = mkdtempSync(`${tmpdir()}/safeguard-runs-`);
    const first = createSafeguardContext(safeguardLogDir(join(root, "campaigns", "demo"), "run-a"));
    const second = createSafeguardContext(safeguardLogDir(join(root, "campaigns", "demo"), "run-b"));

    await Promise.all([
      (async () => {
        await Bun.sleep(2);
        safeguardTriggered("first-run", "only first", first);
      })(),
      (async () => {
        safeguardTriggered("second-run", "only second", second);
        await Bun.sleep(1);
      })(),
    ]);

    expect(readFileSync(join(first.logDir, SAFEGUARDS_LOG_FILE), "utf8")).toContain("| first-run |");
    expect(readFileSync(join(second.logDir, SAFEGUARDS_LOG_FILE), "utf8")).toContain("| second-run |");
    expect(readFileSync(join(first.logDir, SAFEGUARDS_LOG_FILE), "utf8")).not.toContain("second-run");
  });
});

describe("safeguard 21 - temp-root spawn hazard", () => {
  // 2026-08-30/31: 171,290 entries in the per-user temp root stalled every fresh child spawn in
  // __getdirentries64. The scan must count the product's own mkdtemp prefixes and stop early.
  test("counts ana- scratch entries and ignores everything else", () => {
    const root = mkdtempSync(`${tmpdir()}/safeguard-temp-`);
    for (const name of ["ana-user-context-aaa", "ana-generated-tools-bbb", "ana-verifier-ccc"]) {
      mkdirSync(join(root, name));
    }
    for (const name of ["com.apple.launchd.x", "unrelated-scratch"]) mkdirSync(join(root, name));
    const scan = scanTempRootScratch(root);
    expect(scan.scanned).toBe(5);
    expect(scan.matched).toBe(3);
    expect(scan.capped).toBe(false);
    expect(tempRootScratchPressure(scan)).toBe(false);
  });

  test("a missing root reports nothing and never throws", () => {
    expect(() => scanTempRootScratch("/nonexistent-root/nope")).not.toThrow();
    expect(scanTempRootScratch("/nonexistent-root/nope")).toEqual({ scanned: 0, matched: 0, capped: false });
  });

  test("the pressure predicate fires on a capped walk and on the matched ceiling", () => {
    expect(tempRootScratchPressure({ scanned: 5000, matched: 3, capped: true })).toBe(true);
    expect(tempRootScratchPressure({ scanned: 4000, matched: 1000, capped: false })).toBe(true);
    expect(tempRootScratchPressure({ scanned: 4000, matched: 999, capped: false })).toBe(false);
  });

  test("a quiet temp root leaves no line, and a loaded one names the counts and the ceiling", () => {
    const quiet = mkdtempSync(`${tmpdir()}/safeguard-temp-quiet-`);
    const quietContext = createSafeguardContext(mkdtempSync(`${tmpdir()}/safeguard-temp-log-`));
    mkdirSync(join(quiet, "ana-user-context-one"));
    safeguardTempRootPressure(quietContext, quiet);
    expect(existsSync(join(quietContext.logDir, SAFEGUARDS_LOG_FILE))).toBe(false);

    const loaded = mkdtempSync(`${tmpdir()}/safeguard-temp-loaded-`);
    for (let i = 0; i < 5001; i += 1) writeFileSync(join(loaded, `ana-leak-${String(i)}`), "");
    const loadedContext = createSafeguardContext(mkdtempSync(`${tmpdir()}/safeguard-temp-log2-`));
    safeguardTempRootPressure(loadedContext, loaded);
    const line = readFileSync(join(loadedContext.logDir, SAFEGUARDS_LOG_FILE), "utf8").trimEnd();
    expect(line).toContain("| 21-tempdir-spawn-hazard |");
    expect(line).toContain("walk stopped at the scan cap");
    expect(line).toContain("cap 5000 scanned");
    expect(line).toContain("getdirentries64");
    // The walk must stop at the cap rather than enumerate everything it was written to watch.
    expect(scanTempRootScratch(loaded).scanned).toBe(5000);
    rmSync(loaded, { recursive: true, force: true });
  });
});

describe("safeguard inventory", () => {
  test("SAFEGUARD_INVENTORY equals the names emitted from src/, so the lifecycle report cannot drift", () => {
    // The lifecycle reader compares emitted names with this inventory. Set equality checks
    // that the inventory matches all literal safeguard calls found under src/.
    const srcRoot = join(import.meta.dir, "..", "src");
    const emitted = new Set<string>();
    for (const entry of readdirSync(srcRoot, { recursive: true })) {
      const path = join(srcRoot, String(entry));
      if (!path.endsWith(".ts") || !statSync(path).isFile()) continue;
      for (const match of readFileSync(path, "utf8").matchAll(/safeguardTriggered\(\s*"([^"]+)"/g)) {
        if (match[1] !== undefined) emitted.add(match[1]);
      }
    }
    const inventory = SAFEGUARD_INVENTORY.map((row) => row.name);
    expect([...emitted].sort()).toEqual([...inventory].sort());
    for (const row of SAFEGUARD_INVENTORY) expect(row.introduced).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
