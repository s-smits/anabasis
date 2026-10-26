// Moving a campaign to another machine: the kept flags that name a path where the source's worktrees
// sit name the destination's, and a move between two hosts, or to where it already is, is refused
// before anything is asked of either. The folder left behind is set aside, in a tree that never set
// one aside as in one that did.
import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { asideOf, move, rehomed, setAside } from "../tools/runs/move.ts";

describe("moving a campaign to another machine", () => {
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

  it("refuses a move between two hosts, and one to where the campaign is, asking neither", async () => {
    // Neither name is a host ANA_HOSTS lists: a refusal that read them would say so instead.
    await expect(move(["c", "--from", "far", "--to", "near"])).rejects.toThrow(
      "one end of a move is this machine",
    );
    await expect(move(["c", "--to", "here"])).rejects.toThrow("usage: bun run runs move");
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
