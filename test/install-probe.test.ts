import { dirname, join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { toolchainPathDirs } from "../src/verify/wall-policy.ts";

const script = join(
  import.meta.dir,
  "../.claude/skills/oss-verifier-grounding/scripts/install-probe/run-tool.mts",
);
const runner = Bun.argv[0];
interface Receipt {
  missing: string[];
  resolved: boolean;
  toolSource?: string;
  toolDigest?: string;
  executed?: boolean;
  outcome?: string;
  nonResultReason?: string | null;
  exitCode?: number | null;
  stdoutFirstLine?: string;
  unconfinedExit?: number | null;
}

/** The probe's own input: which installed tool to resolve, and what to run it with. */
interface ProbeSpec {
  toolId: string;
  args?: string[];
}

if (runner === undefined) throw new Error("Bun test runner supplied no executable path");
const bun: string = runner;

function probe(spec: ProbeSpec): Receipt {
  const result = spawnTextSync(bun, ["--no-env-file", script, JSON.stringify(spec)], {
    env: { PATH: `${dirname(bun)}:/usr/bin:/bin`, HOME: Bun.env.HOME ?? "", TMPDIR: Bun.env.TMPDIR ?? "" },
    timeout: 120_000,
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe("");
  return parseJsonAs<Receipt>(result.stdout.trim());
}

describe("the installed-tool probe", () => {
  it("resolves a tool on the host path and runs it through the wall", () => {
    // The wall's toolchain directories precede the process PATH, so the resolved `bun` is the one
    // under `~/.bun/bin`, which need not be the runner (2026-09-05: the host symlink stood at 1.4.1
    // while the runner was 1.4.2). Bind the receipt to the resolved executable, not to Bun.version.
    const resolved = resolveToolInventory({
      toolIds: ["bun"],
      toolTree: null,
      pathDirs: [...toolchainPathDirs(), dirname(bun), "/usr/bin", "/bin"],
    }).inventory["bun"];
    if (resolved === undefined) throw new Error("no bun on the probe's search path");
    const resolvedVersion = spawnTextSync(resolved.path, ["--version"], { timeout: 120_000 }).stdout.trim();
    const receipt = probe({ toolId: "bun", args: ["--version"] });
    expect(receipt.missing).toEqual([]);
    expect(receipt.resolved).toBe(true);
    expect(receipt.toolSource).toBe("host");
    expect(receipt.executed).toBe(true);
    expect(receipt.outcome).toBe("executed");
    expect(receipt.nonResultReason).toBe(null);
    expect(receipt.exitCode).toBe(0);
    expect(receipt.toolDigest).toBe(resolved.digest);
    expect(receipt.stdoutFirstLine).toBe(resolvedVersion);
    expect(receipt.unconfinedExit).toBe(0);
  }, 120_000);

  it("reports an uninstalled tool as missing instead of naming it to the host", () => {
    const receipt = probe({ toolId: "ana-no-such-tool" });
    expect(receipt.missing).toEqual(["ana-no-such-tool"]);
    expect(receipt.resolved).toBe(false);
    expect(receipt.executed).toBe(undefined);
  }, 120_000);
});
