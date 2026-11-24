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

describe("host execution", () => {
  it("keeps paths and arguments literal and clears the peer list for any repository script", () => {
    const made = fixture();
    const result = made.run(
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
      made.run(
        'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/example.ts", []);',
        { FAKE_EXECUTE: "1" },
      ).code,
    ).toBe(0);
    expect(made.recorded().filter((call) => call.tool === "git" && call.args.includes("fetch"))).toHaveLength(
      1,
    );
    const refused = made.run(
      'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/../escape.ts", []);',
    );
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("repository-relative");
    const tree = join(made.root, "tree $(touch forbidden) '");
    mkdirSync(tree);
    const envFile = join(tree, "credentials file");
    const paths = made.run(
      'import { scriptOn } from "REPOSITORY/tools/runs/hosts.ts"; import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await scriptOn(hostsOf()[0]!, "tools/example.ts", []);',
      {
        FAKE_EXECUTE: "1",
        ANA_HOSTS: JSON.stringify([{ ...made.host, tree, envFiles: [envFile] }]),
      },
    );
    expect(paths.code).toBe(0);
    expect(made.recorded().findLast((call) => call.tool === "host-bun")?.args).toContain(
      `--env-file=${envFile}`,
    );
    expect(existsSync(join(made.main, "forbidden"))).toBe(false);
  });

  it("refuses an unsafe or repeated host identity before invoking ssh", () => {
    const made = fixture();
    for (const entries of [
      [made.host, made.host],
      [{ name: "../outside" }],
      [{ name: "here" }],
      [{ name: "runner", ssh: "-oProxyCommand=x", tree: "/fake", bun: "bun" }],
    ]) {
      expect(
        made.run('import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; hostsOf();', {
          ANA_HOSTS: JSON.stringify(entries),
        }).code,
      ).toBe(1);
      expect(made.recorded()).toHaveLength(0);
    }
  });
});

describe("code preparation", () => {
  it("refuses a failed fetch, an unpublished commit, a dirty controller or failed install", () => {
    for (const extra of [
      { FAKE_FETCH_FAIL: "1" },
      { FAKE_UNPUBLISHED: "1" },
      { FAKE_DIRTY: " M tracked" },
      { FAKE_INSTALL_FAIL: "1" },
    ]) {
      const made = fixture();
      expect(made.run(prepare, { FAKE_EXECUTE: "1", ...extra }).code).toBe(1);
      expect(made.recorded().some((call) => call.args.includes("tools/runs/cli.ts"))).toBe(false);
    }
    const made = fixture();
    const folder = join(made.main, ".ana", "d2", "distant");
    mkdirSync(folder, { recursive: true });
    append(join(folder, LOG_FILE), "campaign.ended", { ending: "finished" });
    const result = made.run(
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

describe("campaign snapshots", () => {
  it("refreshes a remote campaign and publishes whole lines in the existing archive", () => {
    const remote = campaign();
    const { made } = remote;
    const whole = readFileSync(remote.log, "utf8");
    writeFileSync(remote.log, `${whole}{"inFlight":`);
    const result = made.run(sync, remote.env);
    expect(result.code).toBe(0);
    const copied = join(made.main, "data", "runs", "runner", "distant", LOG_FILE);
    expect(readFileSync(copied, "utf8")).toBe(whole);
    const transfer = made.recorded().find((call) => call.tool === "rsync");
    expect(transfer?.args).toContain("--exclude=.env");
    expect(transfer?.args).toContain("--exclude=.env.*");
    expect(existsSync(join(made.main, ".ana", "d2", "distant"))).toBe(false);
    expect(made.run(sync, { ...remote.env, FAKE_TRANSFER_FAIL: "1" }).code).toBe(1);
    expect(readFileSync(copied, "utf8")).toBe(whole);
  });

  it("serialises refreshes in one process and releases a failed refresh", () => {
    const remote = campaign();
    const { made } = remote;
    const result = made.run(
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

  it("refuses ambiguity in an exact read, an unavailable catalogue and unsafe paths, and reads one copy in a collection", () => {
    const remote = campaign();
    const { made } = remote;
    const duplicate = {
      FAKE_CATALOGUE: JSON.stringify([
        { name: "distant", path: remote.log },
        { name: "distant", path: remote.log },
      ]),
    };
    for (const extra of [
      duplicate,
      { FAKE_CATALOGUE: JSON.stringify([{ name: "../escape", path: remote.log }]) },
    ]) {
      expect(made.run(sync, extra).code).toBe(1);
    }
    // A host that answers with an entry this tree cannot read refuses the read, as an unsafe path does.
    const misshapen = made.run(sync, {
      FAKE_CATALOGUE: JSON.stringify([{ name: "distant", path: remote.log, open: "yes" }]),
    });
    expect(misshapen.code).toBe(1);
    expect(misshapen.err).toContain("runner: invalid campaign catalogue");
    const silent = made.run(sync, { FAKE_OFFLINE: "1" });
    expect(silent.code).toBe(0);
    expect(silent.err).toContain("runner: no campaign catalogue");
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(0);
    const collection = made.run(sync.replace('{match:"exact"}', "{}"), duplicate);
    expect(collection.code).toBe(0);
    expect(collection.err).toContain("distant");
    expect(collection.err).toContain("runner");
    expect(made.recorded().filter((call) => call.tool === "rsync")).toHaveLength(1);
  });

  it("skips unchanged archived whole snapshots, never skips open or unarchived ones, and isolates failed delta refreshes", () => {
    const { made, there, resting, here, listed } = ablation();
    const archived = listed("sealed", there);
    const live = listed("active", resting);
    mkdirSync(there("sealed", "node_modules/pkg"), { recursive: true });
    writeFileSync(there("sealed", "node_modules/pkg/index.js"), "ignored");
    mkdirSync(there("sealed", "own"), { recursive: true });
    writeFileSync(there("sealed", "own/kept.py"), "kept");
    const env = {
      FAKE_CATALOGUE: JSON.stringify([archived, live]),
      FAKE_LISTED: "1",
    };
    const count = (tool: string) => made.recorded().filter((call) => call.tool === tool).length;
    const findCalls = () =>
      made.recorded().filter((call) => call.tool === "ssh" && call.args.at(-1)?.includes("find . ") === true)
        .length;

    // A record refresh first must not satisfy a subsequent whole refresh.
    expect(
      made.run(
        'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; await syncRuns(["sealed"], {match:"exact",depth:"record"});',
        env,
      ).code,
    ).toBe(0);
    expect(existsSync(here("runner", "sealed", "own/kept.py"))).toBe(false);

    // First whole refresh transfers non-derived files, prunes node_modules, and seals wholeBytes.
    expect(
      made.run(
        'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; await syncRuns(["sealed"], {match:"exact",depth:"whole"});',
        env,
      ).code,
    ).toBe(0);
    expect(readFileSync(here("runner", "sealed", "own/kept.py"), "utf8")).toBe("kept");
    expect(existsSync(here("runner", "sealed", "node_modules"))).toBe(false);
    const [rsyncAfterWhole, findAfterWhole] = [count("rsync"), findCalls()];

    // Repeat whole refresh on unchanged archived closed run skips both find and rsync.
    expect(
      made.run(
        'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; await syncRuns(["sealed"], {match:"exact",depth:"whole"});',
        env,
      ).code,
    ).toBe(0);
    expect([count("rsync"), findCalls()]).toEqual([rsyncAfterWhole, findAfterWhole]);

    // Marking the same archived run open forces a whole refresh rather than reusing wholeBytes.
    expect(
      made.run(
        'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; await syncRuns(["sealed"], {match:"exact",depth:"whole"});',
        { FAKE_CATALOGUE: JSON.stringify([{ ...archived, open: true }, live]), FAKE_LISTED: "1" },
      ).code,
    ).toBe(0);
    expect(count("rsync")).toBe(rsyncAfterWhole + 1);

    // An unarchived worktree run is never skipped on whole refresh, and a failed grown-log refresh leaves the prior copy intact.
    const syncActive =
      'import { syncRuns } from "REPOSITORY/tools/runs/snapshots.ts"; await syncRuns(["active"], {match:"exact",depth:"whole"});';
    expect(made.run(syncActive, env).code).toBe(0);
    const rsyncAfterFirstActive = count("rsync");
    expect(made.run(syncActive, env).code).toBe(0);
    expect(count("rsync")).toBe(rsyncAfterFirstActive + 1);

    const beforeGrow = readFileSync(here("runner", "active", LOG_FILE), "utf8");
    append(resting("active", LOG_FILE), "campaign.ended", { ending: "finished", why: "grown" });
    const grownEnv = {
      FAKE_CATALOGUE: JSON.stringify([
        archived,
        { ...live, bytes: lstatSync(resting("active", LOG_FILE)).size },
      ]),
      FAKE_LISTED: "1",
    };
    expect(made.run(syncActive, { ...grownEnv, FAKE_TRANSFER_FAIL: "1" }).code).toBe(1);
    expect(readFileSync(here("runner", "active", LOG_FILE), "utf8")).toBe(beforeGrow);
    expect(made.run(syncActive, grownEnv).code).toBe(0);
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

describe("the daily retire's host step", () => {
  it("takes over what the eval runner has archived once the copy here matches it, and leaves every other campaign there", () => {
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
      made.run('import { retire } from "REPOSITORY/tools/runs/retire.ts"; await retire(["--yes"]);', {
        ...env,
        ...extra,
      });
    // A sweep that only describes copies nothing first, so it names no take-over of a campaign it
    // has yet to copy, and says that one with --yes can take more.
    const dry = made.run('import { retire } from "REPOSITORY/tools/runs/retire.ts"; await retire([]);', {
      ...env,
      EVAL_RUNNER: benchOn("runner"),
    });
    expect(dry.code).toBe(0);
    expect(dry.out).not.toContain("over: held in");
    expect(dry.out).toContain("can take more");
    expect([existsSync(there("over")), existsSync(here("runner", "over"))]).toEqual([true, false]);
    // With no benchmark rolled on a peer, a sweep copies every campaign and deletes none, and a
    // host the list does not hold is refused.
    expect(sweep({ EVAL_RUNNER: benchOn(undefined) }).code).toBe(0);
    expect([existsSync(there("over")), existsSync(here("runner", "over", LOG_FILE))]).toEqual([true, true]);
    const unknown = sweep({ EVAL_RUNNER: benchOn("nowhere") });
    expect([unknown.code, unknown.err.includes("no host nowhere")]).toEqual([1, true]);

    const taken = sweep({ EVAL_RUNNER: benchOn("runner") });
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

  it("says what it would take without --yes, and keeps on its host a campaign whose copy here lacks a path", () => {
    const { made, there, here, listed } = ablation();
    const env = { FAKE_CATALOGUE: JSON.stringify([listed("over", there), listed("apart", there)]) };
    const snapshots = 'import { takeRetired, syncRuns } from "REPOSITORY/tools/runs/snapshots.ts";';
    expect(made.run(`${snapshots} await syncRuns([]);`, env).code).toBe(0);
    writeFileSync(there("apart", "late.txt"), "written since the copy");
    const extract = (act: "take" | "describe") =>
      made.run(
        `${snapshots} import { hostsOf } from "REPOSITORY/tools/runs/host-config.ts"; await takeRetired(hostsOf()[0]!, "${act}");`,
        env,
      );
    const dry = extract("describe");
    expect(dry.out).toContain(`would: runner over: held in ${here("here", "over")}`);
    expect([existsSync(there("over")), existsSync(here("here", "over"))]).toEqual([true, false]);
    expect(extract("take").out).toContain("runner apart: stays there, 1 paths differ from the copy here");
    expect([existsSync(there("apart", LOG_FILE)), existsSync(here("runner", "apart", LOG_FILE))]).toEqual([
      true,
      true,
    ]);
    expect([existsSync(there("over")), existsSync(here("here", "over", LOG_FILE))]).toEqual([false, true]);
  });
});

describe("a take-over of a campaign that installed packages", () => {
  it("takes it once the copy holds all but the packages, and leaves it where the copy lacks a file of its own", () => {
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
    expect(made.run(`${snapshots} await syncRuns([]);`, env).code).toBe(0);
    expect(existsSync(here("runner", "over", "tree/lib/pkg"))).toBe(false);
    // Removing one unlisted file inside the installed package must keep the original on its host.
    rmSync(here("runner", "apart", "tree/lib/pkg/extra.py"));
    const taken = made.run(
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
