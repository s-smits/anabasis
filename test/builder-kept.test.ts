/**
 * The other harnesses a campaign kept, as a Builder's home holds them (`src/builder/kept.ts`): each
 * the log names, whole, under the head of its digest, with its programs. The hostile cases are the
 * ones that would hand the Builder what it may not read or what is not the harness its digest
 * names: a v1 state's correctness model, which holds every task's hidden values, a state only a
 * practice solve ran, and a harness copied without its programs.
 */
import { afterEach, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { seedKept } from "../src/builder/kept.ts";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";

const scratches: string[] = [];
afterEach(() => {
  for (const dir of scratches.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const digestOf = (letter: string) => letter.repeat(64);
const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-19T00:00:00.000Z",
  kind,
  data,
});

/** A kept state under `states`: its guide, and where `tree` is named, programs in a copy beside it
 *  that the state links to, as a frozen harness keeps its tree (`stagedState`, `tools.ts`). */
function keep(states: string, digest: string, tree: { name: string; bytes: number } | null): void {
  const dir = join(states, digest);
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "agent", "BUILT_AGENTS.md"), `guide of ${digest.slice(0, 8)}\n`);
  if (tree === null) return;
  mkdirSync(join(states, tree.name, "bin"), { recursive: true });
  writeFileSync(join(states, tree.name, "bin", "run"), "x".repeat(tree.bytes));
  symlinkSync(join("..", tree.name), join(dir, ".toolchain"));
}

function scratch() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-kept-")));
  scratches.push(root);
  const states = join(root, "states");
  const home = join(root, "home");
  mkdirSync(states);
  mkdirSync(home);
  return { states, home };
}

describe("the harnesses a campaign kept, in a Builder's home", () => {
  it("copies each named harness but the parent, with its programs, under the head of its digest", () => {
    const { states, home } = scratch();
    const [starter, frozen, promoted, practised] = [
      digestOf("a"),
      digestOf("b"),
      digestOf("c"),
      digestOf("d"),
    ];
    keep(states, starter, null);
    keep(states, frozen, { name: "tree-1", bytes: 10 });
    keep(states, promoted, { name: "tree-2", bytes: 10 });
    keep(states, practised, null);
    const events = [
      event("build.started", { session: "b-1", parent: starter }),
      event("build.finished", { session: "b-1", harness: frozen }),
      event("harness.promoted", { harness: promoted }),
    ];
    seedKept(home, states, events, promoted);
    expect(readdirSync(join(home, "kept")).sort()).toEqual(
      [starter, frozen].map((d) => d.slice(0, 8)).sort(),
    );
    // The programs are copied as files, not as a link back into the campaign's states.
    const run = join(home, "kept", frozen.slice(0, 8), ".toolchain", "bin", "run");
    expect(readFileSync(run, "utf8")).toBe("x".repeat(10));
    expect(realpathSync(run).startsWith(realpathSync(home))).toBe(true);
  });

  it("leaves a v1 state's correctness model out at any depth", () => {
    const { states, home } = scratch();
    const frozen = digestOf("b");
    keep(states, frozen, null);
    for (const at of ["correctness-model", join("agent", ".bundle-snapshots", "s1", "correctness-model")]) {
      mkdirSync(join(states, frozen, at), { recursive: true });
      writeFileSync(join(states, frozen, at, "battery.json"), "hidden-7a1");
    }
    seedKept(home, states, [event("build.finished", { session: "b-1", harness: frozen })], digestOf("a"));
    const files = readdirSync(join(home, "kept"), { recursive: true, withFileTypes: true }).filter((entry) =>
      entry.isFile(),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const entry of files) {
      expect(readFileSync(join(entry.parentPath, entry.name), "utf8")).not.toContain("hidden-7a1");
    }
  });

  it("copies every harness whole, however large, and makes the folder where none was kept", () => {
    const { states, home } = scratch();
    const [older, newer] = [digestOf("b"), digestOf("c")];
    keep(states, older, { name: "tree-1", bytes: 300_000 });
    keep(states, newer, { name: "tree-2", bytes: 300_000 });
    const events = [
      event("build.finished", { session: "b-1", harness: older }),
      event("build.finished", { session: "b-2", harness: newer }),
    ];
    seedKept(home, states, events, digestOf("a"));
    for (const digest of [older, newer]) {
      expect(
        readFileSync(join(home, "kept", digest.slice(0, 8), ".toolchain", "bin", "run"), "utf8"),
      ).toHaveLength(300_000);
    }
    const { states: none, home: empty } = scratch();
    seedKept(empty, none, [], digestOf("a"));
    expect(readdirSync(join(empty, "kept"))).toEqual([]);
  });
});
