import { type CodexAuthState, codexAuthStatus } from "../../src/agent/backends/codex-auth.ts";
import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from "../../src/meta/filesystem.ts";
import { gitMaybe } from "../../src/meta/git.ts";
import { capturedJsonParse } from "../../src/meta/json-runtime.ts";
import { asRecord, isString } from "../../src/meta/json-shape.ts";
import { join } from "../../src/meta/path.ts";
import { capturedExecPath, capturedSpawn, parseArgs, runtimeProcess } from "../../src/meta/process.ts";
import { runSync, zeroExitText } from "../../src/meta/subprocess.ts";
import { hasText } from "../../src/meta/text.ts";
import type { Env } from "../runs/logins.ts";

export type WallStatus =
  | "darwin"
  | "linux-ready"
  | "missing-bwrap"
  | "apparmor-restricted"
  | "unsupported"
  | "passed";
type HooksStatus = "enabled" | "unset";
type BinaryStatus = "ok" | "missing";

export interface SetupProbe {
  readonly bunVersion: string;
  readonly bunPin: string | null;
  readonly wall: WallStatus;
  readonly deps: BinaryStatus;
  readonly hooks: HooksStatus;
  readonly envFile: BinaryStatus;
  readonly claudeOAuth: readonly string[];
  readonly codexAuth: CodexAuthState;
  readonly anthropicApiKey: BinaryStatus;
  readonly openrouterApiKey: BinaryStatus;
  readonly rg: BinaryStatus;
  readonly python3: BinaryStatus;
}

interface SetupRow {
  readonly component: string;
  readonly state: "ok" | "optional" | "missing";
  readonly detail: string;
}

interface SetupReport {
  readonly ready: boolean;
  readonly rows: readonly SetupRow[];
  readonly actions: readonly string[];
}

interface InputStep {
  readonly buffer: string;
  readonly outcome: "continue" | "submit" | "cancel";
}

const REPO_ROOT = join(import.meta.dir, "../..");
const CLAUDE_TOKEN = "CLAUDE_CODE_OAUTH_TOKEN";
const NUMBERED_CLAUDE_TOKEN = /^CLAUDE_CODE_OAUTH_TOKEN(\d+)$/u;
const AGENT_ENV_MARKERS = [
  "CLAUDECODE",
  "AGENT",
  "REPL_ID",
  "ANTIGRAVITY_AGENT",
  "CURSOR_AGENT",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
] as const;
const OAUTH_PREFIX = "sk-ant-oat";
const WALL_DETAIL = {
  passed: "passed (test/walled-env.test.ts)",
  darwin: "macOS Seatbelt (run --apply to test)",
  "linux-ready": "Linux bubblewrap ready (run --apply to test)",
  "missing-bwrap": "missing bubblewrap (bwrap not on PATH)",
  "apparmor-restricted":
    "AppArmor blocks unprivileged userns (kernel.apparmor_restrict_unprivileged_userns=1)",
  unsupported: "unsupported OS (Anabasis requires macOS or Linux)",
} satisfies Record<WallStatus, string>;
const CODEX_DETAIL = {
  ready: "ready (ChatGPT login present)",
  expired: "present (access token expired; refreshes on use or run `codex login`)",
  missing: "absent (optional unless using openai-codex/<model>)",
  invalid: "unreadable (run `codex login` if using openai-codex/<model>)",
} satisfies Record<CodexAuthState, string>;
const USAGE_TEXT = [
  "usage: bun run setup [--apply | --token]",
  "  (default)  check local prerequisites and configured seat credentials without spending",
  "  --apply    install frozen dependencies, enable git hooks, create .env if absent, run wall test",
  "  --token",
  "             in your own interactive terminal: run claude setup-token, save to .env (0600), verify usage",
].join("\n");

export function readBunPin(root: string): string | null {
  try {
    const manifest = asRecord(capturedJsonParse(readFileSync(join(root, "package.json"), "utf8")));
    const manager = manifest?.packageManager;
    const engine = asRecord(manifest?.engines)?.bun;
    if (!isString(manager) || !isString(engine) || manager !== `bun@${engine}`) return null;
    return engine;
  } catch {
    return null;
  }
}

export function cleanPastedToken(raw: string): string {
  return Array.from(raw.replaceAll("\u001B[200~", "").replaceAll("\u001B[201~", ""))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 32 && code !== 127 && !/\s/u.test(ch);
    })
    .join("");
}

export function feedHiddenInput(buffer: string, chunk: string): InputStep {
  if (chunk.includes("\u0003") || chunk.includes("\u0004")) return { buffer, outcome: "cancel" };
  if (chunk === "\r" || chunk === "\n") return { buffer: cleanPastedToken(buffer), outcome: "submit" };
  const stripped = chunk.replaceAll("\u001B[200~", "").replaceAll("\u001B[201~", "");
  let next = buffer;
  for (const ch of stripped) {
    if (ch === "\u007F" || ch === "\b") next = next.slice(0, -1);
    else next += ch;
  }
  return { buffer: next, outcome: "continue" };
}

export function upsertEnvValue(existing: string, key: string, value: string): string {
  const eol = existing.includes("\r\n") ? "\r\n" : "\n";
  const escaped = key.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const pattern = new RegExp(String.raw`^\s*(?:export\s+)?${escaped}=`, "u");
  const lines = existing.split(/\r?\n/u);
  let replaced = false;
  const kept: string[] = [];
  for (const line of lines) {
    if (pattern.test(line)) {
      if (!replaced) {
        kept.push(`${key}=${value}`);
        replaced = true;
      }
    } else {
      kept.push(line);
    }
  }
  if (replaced) return kept.join(eol);
  const suffix = existing.length === 0 || existing.endsWith("\n") ? "" : eol;
  return `${existing}${suffix}${key}=${value}${eol}`;
}

export function tokenCommandRefusal(terminal: "tty" | "non-tty", env: Env): string | null {
  const marker = AGENT_ENV_MARKERS.find((name) => hasText(env[name]));
  if (marker !== undefined) {
    return `refused under ${marker}: run \`bun run setup --token\` in your own terminal so the token never enters a session transcript`;
  }
  if (terminal === "non-tty") {
    return "refused without an interactive terminal: run `bun run setup --token` directly in your own terminal";
  }
  return null;
}

export function assessSetup(probe: SetupProbe): SetupReport {
  const bunOk = probe.bunPin !== null && probe.bunVersion === probe.bunPin;
  const wallOk = probe.wall === "darwin" || probe.wall === "linux-ready" || probe.wall === "passed";
  const depsOk = probe.deps === "ok";
  const hasClaude = probe.claudeOAuth.length > 0;
  const hasCodex = probe.codexAuth === "ready" || probe.codexAuth === "expired";
  const hasAnyCredential =
    hasClaude || hasCodex || probe.anthropicApiKey === "ok" || probe.openrouterApiKey === "ok";

  const rows: SetupRow[] = [
    {
      component: "Bun",
      state: bunOk ? "ok" : "missing",
      detail:
        probe.bunPin === null
          ? `${probe.bunVersion} (package.json pin unreadable)`
          : bunOk
            ? `${probe.bunVersion} (matches pin)`
            : `${probe.bunVersion} (pin is ${probe.bunPin})`,
    },
    {
      component: "OS wall",
      state: wallOk ? "ok" : "missing",
      detail: WALL_DETAIL[probe.wall],
    },
    {
      component: "Dependencies",
      state: depsOk ? "ok" : "missing",
      detail: depsOk ? "installed (bundled Claude Code binary present)" : "missing or incomplete",
    },
    {
      component: "Git hooks",
      state: probe.hooks === "enabled" ? "ok" : "optional",
      detail: probe.hooks === "enabled" ? ".githooks" : "unset (run `bun run hooks:install` to contribute)",
    },
    {
      component: "Env file",
      state: probe.envFile === "ok" ? "ok" : "optional",
      detail: probe.envFile === "ok" ? ".env present" : ".env absent (created by --apply)",
    },
    {
      component: "Claude OAuth",
      state: hasClaude ? "ok" : hasAnyCredential ? "optional" : "missing",
      detail: hasClaude
        ? `set (${probe.claudeOAuth.join(", ")}); verify with \`bun run runs usage\``
        : "unset (run `bun run setup --token` in your terminal)",
    },
    {
      component: "Codex login",
      state: hasCodex ? "ok" : "optional",
      detail: CODEX_DETAIL[probe.codexAuth],
    },
    {
      component: "API keys",
      state: probe.anthropicApiKey === "ok" || probe.openrouterApiKey === "ok" ? "ok" : "optional",
      detail: apiKeysDetail(probe.anthropicApiKey, probe.openrouterApiKey),
    },
    {
      component: "Tools",
      state: probe.rg === "ok" && probe.python3 === "ok" ? "ok" : "optional",
      detail: `rg: ${probe.rg}, python3: ${probe.python3}`,
    },
  ];

  const actions: string[] = [];
  if (!bunOk && probe.bunPin !== null) {
    actions.push(`Install pinned Bun: curl -fsSL https://bun.com/install | bash -s "bun-v${probe.bunPin}"`);
  }
  if (probe.wall === "missing-bwrap") {
    actions.push("Install bubblewrap: sudo apt-get install -y bubblewrap");
  }
  if (probe.wall === "apparmor-restricted") {
    actions.push("Allow unprivileged userns: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
  }
  if (!depsOk || probe.hooks === "unset" || probe.envFile === "missing") {
    actions.push("Apply local setup and test OS wall: bun run setup --apply");
  }
  if (!hasAnyCredential) {
    actions.push("Configure a Claude login in your terminal: bun run setup --token");
  }

  return { ready: bunOk && wallOk && depsOk && hasAnyCredential, rows, actions };
}

export function formatReport(report: SetupReport): string {
  const width = Math.max(...report.rows.map((row) => row.component.length));
  const lines = report.rows.map(
    (row) => `${row.component.padEnd(width)}  ${row.state.padEnd(8)}  ${row.detail}`,
  );
  if (report.actions.length === 0) {
    lines.push(
      "",
      'Ready. Follow README.md ("Run it") to start a --dry-run campaign in a dedicated worktree.',
    );
  } else {
    const heading = report.ready ? "Ready (recommended next):" : "Next:";
    lines.push("", heading, ...report.actions.map((action) => `  - ${action}`));
  }
  return lines.join("\n");
}

export function ensureEnvFile(root: string): string {
  const target = join(root, ".env");
  if (!existsSync(target)) {
    writeFileSync(target, readFileSync(join(root, ".env.example"), "utf8"), { mode: 0o600, flag: "wx" });
    chmodSync(target, 0o600);
  }
  return target;
}

export function writeEnvFileAtomic(root: string, key: string, value: string): string {
  const target = ensureEnvFile(root);
  const updated = upsertEnvValue(readFileSync(target, "utf8"), key, value);
  const temp = join(root, `.env.tmp.${String(runtimeProcess.pid)}`);
  writeFileSync(temp, updated, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, target);
  return target;
}

function apiKeysDetail(anthropic: BinaryStatus, openrouter: BinaryStatus): string {
  const set = [
    ...(anthropic === "ok" ? ["ANTHROPIC_API_KEY"] : []),
    ...(openrouter === "ok" ? ["OPENROUTER_API_KEY"] : []),
  ];
  return set.length > 0 ? `set (${set.join(", ")})` : "unset (ANTHROPIC_API_KEY, OPENROUTER_API_KEY)";
}

function probeWall(platform: string, wallCheck: "untested" | "passed"): WallStatus {
  if (wallCheck === "passed") return "passed";
  if (platform === "darwin") return "darwin";
  if (platform !== "linux") return "unsupported";
  if (Bun.which("bwrap") === null) return "missing-bwrap";
  const apparmor = zeroExitText(runSync(["sysctl", "-n", "kernel.apparmor_restrict_unprivileged_userns"]));
  return apparmor === "1" ? "apparmor-restricted" : "linux-ready";
}

function claudeKeysIn(env: Env): string[] {
  const numbered = Object.entries(env)
    .flatMap(([key, value]) => (hasText(value) && NUMBERED_CLAUDE_TOKEN.test(key) ? [key] : []))
    .toSorted();
  return hasText(env[CLAUDE_TOKEN]) ? [CLAUDE_TOKEN, ...numbered] : numbered;
}

async function probeDeps(root: string): Promise<BinaryStatus> {
  if (!existsSync(join(root, "node_modules"))) return "missing";
  try {
    const { claudeExecutable } = await import("../../src/agent/backends/claude.ts");
    claudeExecutable();
    return "ok";
  } catch {
    return "missing";
  }
}

async function probeLocal(root: string, wallCheck: "untested" | "passed"): Promise<SetupProbe> {
  const env = runtimeProcess.env;
  return {
    bunVersion: Bun.version,
    bunPin: readBunPin(root),
    wall: probeWall(runtimeProcess.platform, wallCheck),
    deps: await probeDeps(root),
    hooks: gitMaybe(root, "config", "core.hooksPath") === ".githooks" ? "enabled" : "unset",
    envFile: existsSync(join(root, ".env")) ? "ok" : "missing",
    claudeOAuth: claudeKeysIn(env),
    codexAuth: codexAuthStatus(),
    anthropicApiKey: hasText(env.ANTHROPIC_API_KEY) ? "ok" : "missing",
    openrouterApiKey: hasText(env.OPENROUTER_API_KEY) ? "ok" : "missing",
    rg: Bun.which("rg") === null ? "missing" : "ok",
    python3: Bun.which("python3") === null ? "missing" : "ok",
  };
}

async function runStep(cmd: readonly string[], root: string, env: Env = runtimeProcess.env): Promise<number> {
  return await capturedSpawn([...cmd], {
    cwd: root,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).exited;
}

async function applyLocal(root: string): Promise<number> {
  const pin = readBunPin(root);
  if (pin === null) {
    console.error("package.json has no matching packageManager/engines.bun pin.");
    return 1;
  }
  if (Bun.version !== pin) {
    console.error(
      `Bun ${Bun.version} does not match pinned ${pin}. Install it first:\n  curl -fsSL https://bun.com/install | bash -s "bun-v${pin}"`,
    );
    return 1;
  }
  ensureEnvFile(root);
  const steps: readonly (readonly [string, readonly string[], Env | undefined])[] = [
    ["install frozen dependencies", [capturedExecPath, "install", "--frozen-lockfile"], undefined],
    ["enable git hooks", [capturedExecPath, "run", "hooks:install"], undefined],
    [
      "run local OS wall test",
      [capturedExecPath, "run", "test", "--", "test/walled-env.test.ts"],
      { ...runtimeProcess.env, ANA_CHECK_HOST: "here" },
    ],
  ];
  for (const [label, cmd, env] of steps) {
    console.log(`==> ${label}`);
    const code = await runStep(cmd, root, env);
    if (code !== 0) return code;
  }
  const report = assessSetup(await probeLocal(root, "passed"));
  console.log(`\n${formatReport(report)}`);
  return 0;
}

async function readHiddenToken(): Promise<string | null> {
  const { stdin, stdout } = runtimeProcess;
  stdout.write("Paste the token (input hidden, then press Enter): ");
  stdin.setRawMode(true);
  stdin.resume();
  try {
    return await new Promise<string | null>((resolve) => {
      let buffer = "";
      const finish = (value: string | null) => {
        stdin.off("data", onData);
        resolve(value);
      };
      const onData = (chunk: Buffer) => {
        const step = feedHiddenInput(buffer, chunk.toString("utf8"));
        buffer = step.buffer;
        if (step.outcome === "cancel") finish(null);
        else if (step.outcome === "submit") finish(step.buffer);
      };
      stdin.on("data", onData);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write("\n");
  }
}

async function configureToken(root: string): Promise<number> {
  const refused = tokenCommandRefusal(runtimeProcess.stdin.isTTY ? "tty" : "non-tty", runtimeProcess.env);
  if (refused !== null) {
    console.error(refused);
    return 1;
  }
  const binary =
    Bun.which("claude") ??
    (existsSync(join(root, "node_modules"))
      ? (await import("../../src/agent/backends/claude.ts")).claudeExecutable()
      : null);
  if (binary === null) {
    console.error(
      "Neither `claude` nor installed dependencies were found; run `bun run setup --apply` first.",
    );
    return 1;
  }
  console.log("Running `claude setup-token` to open browser authentication...");
  const authCode = await runStep([binary, "setup-token"], root);
  if (authCode !== 0) return authCode;
  const token = await readHiddenToken();
  if (token === null || token === "") {
    console.error("No token saved; .env was not modified.");
    return 1;
  }
  if (!token.startsWith(OAUTH_PREFIX)) {
    console.error(`Expected a token starting with ${OAUTH_PREFIX}; .env was not modified.`);
    return 1;
  }
  writeEnvFileAtomic(root, CLAUDE_TOKEN, token);
  console.log(`Saved ${CLAUDE_TOKEN} to .env (mode 0600). Checking with \`bun run runs usage\`...`);
  const { [CLAUDE_TOKEN]: _stale, ...freshEnv } = runtimeProcess.env;
  return await runStep([capturedExecPath, "run", "runs", "usage"], root, freshEnv);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      apply: { type: "boolean", default: false },
      token: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE_TEXT);
    return 0;
  }
  if (values.apply && values.token) {
    console.error("pass either --apply or --token, not both");
    return 1;
  }
  if (values.token) return await configureToken(REPO_ROOT);
  if (values.apply) return await applyLocal(REPO_ROOT);
  const report = assessSetup(await probeLocal(REPO_ROOT, "untested"));
  console.log(formatReport(report));
  return report.ready ? 0 : 1;
}

if (import.meta.main) {
  runtimeProcess.exitCode = await main();
}
