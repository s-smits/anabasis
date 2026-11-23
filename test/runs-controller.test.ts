// Controller lifecycle through fake host executables, with no network or operator checkout.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";
import { present } from "./helpers/matchers.ts";

const fixtures: string[] = [];
const PREPARE =
  'import { preparedHost } from "REPOSITORY/tools/runs/code.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; console.log(await preparedHost(hostsOf()[0]!, process.env.FAKE_COMMIT!));';

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const made = fakeHosts();
  fixtures.push(made.root);
  return made;
}

describe("remote controller lifecycle", () => {
  it("reclaims a preparation lock whose holder is gone, and waits for a live holder however old its lock", () => {
    for (const kind of ["dead", "unnamed", "live", "live past the window"]) {
      const made = fixture();
      const lock = join(made.root, "git", "ana-code", `${made.commit}.lock`);
      mkdirSync(lock, { recursive: true });
      // The holder is orphaned at once, so its exit is reaped while this process waits on the run.
      // It touches `released` as it ends, so a run that waited for it finds the file, where a
      // bound of seconds on the other two kinds can be overrun on a loaded host.
      const released = join(made.root, "released");
      const live = kind.startsWith("live");
      const holder = live
        ? Bun.spawnSync(["sh", "-c", '(sleep 2; touch "$0") >/dev/null 2>&1 & echo $!', released])
            .stdout.toString()
            .trim()
        : "99999999";
      // A lock that names no holder, left by a shell killed before it wrote one, lapses by its age.
      if (kind !== "unnamed") writeFileSync(join(lock, "pid"), holder);
      if (kind !== "live" && kind !== "dead") utimesSync(lock, new Date(0), new Date(0));
      const result = made.run(PREPARE, { FAKE_EXECUTE: "1" });
      expect(result.code).toBe(0);
      expect(existsSync(lock)).toBe(false);
      expect(existsSync(released)).toBe(live);
    }
  });
});

describe("controller pruning and cursor storage", () => {
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
    expect(existsSync(present(trees[4]))).toBe(false);
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

  it("caches verified read controllers in-process and retries immediately after failure", () => {
    const made = fixture();
    const cached = made.run(
      'import { readControllers } from "REPOSITORY/tools/runs/code.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; const hosts = hostsOf(); const first = await readControllers(hosts); const second = await readControllers(hosts); console.log(JSON.stringify([first[0]?.tree, second[0]?.tree]));',
    );
    expect(cached.code).toBe(0);
    expect(JSON.parse(cached.out)).toEqual([made.env.FAKE_PREPARED, made.env.FAKE_PREPARED]);
    expect(made.recorded().filter((call) => call.tool === "ssh")).toHaveLength(1);

    const recovered = fixture();
    const retried = recovered.run(
      'import { rmSync, writeFileSync } from "node:fs"; import { readControllers } from "REPOSITORY/tools/runs/code.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; const hosts = hostsOf(); const flag = `${process.env.FAKE_NOW}/FAKE_OFFLINE`; writeFileSync(flag, "1"); const missed = await readControllers(hosts); rmSync(flag); const ready = await readControllers(hosts); console.log(JSON.stringify([missed[0], ready[0]?.tree]));',
    );
    expect(retried.code).toBe(0);
    expect(JSON.parse(retried.out)).toEqual([null, recovered.env.FAKE_PREPARED]);
    expect(recovered.recorded().filter((call) => call.tool === "ssh")).toHaveLength(2);
  });
});
