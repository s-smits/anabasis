// Moving a campaign to another machine: the kept flags that name a path where the source's worktrees
// sit name the destination's, and a move between two hosts, or to where it already is, is refused
// before anything is asked of either.
import { describe, expect, it } from "bun:test";
import { move, rehomed } from "../tools/runs/move.ts";

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
});
