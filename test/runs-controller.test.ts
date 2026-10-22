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
  expect(launch.err).toContain("commit is on no remote branch");
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

it("reclaims a dead or expired preparation lock but preserves a recent live holder", () => {
  for (const kind of ["dead", "expired", "live"]) {
    const made = fixture();
    const lock = join(made.root, "git", "ana-code", `${made.commit}.lock`);
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "pid"), kind === "dead" ? "99999999" : String(process.pid));
    if (kind === "expired") utimesSync(lock, new Date(0), new Date(0));
    const result = made.run(PREPARE, { FAKE_EXECUTE: "1" });
    expect(result.code).toBe(kind === "live" ? 1 : 0);
    expect(existsSync(lock)).toBe(kind === "live");
  }
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
