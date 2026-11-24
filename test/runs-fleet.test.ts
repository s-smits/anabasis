// The fleet boundary through executable command fakes, with a hostile case beside each behaviour.
import { afterAll, describe, expect, it } from "bun:test";
import { append, LOG_FILE } from "../src/kernel/log.ts";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { held } from "../src/meta/holder.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";

import { fakeHosts } from "./helpers/fake-hosts.ts";

const fixtures: string[] = [];
const prepare =
  'import { preparedHost } from "REPOSITORY/tools/runs/code.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; console.log(await preparedHost(hostsOf()[0]!, process.env.FAKE_COMMIT!));';
const sync =
  'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; console.log(await syncRuns(["distant"], {match:"exact"}));';

afterAll(() => {
  for (const root of fixtures) rmSync(root, { recursive: true, force: true });
});
const fixture = () => {
  const made = fakeHosts();
  fixtures.push(made.root);
  return made;
};
/** A remote campaign fixture, its events written by the log's owner. */
function campaign() {
  const made = fixture();
  const folder = join(made.root, "remote", "distant");
  mkdirSync(folder, { recursive: true });
  const log = join(folder, LOG_FILE);
  append(log, "campaign.ended", { ending: "finished", why: "fixture" });
  writeFileSync(
    join(folder, "launch-run-1.json"),
    JSON.stringify({
      at: new Date().toISOString(),
      pid: 42,
      flags: [],
      envFile: null,
      commit: made.commit,
      dirty: false,
      load: 0,
      cores: 2,
    }),
  );
  return { made, log, env: { FAKE_CATALOGUE: JSON.stringify([{ name: "distant", path: log }]) } };
}

describe.concurrent("host execution", () => {
  it("keeps paths and arguments literal and clears the peer list for any repository script", async () => {
    const made = fixture();
    const result = await made.runAsync(
      'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; process.exit(await scriptOn(hostsOf()[0]!, ".claude/skills/example/scripts/cycle.ts", ["--here", "a; $(touch forbidden)", "quote\u0027s"]));',
      { FAKE_EXECUTE: "1" },
    );
    expect(result.code).toBe(0);
    const command =
      made
        .recorded()
        .findLast((call) => call.tool === "ssh")
        ?.args.at(-1) ?? "";
    expect(command).toContain("ANA_HOP=1");
    expect(command).not.toContain("ANA_HOSTS");
    expect(command).toContain("example/scripts/cycle.ts");
    expect(command).toContain("touch forbidden");
    expect(existsSync(join(made.main, "forbidden"))).toBe(false);
    expect(
      made
        .recorded()
        .findLast((call) => call.tool === "host-bun")
        ?.args.slice(-3),
    ).toEqual(["--here", "a; $(touch forbidden)", "quote's"]);
    expect(
      (
        await made.runAsync(
          'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/example.ts", []);',
          { FAKE_EXECUTE: "1" },
        )
      ).code,
    ).toBe(0);
    expect(made.recorded().filter((call) => call.tool === "git" && call.args.includes("fetch"))).toHaveLength(
      1,
    );
    const tree = join(made.root, "tree $(touch forbidden) '");
    mkdirSync(tree);
    const envFile = join(tree, "credentials file");
    const [refused, paths] = await Promise.all([
      made.runAsync(
        'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/../escape.ts", []);',
      ),
      made.runAsync(
        'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/example.ts", []);',
        {
          FAKE_EXECUTE: "1",
          ANA_HOSTS: JSON.stringify([{ ...made.host, tree, envFiles: [envFile] }]),
        },
      ),
    ]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("repository-relative");
    expect(paths.code).toBe(0);
    expect(made.recorded().findLast((call) => call.tool === "host-bun")?.args).toContain(
      `--env-file=${envFile}`,
    );
    expect(existsSync(join(made.main, "forbidden"))).toBe(false);
  });

  it("refuses an unsafe or repeated host identity before invoking ssh", async () => {
    const made = fixture();
    const results = await Promise.all(
      [
        [made.host, made.host],
        [{ name: "../outside" }],
        [{ name: "here" }],
        [{ name: "runner", ssh: "-oProxyCommand=x", tree: "/fake", bun: "bun" }],
      ].map((entries) =>
        made.runAsync('import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; hostsOf();', {
          ANA_HOSTS: JSON.stringify(entries),
        }),
      ),
    );
    for (const result of results) expect(result.code).toBe(1);
    expect(made.recorded()).toHaveLength(0);
  });
});

describe.concurrent("code preparation", () => {
  it("refuses a failed fetch, an unpublished commit, a dirty controller or failed install", async () => {
    const failures = await Promise.all(
      [
        { FAKE_FETCH_FAIL: "1" },
        { FAKE_UNPUBLISHED: "1" },
        { FAKE_DIRTY: " M tracked" },
        { FAKE_INSTALL_FAIL: "1" },
      ].map(async (extra) => {
        const made = fixture();
        return { made, result: await made.runAsync(prepare, { FAKE_EXECUTE: "1", ...extra }) };
      }),
    );
    for (const { made, result } of failures) {
      expect(result.code).toBe(1);
      expect(made.recorded().some((call) => call.args.includes("tools/runs/cli.ts"))).toBe(false);
    }
    const made = fixture();
    const folder = join(made.main, ".ana", "d2", "distant");
    mkdirSync(folder, { recursive: true });
    append(join(folder, LOG_FILE), "campaign.ended", { ending: "finished" });
    const result = await made.runAsync(
      'import { move } from "REPOSITORY/tools/runs/move.ts"; await move(["distant", "--to", "runner", "--yes"]);',
      { FAKE_EXECUTE: "1", FAKE_FETCH_FAIL: "1" },
    );
    expect(result.code).toBe(1);
    expect(
      made
        .recorded()
        .filter((call) => call.tool === "ssh")
        .some((call) => call.args.at(-1)?.includes("pause") === true),
    ).toBe(false);
    expect(existsSync(join(made.main, ".ana", "moved"))).toBe(false);
  });
});

describe.concurrent("campaign snapshots", () => {
  it("refreshes a remote campaign and publishes whole lines in the existing archive", async () => {
    const remote = campaign();
    const { made } = remote;
    const whole = readFileSync(remote.log, "utf8");
    writeFileSync(remote.log, `${whole}{"inFlight":`);
    const result = await made.runAsync(sync, remote.env);
    expect(result.code).toBe(0);
    const copied = join(made.main, "data", "runs", "runner", "distant", LOG_FILE);
    expect(readFileSync(copied, "utf8")).toBe(whole);
    const transfer = made.recorded().find((call) => call.tool === "rsync");
    expect(transfer?.args).toContain("--exclude=.env");
    expect(transfer?.args).toContain("--exclude=.env.*");
    expect(existsSync(join(made.main, ".ana", "d2", "distant"))).toBe(false);
    expect((await made.runAsync(sync, { ...remote.env, FAKE_TRANSFER_FAIL: "1" })).code).toBe(1);
    expect(readFileSync(copied, "utf8")).toBe(whole);
  });

  it("serialises refreshes in one process and releases a failed refresh", async () => {
    const remote = campaign();
    const { made } = remote;
    const result = await made.runAsync(
      'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; process.env.FAKE_TRANSFER_FAIL = "1"; await syncRuns(["distant"]).catch(() => undefined); delete process.env.FAKE_TRANSFER_FAIL; await Promise.all(Array.from({length: 3}, () => syncRuns(["distant"])));',
      remote.env,
    );
    expect({ code: result.code, err: result.err }).toEqual({ code: 0, err: "" });
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(4);
  });

  it("waits for a live fetch however old its lock, then takes over and reclaims what a killed one left", async () => {
    const remote = campaign();
    const { made } = remote;
    const archive = join(made.main, "data", "runs", "runner");
    const lock = join(archive, ".fetch-distant.lock");
    const copied = join(archive, "distant", LOG_FILE);
    // A whole refresh killed between setting the copy aside and publishing the new one, and a record
    // refresh after it that keeps what that copy held.
    mkdirSync(join(lock, "stage", "previous"), { recursive: true });
    writeFileSync(join(lock, "stage", "previous", "artefact.txt"), "kept");
    mkdirSync(join(lock, "stage", "campaign"), { recursive: true });
    const holder = Bun.spawn([
      process.execPath,
      "-e",
      `import { hold } from ${JSON.stringify(join(import.meta.dir, "..", "src", "meta", "holder.ts"))}; hold(${JSON.stringify(join(lock, "holder"))}); await Bun.sleep(30000);`,
    ]);
    const holding = performance.now() + 10_000;
    while (!held(join(lock, "holder")) && performance.now() < holding) await Bun.sleep(20);
    const ready = join(made.root, "reader-ready");
    const script = join(made.root, "reader.ts");
    writeFileSync(
      script,
      `await Bun.write(${JSON.stringify(ready)}, "ready");\n${sync.replaceAll("REPOSITORY/", `${join(import.meta.dir, "..")}/`).replace('{match:"exact"}', '{match:"exact",depth:"record"}')}`,
    );
    const reader = Bun.spawn([process.execPath, script], {
      cwd: made.main,
      env: { ...made.env, ...remote.env },
      stdout: "ignore",
      stderr: "pipe",
    });
    try {
      const started = performance.now() + 5000;
      while (!existsSync(ready) && performance.now() < started) await Bun.sleep(5);
      expect(existsSync(ready)).toBe(true);
      await Bun.sleep(1500);
      expect(existsSync(copied)).toBe(false);
    } finally {
      holder.kill("SIGKILL");
      const code = await reader.exited;
      expect({ code, err: await new Response(reader.stderr).text() }).toEqual({ code: 0, err: "" });
    }
    expect(readFileSync(copied, "utf8")).toBe(readFileSync(remote.log, "utf8"));
    expect(readFileSync(join(archive, "distant", "artefact.txt"), "utf8")).toBe("kept");
    expect(readdirSync(archive).toSorted()).toEqual([".fetch-distant.lock", "distant"]);
    expect(readdirSync(lock)).toEqual([]);
  });

  it("refuses ambiguity in an exact read, an unavailable catalogue and unsafe paths, and reads one copy in a collection", async () => {
    const remote = campaign();
    const { made } = remote;
    const duplicate = {
      FAKE_CATALOGUE: JSON.stringify([
        { name: "distant", path: remote.log },
        { name: "distant", path: remote.log },
      ]),
    };
    const [dupRes, escRes, misshapen, silent] = await Promise.all([
      made.runAsync(sync, duplicate),
      made.runAsync(sync, { FAKE_CATALOGUE: JSON.stringify([{ name: "../escape", path: remote.log }]) }),
      made.runAsync(sync, {
        FAKE_CATALOGUE: JSON.stringify([{ name: "distant", path: remote.log, open: "yes" }]),
      }),
      made.runAsync(sync, { FAKE_OFFLINE: "1" }),
    ]);
    expect(dupRes.code).toBe(1);
    expect(escRes.code).toBe(1);
    // A host that answers with an entry this tree cannot read refuses the read, as an unsafe path does.
    expect(misshapen.code).toBe(1);
    expect(misshapen.err).toContain("runner: invalid campaign catalogue");
    expect(silent.code).toBe(0);
    expect(silent.err).toContain("runner: no campaign catalogue");
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(0);
    const collection = await made.runAsync(sync.replace('{match:"exact"}', "{}"), duplicate);
    expect(collection.code).toBe(0);
    expect(collection.err).toContain("distant");
    expect(collection.err).toContain("runner");
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(1);
  });

  it("skips unchanged archived whole snapshots, never skips open or unarchived ones, and isolates failed delta refreshes", async () => {
    const { made, there, resting, here, listed } = ablation();
    const archived = listed("sealed", there);
    const live = listed("active", resting);
    mkdirSync(there("sealed", "node_modules/pkg"), { recursive: true });
    writeFileSync(there("sealed", "node_modules/pkg/index.js"), "ignored");
    mkdirSync(there("sealed", "own"), { recursive: true });
    writeFileSync(there("sealed", "own/kept.py"), "kept");
    const env = { FAKE_CATALOGUE: JSON.stringify([archived, live]), FAKE_LISTED: "1" };
    const count = (tool: string) => made.recorded().filter((call) => call.tool === tool).length;
    const findCalls = () =>
      made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("find . ") === true)
        .length;
    const sealedKept = here("runner", "sealed", "own/kept.py");
    const sealedModules = here("runner", "sealed", "node_modules");
    // Batch the five same-env syncRuns calls in one process to avoid redundant Bun cold starts.
    const batch = `
import { existsSync, readFileSync } from "node:fs";
import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts";
const calls = () => readFileSync(process.env.FAKE_CALLS!, "utf8").trim().split("\\n").filter(Boolean).map((l) => JSON.parse(l));
const count = (tool: string) => calls().filter((c: { tool: string }) => c.tool === tool).length;
const finds = () => calls().filter((c: { tool: string; args: string[] }) => c.tool === "ssh" && c.args.at(-1)?.includes("find . ") === true).length;
await syncRuns(["sealed"], { match: "exact", depth: "record" });
const afterRecord = existsSync(${JSON.stringify(sealedKept)});
await syncRuns(["sealed"], { match: "exact", depth: "whole" });
const keptAfterWhole = readFileSync(${JSON.stringify(sealedKept)}, "utf8");
const modulesAfterWhole = existsSync(${JSON.stringify(sealedModules)});
const [r0, f0] = [count("rsync"), finds()];
await syncRuns(["sealed"], { match: "exact", depth: "whole" });
const repeatDelta = [count("rsync") - r0, finds() - f0];
await syncRuns(["active"], { match: "exact", depth: "whole" });
const rActive = count("rsync");
await syncRuns(["active"], { match: "exact", depth: "whole" });
const activeDelta = count("rsync") - rActive;
console.log(JSON.stringify({ afterRecord, keptAfterWhole, modulesAfterWhole, repeatDelta, activeDelta }));`;
    const ran = await made.runAsync(batch, env);
    expect({ code: ran.code, err: ran.err }).toEqual({ code: 0, err: "" });
    expect(JSON.parse(ran.out)).toEqual({
      afterRecord: false,
      keptAfterWhole: "kept",
      modulesAfterWhole: false,
      repeatDelta: [0, 0],
      activeDelta: 1,
    });
    const rsyncBeforeOpen = count("rsync");
    const syncSealed =
      'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; await syncRuns(["sealed"], {match:"exact",depth:"whole"});';
    expect(
      (
        await made.runAsync(syncSealed, {
          FAKE_CATALOGUE: JSON.stringify([{ ...archived, open: true }, live]),
          FAKE_LISTED: "1",
        })
      ).code,
    ).toBe(0);
    expect(count("rsync")).toBe(rsyncBeforeOpen + 1);
    expect(findCalls()).toBeGreaterThan(0);

    const beforeGrow = readFileSync(here("runner", "active", LOG_FILE), "utf8");
    append(resting("active", LOG_FILE), "campaign.ended", { ending: "finished", why: "grown" });
    const grownEnv = {
      FAKE_CATALOGUE: JSON.stringify([
        archived,
        { ...live, bytes: lstatSync(resting("active", LOG_FILE)).size },
      ]),
      FAKE_LISTED: "1",
    };
    const syncActive =
      'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; await syncRuns(["active"], {match:"exact",depth:"whole"});';
    expect((await made.runAsync(syncActive, { ...grownEnv, FAKE_TRANSFER_FAIL: "1" })).code).toBe(1);
    expect(readFileSync(here("runner", "active", LOG_FILE), "utf8")).toBe(beforeGrow);
    expect((await made.runAsync(syncActive, grownEnv)).code).toBe(0);
    expect(readFileSync(here("runner", "active", LOG_FILE), "utf8")).toBe(
      readFileSync(resting("active", LOG_FILE), "utf8"),
    );
  });
});

/** A host kept for ablations: where a campaign its retire archived lies there, where one still in
 *  its worktree does, where a copy lies here, and a campaign with one artefact as the catalogue
 *  lists it. */
function ablation() {
  const made = fixture();
  const there = (name: string, file = "") =>
    join(made.root, "remote", "main", "data", "runs", "here", name, file);
  const resting = (name: string, file = "") =>
    join(made.root, "remote", `tree-${name}`, ".ana", "d2", name, file);
  const here = (from: string, name: string, file = "") => join(made.main, "data", "runs", from, name, file);
  const listed = (name: string, at: typeof there, more: { readonly kept?: boolean } = {}) => {
    mkdirSync(at(name, "memory"), { recursive: true });
    writeFileSync(at(name, "memory/note.txt"), "kept");
    append(at(name, LOG_FILE), "campaign.word", { word: "fixture" });
    return { name, path: at(name, LOG_FILE), bytes: lstatSync(at(name, LOG_FILE)).size, ...more };
  };
  return { made, there, resting, here, listed };
}

describe.concurrent("the daily retire's host step", () => {
  it("takes over what the eval runner has archived once the copy here matches it, and leaves every other campaign there", async () => {
    const { made, there, resting, here, listed } = ablation();
    const ahead = listed("ahead", there);
    const env = {
      FAKE_CATALOGUE: JSON.stringify([
        listed("over", there),
        listed("resting", resting),
        listed("kept", there, { kept: true }),
        // The log there is longer than its catalogue said, as one gone on with since would be.
        { ...ahead, bytes: ahead.bytes - 1 },
      ]),
    };
    const sweep = (extra: Record<string, string>) =>
      made.runAsync('import { retire } from "REPOSITORY/tools/runs/retire.ts"; await retire(["--yes"]);', {
        ...env,
        ...extra,
      });
    // A sweep that only describes copies nothing first, so it names no take-over of a campaign it
    // has yet to copy, and says that one with --yes can take more.
    const dry = await made.runAsync(
      'import { retire } from "REPOSITORY/tools/runs/retire.ts"; await retire([]);',
      { ...env, EVAL_RUNNER: benchOn("runner") },
    );
    expect(dry.code).toBe(0);
    expect(dry.out).not.toContain("over: held in");
    expect(dry.out).toContain("can take more");
    expect([existsSync(there("over")), existsSync(here("runner", "over"))]).toEqual([true, false]);
    // With no benchmark rolled on a peer, a sweep copies every campaign and deletes none, and a
    // host the list does not hold is refused.
    expect((await sweep({ EVAL_RUNNER: benchOn(undefined) })).code).toBe(0);
    expect([existsSync(there("over")), existsSync(here("runner", "over", LOG_FILE))]).toEqual([true, true]);
    const unknown = await sweep({ EVAL_RUNNER: benchOn("nowhere") });
    expect([unknown.code, unknown.err.includes("no host nowhere")]).toEqual([1, true]);

    const taken = await sweep({ EVAL_RUNNER: benchOn("runner") });
    // The archived campaign is this machine's own now, whole, and gone from the host.
    expect(readFileSync(here("here", "over", "memory/note.txt"), "utf8")).toBe("kept");
    expect([existsSync(there("over")), existsSync(here("runner", "over"))]).toEqual([false, false]);
    // One still in its worktree, one a keeper holds and one that went on stay where they are.
    for (const [name, at] of [
      ["resting", resting],
      ["kept", there],
      ["ahead", there],
    ] as const) {
      expect([existsSync(at(name, LOG_FILE)), existsSync(here("here", name))]).toEqual([true, false]);
      expect(existsSync(here("runner", name, LOG_FILE))).toBe(true);
    }
    expect(taken.code).toBe(1);
    expect(taken.err).toContain("1 campaigns were not taken over: ahead:");
  });

  it("says what it would take without --yes, and keeps on its host a campaign whose copy here lacks a path", async () => {
    const { made, there, here, listed } = ablation();
    const env = { FAKE_CATALOGUE: JSON.stringify([listed("over", there), listed("apart", there)]) };
    const snapshots = 'import { takeRetired, syncRuns } from "REPOSITORY/tools/runs/snapshots.ts";';
    expect((await made.runAsync(`${snapshots} await syncRuns([]);`, env)).code).toBe(0);
    writeFileSync(there("apart", "late.txt"), "written since the copy");
    const extract = (act: "take" | "describe") =>
      made.runAsync(
        `${snapshots} import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await takeRetired(hostsOf()[0]!, "${act}");`,
        env,
      );
    const dry = await extract("describe");
    expect(dry.out).toContain(`would: runner over: held in ${here("here", "over")}`);
    expect([existsSync(there("over")), existsSync(here("here", "over"))]).toEqual([true, false]);
    expect((await extract("take")).out).toContain(
      "runner apart: stays there, 1 paths differ from the copy here",
    );
    expect([existsSync(there("apart", LOG_FILE)), existsSync(here("runner", "apart", LOG_FILE))]).toEqual([
      true,
      true,
    ]);
    expect([existsSync(there("over")), existsSync(here("here", "over", LOG_FILE))]).toEqual([false, true]);
  });
});

describe.concurrent("a take-over of a campaign that installed packages", () => {
  it("takes it once the copy holds all but the packages, and leaves it where the copy lacks a file of its own", async () => {
    const { made, there, here, listed } = ablation();
    const env = {
      FAKE_CATALOGUE: JSON.stringify([listed("over", there), listed("apart", there)]),
      FAKE_LISTED: "1",
    };
    for (const name of ["over", "apart"]) {
      mkdirSync(there(name, "tree/lib/pkg-1.dist-info"), { recursive: true });
      mkdirSync(there(name, "tree/lib/pkg"), { recursive: true });
      writeFileSync(there(name, "tree/lib/pkg/code.py"), "installed");
      writeFileSync(
        there(name, "tree/lib/pkg-1.dist-info/RECORD"),
        "pkg/code.py,,\npkg-1.dist-info/RECORD,,\n",
      );
      writeFileSync(there(name, "tree/lib/own.py"), "the Builder's");
    }
    writeFileSync(there("apart", "tree/lib/pkg/extra.py"), "the Builder's");
    const snapshots = 'import { takeRetired, syncRuns } from "REPOSITORY/tools/runs/snapshots.ts";';
    expect((await made.runAsync(`${snapshots} await syncRuns([]);`, env)).code).toBe(0);
    expect(existsSync(here("runner", "over", "tree/lib/pkg"))).toBe(false);
    // Removing one unlisted file inside the installed package must keep the original on its host.
    rmSync(here("runner", "apart", "tree/lib/pkg/extra.py"));
    const taken = await made.runAsync(
      `${snapshots} import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await takeRetired(hostsOf()[0]!, "take");`,
      env,
    );
    expect(taken.out).toContain("runner apart: stays there, 1 paths differ from the copy here");
    expect([existsSync(there("apart", "tree/lib")), existsSync(here("here", "apart"))]).toEqual([
      true,
      false,
    ]);
    expect([
      existsSync(there("over")),
      readFileSync(here("here", "over", "tree/lib/own.py"), "utf8"),
    ]).toEqual([false, "the Builder's"]);
    expect(existsSync(here("here", "over", "tree/lib/pkg"))).toBe(false);
  });
});

/** `EVAL_RUNNER` naming one benchmark, rolled on `host` (this machine where undefined). */
const benchOn = (host: string | undefined) =>
  JSON.stringify([
    {
      name: "outside",
      store: "bench/store",
      sitting: "bin/sitting.sh",
      packs: ["stats"],
      ...keyIfDefined("host", host),
    },
  ]);
