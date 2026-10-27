// Moving a campaign to another machine: the kept flags that name a path where the source's worktrees
// sit name the destination's, and a move between two hosts, or to where it already is, is refused
// before anything is asked of either. This machine's own host name names it, as `here` does. The folder left behind is set aside, in a tree that never set
// one aside as in one that did.
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { hostname, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { asideOf, move, rehomed, setAside } from "../tools/runs/move.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";
import { writeReceipt } from "../tools/runs/receipt.ts";

function seedMove() {
  const made = fakeHosts();
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
  it("moves a held seed whole without an opening or a launch receipt", () => {
    const made = seedMove();
    const result = made.move(["--hold"]);
    expect(result.code).toBe(0);
    expect(existsSync(made.folder)).toBe(false);
    expect(readFileSync(join(made.into, "log.jsonl"), "utf8")).toBe("");
    expect(readFileSync(join(made.into, "notes.txt"), "utf8")).toBe("keep the whole folder");
    expect(made.recorded().filter(({ tool }) => tool === "rsync")).toHaveLength(1);
    expect(made.recorded().some(({ tool, args }) => tool === "host-bun" && args.includes("continue"))).toBe(
      false,
    );
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

  it("holds a remote seed and accepts explicit flags without a receipt", () => {
    const made = seedMove();
    const flags = ["--project", "fixture"];
    const result = made.move(["--hold", "--", ...flags], {}, ["--from", made.host.name, "--to", "here"]);
    expect(result.code).toBe(0);
    expect(existsSync(made.folder)).toBe(false);
    expect(readFileSync(join(made.into, "notes.txt"), "utf8")).toBe("keep the whole folder");
    expect(result.out).toContain(flags.join(" "));
    expect(made.recorded().some(({ tool, args }) => tool === "host-bun" && args.includes("-e"))).toBe(false);
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

  it("names a kept path under the source's folder under the destination's, whole or after a flag's =", () => {
    const flags = [
      "--prompt-file",
      "/Users/air/Developer/anabasis-prompts/buffer-prompt.txt",
      "--bundle=/Users/air/Developer/pack",
      "--project",
      "buffer-fresh",
    ];
    expect(rehomed(flags, "/Users/air/Developer", "/home/stijn/src")).toEqual([
      "--prompt-file",
      "/home/stijn/src/anabasis-prompts/buffer-prompt.txt",
      "--bundle=/home/stijn/src/pack",
      "--project",
      "buffer-fresh",
    ]);
  });

  it("leaves a path that only begins with the same letters, and one elsewhere, as it was", () => {
    const flags = [
      "--prompt-file",
      "/Users/air/Developer2/p.txt",
      "--root=/opt/packs",
      "/Users/air/Developer",
    ];
    expect(rehomed(flags, "/Users/air/Developer", "/home/stijn/src")).toEqual(flags);
  });

  it("moves a held seed between two hosts through this machine, one remote side a copy", () => {
    const made = seedMove();
    const other = { ...made.host, name: "other", ssh: "fake-other" };
    const result = made.move(["--hold"], { ANA_HOSTS: JSON.stringify([made.host, other]) }, [
      "--from",
      made.host.name,
      "--to",
      other.name,
    ]);
    expect(result.code).toBe(0);
    expect(existsSync(made.folder)).toBe(false);
    expect(readFileSync(join(made.into, "notes.txt"), "utf8")).toBe("keep the whole folder");
    const copies = made
      .recorded()
      .filter(({ tool, args }) => tool === "rsync" && !args.includes("--exclude=/*"))
      .map(({ args }) => args.slice(-2).map((end) => end.split(":")[0]));
    expect(copies.map(([from, to]) => [from === "fake-runner", to === "fake-other"])).toEqual([
      [true, false],
      [false, true],
    ]);
  });

  it("moves a held seed from this machine named by its own host name", () => {
    const made = seedMove();
    const result = made.move(["--hold"], {}, [
      "--from",
      hostname().split(".")[0] ?? "",
      "--to",
      made.host.name,
    ]);
    expect(result.code).toBe(0);
    expect(readFileSync(join(made.into, "notes.txt"), "utf8")).toBe("keep the whole folder");
    expect(made.recorded().filter(({ tool }) => tool === "rsync")).toHaveLength(1);
  });

  it("refuses a move to where the campaign is, asking no host", async () => {
    const own = hostname().split(".")[0] ?? "";
    await expect(move(["c", "--to", "here"])).rejects.toThrow("usage: bun run runs move");
    await expect(move(["c", "--to", own])).rejects.toThrow("usage: bun run runs move");
    await expect(move(["c", "--from", own, "--to", "here"])).rejects.toThrow("usage: bun run runs move");
    await expect(move(["c"])).rejects.toThrow("usage: bun run runs move");
  });

  it("sets the folder left behind aside in a tree that never set one aside, and in one that did", () => {
    const tree = mkdtempSync(join(tmpdir(), "ana-aside-"));
    for (const name of ["first", "second"]) {
      const folder = join(tree, ".ana", "d2", name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "log.jsonl"), "");
      const aside = asideOf(tree, name);
      setAside(folder, aside);
      expect([existsSync(folder), existsSync(join(aside, "log.jsonl"))]).toEqual([false, true]);
    }
  });
});
