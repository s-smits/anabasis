import { describe, expect, it } from "bun:test";
import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const root = new URL("..", import.meta.url);
const workflow = await Bun.file(new URL(".github/workflows/gate.yml", root)).text();
const manifest = await Bun.file(new URL("package.json", root)).json();
// SAFETY: the test reads only the optional top-level boolean it asserts below; all other TOML keys
// remain opaque to this projection.
const bunfig = Bun.TOML.parse(await Bun.file(new URL("bunfig.toml", root)).text()) as { env?: boolean };
const gate = await Bun.file(new URL("tools/gate.sh", root)).text();
const worktreeScript = await Bun.file(new URL("scripts/worktree.sh", root)).text();

describe("Bun-owned CI and Git hooks", () => {
  it("leaves repository dotenv precedence to the explicit environment owner", () => {
    expect(bunfig.env).toBe(false);
  });

  // An agent session exports FORCE_COLOR=3, which makes Bun wrap a child's `console.error` in ANSI
  // escapes on a pipe, so the baseline removes it with the sandbox, workshop and credential names;
  // the live-suite switch must survive, or the suite it enables can never run.
  it("strips ambient controls and credentials but keeps the live-suite opt-in switch", () => {
    const names = [
      "ANA_RUN_CODEX_OAUTH_LIVE",
      "ANA_CODEX_OAUTH_MODEL",
      "OPENAI_API_KEY",
      "CODEX_HOME",
      "CODEX_SANDBOX",
      "ANA_WORKSHOP_VM",
      "ANA_VM_DIR",
      "FORCE_COLOR",
      "CLICOLOR_FORCE",
    ];
    const seen = spawnTextSync(
      process.execPath,
      [
        "--preload",
        Bun.fileURLToPath(new URL("test/env-baseline.ts", root)),
        "-e",
        `console.log(JSON.stringify(${JSON.stringify(names)}.filter((name) => name in Bun.env)))`,
      ],
      {
        env: {
          PATH: Bun.env.PATH,
          HOME: Bun.env.HOME,
          ...Object.fromEntries(names.map((name) => [name, "1"])),
        },
      },
    );
    expect(seen.stderr).toContain("[env-baseline] removed 7 ambient variable(s)");
    expect(JSON.parse(seen.stdout)).toEqual(["ANA_RUN_CODEX_OAUTH_LIVE", "ANA_CODEX_OAUTH_MODEL"]);
  });

  it("pins both CI jobs to the same stable release file as local setup", () => {
    expect(workflow).toContain("oven-sh/setup-bun");
    expect(workflow.match(/bun-version-file: \.bun-version/g)).toHaveLength(2);
    expect(workflow).not.toContain("bun-version: canary");
    // Both jobs prepare through the script every worktree uses, and it installs only from the lock.
    expect(workflow.match(/bash scripts\/worktree\.sh setup "\$GITHUB_WORKSPACE"/g)).toHaveLength(2);
    expect(workflow).not.toMatch(/bun install(?! --frozen-lockfile)/);
    expect(worktreeScript).toContain("bun install --frozen-lockfile");
    expect(worktreeScript).not.toMatch(/bun install(?! --frozen-lockfile)/);
  });

  // The pre-push hook owns the per-push gate, so CI reads main once a day and skips an unchanged head.
  it("runs CI on a daily schedule of main rather than on every push or pull request", () => {
    expect(workflow).toMatch(/schedule:\n\s+(#.*\n\s+)*- cron: "\d+ \d+ \* \* \*"/u);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+(push|pull_request):/mu);
    expect(workflow.match(/if: needs\.changed\.outputs\.run == 'true'/g)).toHaveLength(2);
  });

  it("runs the repository gate through the one declared test invocation", () => {
    expect(manifest.scripts.gate).toBe("bash tools/gate.sh");
    // The gate must not spell its own `bun test` line: a second spelling drifted from the `test`
    // script into a single-process run that the pre-push hook could not wait out.
    expect(gate).toContain("exec bun run test");
    expect(gate).not.toMatch(/exec bun test\b/);
    expect(manifest.scripts.test).toBe("bun tools/runtime/test-suite.ts");
  });

  // `packages/ui` carries its own lock and node_modules, and `scripts/worktree.sh setup` prepares
  // the root ones only. The install used to sit inside `ui:gate`, three steps after lint, and lint
  // reads those types: on a fresh worktree it reported two type-aware findings that were not there
  // and hid two that were. Position, not presence, is the fix, so the test reads the order.
  it("installs the UI package's dependencies before the steps that read its types", () => {
    expect(gate).toContain("step ui-deps bun run ui:deps");
    expect(gate.indexOf("step ui-deps")).toBeLessThan(gate.indexOf("step typecheck"));
    expect(gate.indexOf("step ui-deps")).toBeLessThan(gate.indexOf("step lint"));
    expect(manifest.scripts["ui:deps"]).toBe("bun install --frozen-lockfile --cwd packages/ui");
    expect(manifest.scripts["ui:gate"]).toContain("bun run ui:deps");
  });

  it("runs the compact source policy before the executable acceptance suites", () => {
    expect(gate).toContain("bun tools/loc/source-policy.ts");
    expect(gate.indexOf("bun tools/loc/source-policy.ts")).toBeLessThan(gate.indexOf("exec bun run test"));
  });
});
