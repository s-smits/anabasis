// Command fakes for the host boundary. They run only under a temporary fixture's PATH and never
// contact ssh, rsync, a provider or a real repository. Each call leaves its arguments as evidence.
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "../../src/meta/filesystem.ts";
import { parseJsonAs } from "../../src/meta/json-runtime.ts";
import { tmpdir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { capturedExecPath } from "../../src/meta/process.ts";
import { decodeOutput, runSync } from "../../src/meta/subprocess.ts";

const COMMIT = "a".repeat(40);
const REPO = join(import.meta.dir, "../..");

const RECORD = `import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_CALLS, JSON.stringify({tool: process.argv[1].split("/").at(-1), args}) + "\\n");`;

const SCRIPTS = {
  "ssh": `${RECORD}
const script = args.at(-1);
const peer = JSON.parse(process.env.FAKE_FLEET ?? "{}")[args.at(-2)] ?? {};
if (process.env.FAKE_OFFLINE === "1" || peer.offline) process.exit(255);
if (peer.timeout && script.includes("ANA_HOP")) await Bun.sleep(35000);
if (peer.freshExit && script.includes("ANA_HOP") && script.includes("fresh")) process.exit(peer.freshExit);
if (process.env.FAKE_EXECUTE === "1" || peer.execute || (process.env.FAKE_PREPARE_EXECUTE === "1" && !script.includes("ANA_HOP"))) {
  const env = {...process.env, ...(peer.env ?? {})};
  const child = Bun.spawn(["sh", "-c", script], {env, stdin:"ignore", stdout:"inherit", stderr:"inherit"});
  process.exit(await child.exited);
}
if (script.includes("--health")) console.log(JSON.stringify(peer.health ?? JSON.parse(process.env.FAKE_HEALTH ?? "null")));
else if (script.includes("catalogue")) console.log(JSON.stringify((peer.catalogue ?? JSON.parse(process.env.FAKE_CATALOGUE ?? "[]")).map((run) => ({open:false,stderr:null,...run}))));
else if (script.includes("active")) console.log(script.includes("--login") ? peer.loginPresent ?? process.env.FAKE_LOGIN_PRESENT ?? "true" : JSON.stringify(peer.active ?? JSON.parse(process.env.FAKE_ACTIVE ?? "[]")));
else if (script.includes("pulse")) console.log(peer.pulse ?? "◆ reported step");
else if (script.includes("holds")) console.log((peer.holds ?? [process.env.FAKE_HOLDS ?? ""]).join("\\n"));
else if (script.includes("status") && script.includes("ANA_HOP")) console.log(peer.status ?? "no local runs");
else console.log(process.env.FAKE_PREPARED);`,
  "rsync": `${RECORD}
import { cpSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
const source = args.at(-2);
const remote = source.includes(":");
const quoted = remote ? source.split(":").slice(1).join(":").slice(0,-1) : "";
const from = remote ? quoted.slice(1,-1).replaceAll("'\\\\''", "'") : source;
const target = args.at(-1);
const into = target.includes(":") ? target.split(":").slice(1).join(":").replace(/\\/$/, "").slice(1,-1) + "/" : target;
if (process.env.FAKE_TRANSFER_FAIL === "1") { writeFileSync(into + "log.jsonl", "partial"); process.exit(23); }
const kept = args.filter((arg) => arg.startsWith("--include=/")).map((arg) => new RegExp("^" + arg.slice(11).replaceAll(".", "[.]").replaceAll("*", ".*") + "$"));
cpSync(from, into, {recursive: true, verbatimSymlinks: true, filter: (file) => !args.includes("--exclude=/*") || resolve(file) === resolve(from) || (dirname(file) === resolve(from) && kept.some((name) => name.test(basename(file))))});`,
  "git": `${RECORD}
import { mkdirSync, rmSync } from "node:fs";
if (args.includes("fetch")) process.exit(process.env.FAKE_FETCH_FAIL === "1" ? 1 : 0);
if (args.includes("merge-base") || args.includes("for-each-ref")) console.log(process.env.FAKE_ANCESTOR ?? process.env.FAKE_COMMIT);
else if (args.includes("rev-parse")) console.log(args.includes("--git-common-dir") ? process.env.FAKE_GIT : args.includes("--show-toplevel") ? process.env.FAKE_MAIN : args.includes("-C") ? process.env.FAKE_COMMIT : process.env.FAKE_REMOTE_COMMIT ?? process.env.FAKE_COMMIT);
else if (args.includes("status")) console.log(process.env.FAKE_DIRTY ?? "");
else if (args.includes("branch")) console.log(process.env.FAKE_UNPUBLISHED === "1" ? "" : "origin/main");
else if (args.includes("ls-remote")) console.log(process.env.FAKE_TAGGED === "1" ? process.env.FAKE_COMMIT + "\\trefs/tags/run/r/1" : "");
else if (args.includes("worktree") && args.includes("list")) console.log("worktree " + process.env.FAKE_MAIN);
else if (args.includes("worktree") && args.includes("add")) mkdirSync(args.at(-2), {recursive: true});
else if (args.includes("worktree") && args.includes("remove")) rmSync(args.at(-1), {recursive: true, force: true});`,
  "ps": `${RECORD}\nif (process.env.FAKE_PS_FAIL === "1") process.exit(1); console.log(JSON.parse(process.env.FAKE_PS_TABLE ?? "{}")[args.join(" ")] ?? process.env.FAKE_PS ?? "");`,
  "lsof": `${RECORD}\nconsole.log(process.env.FAKE_CWDS ?? "");`,
  "host-bun": `${RECORD}
import { mkdirSync } from "node:fs";
if (args.includes("install")) {
  if (process.env.FAKE_INSTALL_DELAY) await Bun.sleep(Number(process.env.FAKE_INSTALL_DELAY));
  mkdirSync("node_modules", {recursive: true});
}
else if (args.includes("-e")) {
  const child = Bun.spawn([process.execPath, ...args], {env:process.env,stdin:"ignore",stdout:"inherit",stderr:"inherit"});
  process.exit(await child.exited);
}
else if (process.env.ANA_HOP !== "1") process.exit(5);
else if (process.env.FAKE_RUN_CLI === "1") {
  const start = args.findIndex((arg) => arg.startsWith("tools/") || arg.startsWith(".claude/"));
  const child = Bun.spawn([process.execPath, process.env.FAKE_REPO + "/" + args[start], ...args.slice(start+1)], {env:process.env,stdin:"ignore",stdout:"inherit",stderr:"inherit"});
  process.exit(await child.exited);
}
process.exit(process.env.FAKE_INSTALL_FAIL === "1" && args.includes("install") ? 1 : 0);`,
};

export function fakeHosts() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-fake-hosts-")));
  const bin = join(root, "bin");
  const main = join(root, "main");
  const calls = join(root, "calls.jsonl");
  mkdirSync(bin);
  mkdirSync(main);
  mkdirSync(join(root, "git"));
  const executable = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!${capturedExecPath}\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  };
  for (const [name, body] of Object.entries(SCRIPTS)) executable(name, body);
  const hostBun = join(bin, "host-bun");
  const shell = join(bin, "host-shell");
  writeFileSync(shell, '#!/bin/sh\nshift\nexec /bin/sh -c "$1"\n');
  chmodSync(shell, 0o755);
  const host = { name: "runner", ssh: "fake-runner", tree: main, bun: hostBun, capacity: 2 };
  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    SHELL: shell,
    ANA_HOSTS: JSON.stringify([host]),
    FAKE_CALLS: calls,
    FAKE_REPO: REPO,
    FAKE_MAIN: main,
    FAKE_GIT: join(root, "git"),
    FAKE_COMMIT: COMMIT,
    FAKE_PREPARED: join(root, "prepared"),
  };
  const run = (code: string, extra: Record<string, string> = {}) => {
    const driver = join(root, "driver.ts");
    writeFileSync(driver, code.replaceAll("REPOSITORY/", `${REPO}/`));
    const result = runSync([capturedExecPath, driver], { cwd: main, env: { ...env, ...extra } });
    return { code: result.exitCode, out: decodeOutput(result.stdout), err: decodeOutput(result.stderr) };
  };
  const runScript = (script: string, args: readonly string[], extra: Record<string, string> = {}) => {
    const result = runSync([capturedExecPath, join(REPO, script), ...args], {
      cwd: main,
      env: { ...env, ...extra },
    });
    return { code: result.exitCode, out: decodeOutput(result.stdout), err: decodeOutput(result.stderr) };
  };
  const recorded = (): { tool: string; args: string[] }[] => {
    try {
      return readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => parseJsonAs<{ tool: string; args: string[] }>(line));
    } catch {
      return [];
    }
  };
  return { root, main, host, env, run, runScript, recorded, commit: COMMIT };
}
