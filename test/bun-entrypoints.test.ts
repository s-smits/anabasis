import { describe, expect, it } from "bun:test";

const root = new URL("..", import.meta.url);
const agents = await Bun.file(new URL("AGENTS.md", root)).text();
const workflow = await Bun.file(new URL(".github/workflows/gate.yml", root)).text();
const preCommit = await Bun.file(new URL(".githooks/pre-commit", root)).text();
const prePush = await Bun.file(new URL(".githooks/pre-push", root)).text();
const manifest = await Bun.file(new URL("package.json", root)).json();
// SAFETY: the test reads only the optional top-level boolean it asserts below; all other TOML keys
// remain opaque to this projection.
const bunfig = Bun.TOML.parse(await Bun.file(new URL("bunfig.toml", root)).text()) as { env?: boolean };
const envBaseline = await Bun.file(new URL("test/env-baseline.ts", root)).text();
const gate = await Bun.file(new URL("tools/gate.sh", root)).text();
const testSuite = await Bun.file(new URL("tools/runtime/test-suite.ts", root)).text();
const testImpactScripts = await Promise.all(
  ["coverage-harvest.mjs", "impact-rank.mjs", "mutation-adjudicate.mjs"].map((file) =>
    Bun.file(new URL(`.claude/skills/test-impact-and-consolidation/scripts/${file}`, root)).text(),
  ),
);

describe("Bun-owned CI and Git hooks", () => {
  it("leaves repository dotenv precedence to the explicit environment owner", () => {
    expect(bunfig.env).toBe(false);
  });

  it("neutralises ambient workshop-cell composition controls", () => {
    expect(envBaseline).toContain('"ANA_WORKSHOP_VM"');
    expect(envBaseline).toContain('"ANA_VM_DIR"');
  });

  // An agent session exports FORCE_COLOR=3, which makes Bun wrap a child's `console.error` in ANSI
  // escapes on a pipe; two tests asserting captured child output failed on it on 18 September.
  it("neutralises ambient forced-colour toggles that change captured child output", () => {
    expect(envBaseline).toContain('"FORCE_COLOR"');
    expect(envBaseline).toContain('"CLICOLOR_FORCE"');
  });

  it("pins both CI jobs to the same stable release file as local setup", () => {
    expect(workflow).toContain("oven-sh/setup-bun");
    expect(workflow.match(/bun-version-file: \.bun-version/g)).toHaveLength(2);
    expect(workflow).not.toContain("bun-version: canary");
    expect(workflow.match(/bun install --frozen-lockfile/g)).toHaveLength(2);
  });

  // The pre-push hook owns the per-push gate, so CI reads main once a day and skips an unchanged head.
  it("runs CI on a daily schedule of main rather than on every push or pull request", () => {
    expect(workflow).toMatch(/schedule:\n\s+(#.*\n\s+)*- cron: "\d+ \d+ \* \* \*"/u);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/^\s+(push|pull_request):/mu);
    expect(workflow.match(/if: needs\.changed\.outputs\.run == 'true'/g)).toHaveLength(2);
  });

  it("runs both repository hooks through the pinned Bun command family", () => {
    const hooks = `${preCommit}\n${prePush}`;
    expect(hooks).toContain("bun");
  });

  it("keeps the owned test-impact launchers on Bun coverage and Bun tests", () => {
    const scripts = testImpactScripts.join("\n");
    expect(scripts).toContain("Bun.spawn");
    expect(scripts).not.toContain("npm_config_user_agent");
    expect(scripts).not.toContain("npm_command");
  });

  it("keeps repository work on Bun without package-manager compatibility wrappers", () => {
    // The 2026-09-06 AGENTS.md edit combined both sentences; the rule is unchanged.
    expect(agents).toMatch(
      /never Node, npm, npx,\s+compatibility prefixes, version managers or package-manager handshake-variable changes/u,
    );
  });

  it("runs the repository gate through the one declared test invocation", () => {
    expect(manifest.scripts.gate).toBe("bash tools/gate.sh");
    // The gate must not spell its own `bun test` line: a second spelling drifted from the `test`
    // script into a single-process run that the pre-push hook could not wait out.
    expect(gate).toContain("exec bun run test");
    expect(gate).not.toMatch(/exec bun test\b/);
    expect(manifest.scripts.test).toBe("bun tools/runtime/test-suite.ts");
    expect(testSuite).toContain("`--parallel=${String(workerCount(workers))}`");
    expect(testSuite).toContain('"--max-concurrency=4"');
    // Cases that spawn real workers, sandboxes and repositories can take several seconds.
    // Under parallel execution Bun's 5-second default caused failures when the host was busy,
    // so the suite sets one longer timeout shared by its tests. It is one named constant: the
    // rerun rule reads the same number to tell a clock-ended failure from an asserted one.
    expect(testSuite).toContain("const PER_TEST_WALL_MS = 60_000;");
    expect(testSuite).toContain("`--timeout=${String(PER_TEST_WALL_MS)}`");
    // One parallel process over the whole tree.
    expect(testSuite).toContain("--parallel=");
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
