import { describe, expect, it } from "bun:test";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import {
  assessSetup,
  cleanPastedToken,
  ensureEnvFile,
  feedHiddenInput,
  formatReport,
  readBunPin,
  type SetupProbe,
  tokenCommandRefusal,
  upsertEnvValue,
  type WallStatus,
  writeEnvFileAtomic,
} from "../tools/runtime/setup.ts";

const BASE_PROBE: SetupProbe = {
  bunVersion: "1.4.5",
  bunPin: "1.4.5",
  wall: "darwin",
  deps: "ok",
  hooks: "enabled",
  envFile: "ok",
  claudeOAuth: ["CLAUDE_CODE_OAUTH_TOKEN"],
  codexAuth: "missing",
  anthropicApiKey: "missing",
  openrouterApiKey: "missing",
  rg: "ok",
  python3: "ok",
};

describe("assessSetup over the bounded prerequisite state space", () => {
  it("marks ready iff Bun matches pin, OS wall is available, deps are installed, and at least one credential holds", () => {
    const walls: readonly WallStatus[] = [
      "darwin",
      "linux-ready",
      "missing-bwrap",
      "apparmor-restricted",
      "unsupported",
      "passed",
    ];
    const creds = ["claude", "codex-ready", "codex-expired", "api", "openrouter", "none"] as const;
    const grid = ["1.4.5", "1.4.4"].flatMap((bunVersion) =>
      walls.flatMap((wall) =>
        (["ok", "missing"] as const).flatMap((deps) =>
          creds.map((cred) => ({ bunVersion, wall, deps, cred })),
        ),
      ),
    );
    for (const { bunVersion, wall, deps, cred } of grid) {
      const probe: SetupProbe = {
        ...BASE_PROBE,
        bunVersion,
        wall,
        deps,
        claudeOAuth: cred === "claude" ? ["CLAUDE_CODE_OAUTH_TOKEN"] : [],
        codexAuth: cred === "codex-ready" ? "ready" : cred === "codex-expired" ? "expired" : "missing",
        anthropicApiKey: cred === "api" ? "ok" : "missing",
        openrouterApiKey: cred === "openrouter" ? "ok" : "missing",
      };
      const report = assessSetup(probe);
      const expectedReady =
        bunVersion === "1.4.5" &&
        (wall === "darwin" || wall === "linux-ready" || wall === "passed") &&
        deps === "ok" &&
        cred !== "none";
      expect(report.ready).toBe(expectedReady);
      if (!expectedReady && wall !== "unsupported") expect(report.actions.length).toBeGreaterThan(0);
    }
    expect(grid).toHaveLength(144);
  });

  it("recommends the exact remediation commands for Bun mismatch, Linux wall blocks, and missing credentials", () => {
    const linuxMissing = assessSetup({
      ...BASE_PROBE,
      bunVersion: "1.4.4",
      wall: "missing-bwrap",
      deps: "missing",
      hooks: "unset",
      envFile: "missing",
      claudeOAuth: [],
    });
    expect(linuxMissing.ready).toBe(false);
    const rendered = formatReport(linuxMissing);
    expect(rendered).toContain('curl -fsSL https://bun.com/install | bash -s "bun-v1.4.5"');
    expect(rendered).toContain("sudo apt-get install -y bubblewrap");
    expect(rendered).toContain("bun run setup --apply");
    expect(rendered).toContain("bun run setup --token");

    const apparmorBlocked = assessSetup({
      ...BASE_PROBE,
      wall: "apparmor-restricted",
    });
    expect(apparmorBlocked.ready).toBe(false);
    expect(formatReport(apparmorBlocked)).toContain(
      "sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0",
    );
  });

  it("keeps ready true when Codex is configured without a Claude token, without emitting a token blocker", () => {
    const report = assessSetup({
      ...BASE_PROBE,
      claudeOAuth: [],
      codexAuth: "ready",
    });
    expect(report.ready).toBe(true);
    expect(report.actions).toEqual([]);
    expect(formatReport(report)).toContain("Ready.");
  });
});

describe("upsertEnvValue, hidden token input, and atomic .env writes", () => {
  it("strips bracketed paste markers, control bytes, and line wraps from copied tokens", () => {
    expect(cleanPastedToken("\u001B[200~fake-tok-abc\ndef  \r\n\u001B[201~")).toBe("fake-tok-abcdef");
    expect(cleanPastedToken("  fake-tok\u007F-xyz\n")).toBe("fake-tok-xyz");
  });

  it("handles chunked backspaces, wrapped pastes, Ctrl-C cancel, and Enter submit in hidden input", () => {
    let step = feedHiddenInput("", "\u001B[200~fake-abx\u007Fc\n");
    expect(step).toEqual({ buffer: "fake-abc\n", outcome: "continue" });
    step = feedHiddenInput(step.buffer, "def\u001B[201~");
    expect(step).toEqual({ buffer: "fake-abc\ndef", outcome: "continue" });
    step = feedHiddenInput(step.buffer, "\r");
    expect(step).toEqual({ buffer: "fake-abcdef", outcome: "submit" });
    expect(feedHiddenInput("partial", "\u0003").outcome).toBe("cancel");
  });

  it("replaces empty, exported, or duplicate keys in place and preserves comments, CRLF, and neighbouring keys", () => {
    const template = [
      "# comment",
      "export CLAUDE_CODE_OAUTH_TOKEN=old-one",
      "CLAUDE_CODE_OAUTH_TOKEN=old-two",
      "CLAUDE_CODE_OAUTH_TOKEN2=keep-second",
      "OPENROUTER_API_KEY=keep-or",
      "",
    ].join("\r\n");
    const updated = upsertEnvValue(template, "CLAUDE_CODE_OAUTH_TOKEN", "tok-1");
    expect(updated).toBe(
      [
        "# comment",
        "CLAUDE_CODE_OAUTH_TOKEN=tok-1",
        "CLAUDE_CODE_OAUTH_TOKEN2=keep-second",
        "OPENROUTER_API_KEY=keep-or",
        "",
      ].join("\r\n"),
    );
    expect(upsertEnvValue("OPENROUTER_API_KEY=abc", "CLAUDE_CODE_OAUTH_TOKEN", "tok")).toBe(
      "OPENROUTER_API_KEY=abc\nCLAUDE_CODE_OAUTH_TOKEN=tok\n",
    );
    expect(upsertEnvValue("", "CLAUDE_CODE_OAUTH_TOKEN", "tok")).toBe("CLAUDE_CODE_OAUTH_TOKEN=tok\n");
  });

  it("creates and atomically updates .env with mode 0600 without losing neighbouring keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-setup-env-"));
    try {
      writeFileSync(join(dir, ".env.example"), "CLAUDE_CODE_OAUTH_TOKEN=\nOPENROUTER_API_KEY=\n", {
        mode: 0o644,
      });
      const created = ensureEnvFile(dir);
      expect(statSync(created).mode & 0o777).toBe(0o600);
      writeFileSync(created, "CLAUDE_CODE_OAUTH_TOKEN=\nOPENROUTER_API_KEY=keep-me\n", { mode: 0o644 });
      writeEnvFileAtomic(dir, "CLAUDE_CODE_OAUTH_TOKEN", "fake-saved");
      expect(statSync(created).mode & 0o777).toBe(0o600);
      expect(readFileSync(created, "utf8")).toBe(
        "CLAUDE_CODE_OAUTH_TOKEN=fake-saved\nOPENROUTER_API_KEY=keep-me\n",
      );
      expect(readdirSync(dir).filter((name) => name.startsWith(".env.tmp."))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tokenCommandRefusal and CLI guards", () => {
  it("refuses non-TTY and every agent environment marker", () => {
    expect(tokenCommandRefusal("tty", {})).toBeNull();
    expect(tokenCommandRefusal("non-tty", {})).toContain("interactive terminal");
    for (const marker of [
      "CLAUDECODE",
      "AGENT",
      "REPL_ID",
      "ANTIGRAVITY_AGENT",
      "CURSOR_AGENT",
      "CODEX_SANDBOX",
      "CODEX_THREAD_ID",
    ]) {
      expect(tokenCommandRefusal("tty", { [marker]: "1" })).toContain(marker);
    }
  });

  it("reads matching packageManager and engines.bun pins and rejects mismatched ones", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-setup-pin-"));
    try {
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ packageManager: "bun@1.4.5", engines: { bun: "1.4.5" } }),
      );
      expect(readBunPin(dir)).toBe("1.4.5");
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify({ packageManager: "bun@1.4.5", engines: { bun: "1.4.4" } }),
      );
      expect(readBunPin(dir)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints usage on --help, refuses --token and conflicting flags, and points missing runs usage tokens to setup --token", () => {
    const help = runSync([capturedExecPath, "tools/runtime/setup.ts", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(decodeOutput(help.stdout)).toContain("usage: bun run setup");

    const token = runSync([capturedExecPath, "tools/runtime/setup.ts", "--token"]);
    expect(token.exitCode).toBe(1);
    expect(decodeOutput(token.stderr)).toContain("refused");

    const both = runSync([capturedExecPath, "tools/runtime/setup.ts", "--apply", "--token"]);
    expect(both.exitCode).toBe(1);
    expect(decodeOutput(both.stderr)).toContain("not both");

    const cleanEnv = Object.fromEntries(
      Object.entries(runtimeProcess.env).filter(([key]) => !key.startsWith("CLAUDE_CODE_OAUTH_TOKEN")),
    );
    const usage = runSync([capturedExecPath, "tools/runs/cli.ts", "usage"], { env: cleanEnv });
    expect(usage.exitCode).toBe(1);
    expect(decodeOutput(usage.stderr)).toContain("bun run setup --token");
  });

  it("runs cleanly on a full fresh-clone copy with no node_modules, zero auto-install, and independent Codex detection", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-setup-fresh-"));
    const cache = mkdtempSync(join(tmpdir(), "ana-setup-cache-"));
    const codexHome = mkdtempSync(join(tmpdir(), "ana-setup-codex-"));
    try {
      const repo = resolve(import.meta.dir, "..");
      mkdirSync(join(dir, "tools", "runtime"), { recursive: true });
      mkdirSync(join(dir, "src", "agent"), { recursive: true });
      copyFileSync(join(repo, "tools", "runtime", "setup.ts"), join(dir, "tools", "runtime", "setup.ts"));
      copyFileSync(join(repo, "package.json"), join(dir, "package.json"));
      cpSync(join(repo, "src", "meta"), join(dir, "src", "meta"), { recursive: true });
      cpSync(join(repo, "src", "agent", "backends"), join(dir, "src", "agent", "backends"), {
        recursive: true,
      });
      const future = Math.floor(Date.now() / 1000) + 3600;
      const jwt = `h.${Buffer.from(JSON.stringify({ exp: future })).toString("base64url")}.s`;
      writeFileSync(
        join(codexHome, "auth.json"),
        JSON.stringify({ tokens: { access_token: jwt, refresh_token: "fake-refresh" } }),
      );
      const run = runSync([capturedExecPath, join(dir, "tools", "runtime", "setup.ts")], {
        cwd: dir,
        env: { ...runtimeProcess.env, BUN_INSTALL_CACHE_DIR: cache, CODEX_HOME: codexHome },
      });
      expect(run.exitCode).toBe(1);
      const output = decodeOutput(run.stdout);
      expect(output).toContain("Dependencies");
      expect(output).toContain("missing");
      expect(output).toContain("Codex login");
      expect(output).toContain("ready (ChatGPT login present)");
      expect(output).toContain("bun run setup --apply");
      expect(readdirSync(cache)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});
