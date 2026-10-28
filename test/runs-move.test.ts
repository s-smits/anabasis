// Moving a campaign or a seed whole between hosts, with recovery paths after interrupted copies.
import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { hostname } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { move } from "../tools/runs/move.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";
import { writeReceipt } from "../tools/runs/receipt.ts";

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function seedMove() {
  const made = fakeHosts();
  roots.push(made.root);
  const folder = join(made.main, ".ana", "d2", "seed");
  mkdirSync(folder, { recursive: true });
  // No opening and no receipt, as a seed cut before the campaign's first launch.
  writeFileSync(join(folder, "log.jsonl"), "");
  writeFileSync(join(folder, "seed.json"), "{}");
  writeFileSync(join(folder, "notes.txt"), "keep the whole folder");
  const into = join(made.root, "anabasis-seed", ".ana", "d2", "seed");
  const run = (
    flags: readonly string[],
    extra: Record<string, string> = {},
    end = ["--to", made.host.name],
  ) =>
    made.run(
      `import { move } from "REPOSITORY/tools/runs/move.ts"; await move(${JSON.stringify(["seed", ...end, "--yes", ...flags])});`,
      { FAKE_EXECUTE: "1", FAKE_RUN_CLI: "1", ...extra },
    );
  return { ...made, folder, into, move: run };
}

describe("moving a campaign to another machine", () => {
  it("moves held seeds whole over local, remote and relayed routes", () => {
    for (const route of ["local", "remote", "relay", "own"] as const) {
      const made = seedMove();
      const other = { ...made.host, name: "other", ssh: "fake-other" };
      const routes = {
        local: ["--to", made.host.name],
        remote: ["--from", made.host.name, "--to", "here"],
        relay: ["--from", made.host.name, "--to", other.name],
        own: ["--from", hostname().split(".")[0] ?? "", "--to", made.host.name],
      };
      const flags = route === "remote" ? ["--hold", "--", "--project", "fixture"] : ["--hold"];
      const result = made.move(flags, { ANA_HOSTS: JSON.stringify([made.host, other]) }, routes[route]);
      expect(result.code).toBe(0);
      expect(existsSync(made.folder)).toBe(false);
      expect(readFileSync(join(made.into, "log.jsonl"), "utf8")).toBe("");
      expect(readFileSync(join(made.into, "notes.txt"), "utf8")).toBe("keep the whole folder");
      expect(made.recorded().some(({ tool, args }) => tool === "host-bun" && args.includes("continue"))).toBe(
        false,
      );
      const copies = made
        .recorded()
        .filter(({ tool, args }) => tool === "rsync" && !args.includes("--exclude=/*"));
      expect(copies).toHaveLength(route === "relay" ? 2 : 1);
      if (route === "relay") {
        expect(
          copies
            .map(({ args }) => args.slice(-2).map((end) => end.split(":")[0]))
            .map(([from, to]) => [from === "fake-runner", to === "fake-other"]),
        ).toEqual([
          [true, false],
          [false, true],
        ]);
      }
      if (route === "remote") {
        expect(result.out).toContain("--project fixture");
        expect(made.recorded().some(({ tool, args }) => tool === "host-bun" && args.includes("-e"))).toBe(
          false,
        );
      }
    }
  });

  it("refuses an unheld seed with no continuation flags before copying or pausing", () => {
    const made = seedMove();
    const result = made.move([]);
    expect(result.code).toBe(1);
    expect(existsSync(made.folder)).toBe(true);
    expect(existsSync(made.into)).toBe(false);
    expect(made.recorded().filter(({ tool }) => tool === "rsync")).toHaveLength(0);
    expect(made.recorded().some(({ tool }) => tool === "ps")).toBe(false);
  });

  it("reads a remote seed's missing receipt before copying or pausing", () => {
    const made = seedMove();
    const result = made.move([], {}, ["--from", made.host.name, "--to", "here"]);
    expect(result.code).toBe(1);
    expect(result.err).toContain(made.folder);
    expect(result.err).toContain("--hold");
    expect(existsSync(made.folder)).toBe(true);
    expect(existsSync(made.into)).toBe(false);
    expect(
      made
        .recorded()
        .filter(({ tool }) => tool === "rsync")
        .map(({ args }) => args.slice(-4, -2)),
    ).toEqual([["--include=/launch-*.json", "--exclude=/*"]]);
    expect(made.recorded().some(({ tool, args }) => tool === "host-bun" && args.includes("pause"))).toBe(
      false,
    );
  });

  it("continues a seed on explicit flags without reading a missing receipt", () => {
    const made = seedMove();
    const result = made.move(["--", "--project", "explicit-project"], { FAKE_RUN_CLI: "0" });
    expect(result.code).toBe(0);
    expect(existsSync(made.folder)).toBe(false);
    expect(
      made
        .recorded()
        .filter(({ tool, args }) => tool === "host-bun" && args.includes("continue"))
        .map(({ args }) => args.slice(-3)),
    ).toEqual([["--", "--project", "explicit-project"]]);
  });

  it("keeps a remote receipt's flags when the source tree predates lastLaunch", () => {
    const made = seedMove();
    const tools = join(made.main, "tools", "runs");
    mkdirSync(tools, { recursive: true });
    writeFileSync(join(tools, "receipt.ts"), "export const receipts = () => [];\n");
    writeReceipt(join(made.folder, "log.jsonl"), "run-1", {
      at: new Date().toISOString(),
      pid: 42,
      flags: ["--project", "kept-project"],
      envFile: null,
      commit: made.commit,
      dirty: false,
      load: 0,
      cores: 2,
    });
    const result = made.move(["--hold"], {}, ["--from", made.host.name, "--to", "here"]);
    expect(result.err).toBe("");
    expect(result.code).toBe(0);
    expect(result.out).toContain("--project kept-project");
    expect(existsSync(join(made.into, "launch-run-1.json"))).toBe(true);
  });
});

describe("recovering interrupted moves", () => {
  it("gives recovery paths after a failed copy and leaves both folders untouched on retry", () => {
    const made = seedMove();
    const failed = made.move(["--hold"], { FAKE_TRANSFER_FAIL: "1" });
    expect(failed.code).toBe(1);
    expect(readFileSync(join(made.into, "log.jsonl"), "utf8")).toBe("partial");
    const retry = made.move(["--hold"]);
    expect(retry.code).toBe(1);
    for (const fact of [made.folder, made.into, "runner", "git -C", "worktree remove"]) {
      expect(retry.err).toContain(fact);
    }
    expect(readFileSync(join(made.into, "log.jsonl"), "utf8")).toBe("partial");
    expect(existsSync(made.folder)).toBe(true);
    expect(made.recorded().filter(({ tool }) => tool === "rsync")).toHaveLength(1);
  });

  it("points a retry to the destination after the source has been set aside", () => {
    const made = seedMove();
    expect(made.move(["--hold"]).code).toBe(0);
    const retry = made.move(["--hold"]);
    expect(retry.code).toBe(1);
    for (const fact of [made.into, "runner", "runs continue seed", ".ana/moved/"]) {
      expect(retry.err).toContain(fact);
    }
    expect(readFileSync(join(made.into, "notes.txt"), "utf8")).toBe("keep the whole folder");
    expect(made.recorded().filter(({ tool }) => tool === "rsync")).toHaveLength(1);
  });

  it("refuses a move to where the campaign is, asking no host", async () => {
    const own = hostname().split(".")[0] ?? "";
    for (const flags of [["--to", "here"], ["--to", own], ["--from", own, "--to", "here"], []]) {
      await expect(move(["c", ...flags])).rejects.toThrow(/usage:/);
    }
  });
});
