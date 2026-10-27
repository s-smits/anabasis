// Controller lifecycle through fake host executables, with no network or operator checkout.
import { afterAll, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const fixtures: string[] = [];
const PREPARE =
  'import { preparedHost } from "REPOSITORY/tools/runs/code.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; console.log(preparedHost(hostsOf()[0]!, process.env.FAKE_COMMIT!));';
const ASK =
  'import { asked } from "REPOSITORY/tools/runs/hosts.ts"; console.log(await asked(["active", "--here"]));';

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const made = fakeHosts();
  fixtures.push(made.root);
  return made;
}

it("reads at the published ancestor and warns only once for an unpublished HEAD", () => {
  const made = fixture();
  const ancestor = "b".repeat(40);
  const read = made.run(`${ASK} console.log(await asked(["catalogue"]));`, {
    FAKE_EXECUTE: "1",
    FAKE_ANCESTOR: ancestor,
    FAKE_REMOTE_COMMIT: ancestor,
  });
  expect(read.code).toBe(0);
  expect(read.err.match(/remote reads use published ancestor/g)).toHaveLength(1);
  expect(
    made
      .recorded()
      .find((call) => call.tool === "ssh")
      ?.args.at(-1),
  ).toContain(ancestor);
  const merge = made.recorded().find((call) => call.args.includes("merge-base"));
  expect(merge?.args.slice(-2)).toEqual([made.commit, ancestor]);
  const launch = made.run(PREPARE, { FAKE_EXECUTE: "1", FAKE_UNPUBLISHED: "1" });
  expect(launch.code).toBe(1);
  expect(launch.err).toContain("commit is on no remote branch or tag");
  // A commit that a pushed tag names, a campaign's run tag, is published.
  expect(made.run(PREPARE, { FAKE_EXECUTE: "1", FAKE_UNPUBLISHED: "1", FAKE_TAGGED: "1" }).code).toBe(0);
  const missing = fixture();
  expect(missing.run(ASK, { FAKE_ANCESTOR: "" }).code).toBe(1);
  expect(missing.recorded().some((call) => call.tool === "ssh")).toBe(false);
});

it("finishes a cold install longer than the request deadline before asking the host", () => {
  const made = fixture();
  const result = made.run(ASK, { FAKE_EXECUTE: "1", FAKE_INSTALL_DELAY: "31000" });
  expect(result.code).toBe(0);
  expect(result.out).not.toContain("null");
  const calls = made.recorded();
  const install = calls.findIndex((call) => call.tool === "host-bun" && call.args.includes("install"));
  const request = calls.findIndex((call) => call.tool === "host-bun" && call.args.includes("active"));
  expect(install).toBeGreaterThan(-1);
  expect(request).toBeGreaterThan(install);
});

it("reclaims a dead or expired preparation lock and waits for a live holder to end", () => {
  for (const kind of ["dead", "expired", "live"]) {
    const made = fixture();
    const lock = join(made.root, "git", "ana-code", `${made.commit}.lock`);
    mkdirSync(lock, { recursive: true });
    // The holder is orphaned at once, so its exit is reaped while this process waits on the run.
    const holder = Bun.spawnSync(["sh", "-c", "sleep 4 >/dev/null 2>&1 & echo $!"]).stdout.toString().trim();
    writeFileSync(join(lock, "pid"), kind === "dead" ? "99999999" : holder);
    if (kind === "expired") utimesSync(lock, new Date(0), new Date(0));
    const started = performance.now();
    const result = made.run(PREPARE, { FAKE_EXECUTE: "1" });
    expect(result.code).toBe(0);
    expect(existsSync(lock)).toBe(false);
    expect(performance.now() - started > 3000).toBe(kind === "live");
  }
});

it("prepares each host once for concurrent asks in one process", () => {
  const made = fixture();
  const both =
    'import { asked } from "REPOSITORY/tools/runs/hosts.ts"; await Promise.all([asked(["catalogue"]), asked(["catalogue"])]);';
  expect(made.run(both, { FAKE_EXECUTE: "1" }).code).toBe(0);
  const scripts = made
    .recorded()
    .filter((call) => call.tool === "ssh")
    .map((call) => call.args.at(-1) ?? "");
  expect(scripts.filter((script) => script.includes("git fetch"))).toHaveLength(1);
});

it("retries a controller after connectivity returns in the same process", () => {
  const made = fixture();
  const retry = String.raw`import { asked } from "REPOSITORY/tools/runs/hosts.ts"; import { readFileSync, writeFileSync } from "REPOSITORY/src/meta/filesystem.ts"; const ssh = process.env.FAKE_SSH!; const online = readFileSync(ssh, "utf8"); writeFileSync(ssh, "#!/bin/sh\nexit 255\n"); console.log(JSON.stringify((await asked(["catalogue"]))[0]?.lines)); writeFileSync(ssh, online); console.log(JSON.stringify((await asked(["catalogue"]))[0]?.lines));`;
  const result = made.run(retry, { FAKE_SSH: join(made.root, "bin", "ssh") });
  expect(result.code).toBe(0);
  const [failed, recovered] = result.out
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(failed).toBeNull();
  expect(recovered).toEqual(["[]"]);
});

it("prepares a controller again after its tree is pruned between asks", () => {
  const made = fixture();
  const retry =
    'import { asked } from "REPOSITORY/tools/runs/hosts.ts"; import { rmSync } from "REPOSITORY/src/meta/filesystem.ts"; console.log(JSON.stringify((await asked(["catalogue"]))[0]?.lines)); const tree = process.env.FAKE_GIT! + "/ana-code/" + process.env.FAKE_COMMIT!; rmSync(tree, {recursive: true}); rmSync(tree + ".ready"); console.log(JSON.stringify((await asked(["catalogue"]))[0]?.lines));';
  const result = made.run(retry, { FAKE_EXECUTE: "1" });
  expect(result.code).toBe(0);
  expect(result.out.trim().split("\n")).toEqual(["[]", "[]"]);
  expect(
    made.recorded().filter((call) => call.tool === "host-bun" && call.args.includes("install")),
  ).toHaveLength(2);
});

it("prunes old controllers by readiness time and preserves active paths and working directories", () => {
  const made = fixture();
  const root = join(made.root, "git", "ana-code");
  const trees = ["b", "c", "d", "e", "f"].map((letter, index) => {
    const tree = join(root, letter.repeat(40));
    mkdirSync(join(tree, "node_modules"), { recursive: true });
    writeFileSync(`${tree}.ready`, "");
    utimesSync(`${tree}.ready`, 100 - index, 100 - index);
    return tree;
  });
  const result = made.run(PREPARE, {
    FAKE_EXECUTE: "1",
    FAKE_PS: `bun ${trees[2]}/tools/runs/cli.ts keep`,
    FAKE_CWDS: `n${trees[3]}`,
  });
  expect(result.code).toBe(0);
  for (const tree of trees.slice(0, 4)) expect(existsSync(tree)).toBe(true);
  expect(existsSync(trees[4]!)).toBe(false);
  expect(existsSync(`${trees[4]}.ready`)).toBe(false);
  expect(
    made
      .recorded()
      .filter((call) => call.tool === "git" && call.args.includes("remove"))
      .map((call) => call.args.at(-1)),
  ).toEqual([trees[4]]);
});

it("prunes an old controller behind a dead holder's lock and keeps one a live holder has", () => {
  const made = fixture();
  const root = join(made.root, "git", "ana-code");
  const trees = ["b", "c", "d", "e", "f"].map((letter, index) => {
    const tree = join(root, letter.repeat(40));
    mkdirSync(join(tree, "node_modules"), { recursive: true });
    writeFileSync(`${tree}.ready`, "");
    utimesSync(`${tree}.ready`, 100 - index, 100 - index);
    return tree;
  });
  for (const [tree, holder] of [
    [trees[3]!, String(process.pid)],
    [trees[4]!, "99999999"],
  ] as const) {
    mkdirSync(`${tree}.lock`);
    writeFileSync(join(`${tree}.lock`, "pid"), holder);
  }
  expect(
    made.run(PREPARE, { FAKE_EXECUTE: "1", FAKE_PS: `bun ${trees[2]}/tools/runs/cli.ts keep` }).code,
  ).toBe(0);
  expect([trees[3], `${trees[3]}.lock`].map((path) => existsSync(path!))).toEqual([true, true]);
  expect([trees[4], `${trees[4]}.lock`].map((path) => existsSync(path!))).toEqual([false, false]);
});

it("preserves old controllers when process inspection fails", () => {
  const made = fixture();
  const root = join(made.root, "git", "ana-code");
  for (const letter of ["b", "c", "d", "e"]) {
    const tree = join(root, letter.repeat(40));
    mkdirSync(tree, { recursive: true });
    writeFileSync(`${tree}.ready`, "");
  }
  expect(made.run(PREPARE, { FAKE_EXECUTE: "1", FAKE_PS_FAIL: "1" }).code).toBe(0);
  expect(made.recorded().some((call) => call.args.includes("remove"))).toBe(false);
});

it("keeps a remote pulse cursor when the controller commit changes", () => {
  const made = fixture();
  const folder = join(made.main, ".ana", "d2", "distant");
  mkdirSync(folder, { recursive: true });
  const log = join(folder, "log.jsonl");
  append(log, "campaign.ended", { ending: "finished", why: "fixture" });
  const read =
    'import { watch } from "REPOSITORY/tools/runs/pulse.ts"; process.chdir(process.env.FAKE_CONTROLLER!); await watch(["distant", "--once", "--here", "--state", ".ana/pulse/observer.json"]);';
  for (const commit of [made.commit, "b".repeat(40)]) {
    const controller = join(made.root, "git", "ana-code", commit);
    mkdirSync(controller, { recursive: true });
    expect(made.run(read, { FAKE_CONTROLLER: controller, FAKE_COMMIT: commit }).code).toBe(0);
    expect(existsSync(join(controller, ".ana", "pulse", "observer.json"))).toBe(false);
  }
  expect(
    JSON.parse(readFileSync(join(made.main, ".ana", "pulse", "observer.json"), "utf8")).logs[log].lines,
  ).toBe(1);
});
