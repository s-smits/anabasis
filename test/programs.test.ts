// The programs a harness installed: by the names its PATH runs, and each with its own account of
// itself, which the page shows.
import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { installedPrograms, programsOf } from "../src/solve/programs.ts";

const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A folder of its own, removed after the case. */
function folder(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-programs-")));
  made.push(dir);
  return dir;
}

function program(path: string, body: string | Buffer, mode = 0o755): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body);
  chmodSync(path, mode);
}

/** Each program of `tree` with its account, over a log with no solve. */
const accounts = (tree: string | null) => programsOf(tree).map(({ name, account }) => [name, account]);

describe("the programs a harness installed", () => {
  it("are the names a command's PATH runs, in its order, each once, and none without a tree", () => {
    // The sweep's tool tree: the Builder's interpreter in `bin`, a venv beside it whose `activate` is
    // sourced rather than run and whose `python3` repeats a name `bin` already holds.
    const tree = folder();
    for (const name of ["pynite-python", "python3"]) {
      program(join(tree, "bin", name), "#!/bin/sh\n");
    }
    for (const name of ["f2py", "numpy-config", "python3"]) {
      program(join(tree, "venv", "bin", name), "#!/bin/sh\n");
    }
    program(join(tree, "venv", "bin", "activate"), "#!/bin/sh\n", 0o644);
    const names = ["pynite-python", "python3", "f2py", "numpy-config"];
    const programs = programsOf(tree);
    expect([installedPrograms(tree), programs.map(({ name }) => name)]).toEqual([names, names]);
    expect(programs.find(({ name }) => name === "python3")?.at).toBe(join(tree, "bin", "python3"));
    expect([installedPrograms(null), accounts(null)]).toEqual([[], []]);
  });

  it("carry the comment at a program's head past its shebang, and none for a binary or a bare one", () => {
    const tree = folder();
    program(
      join(tree, "bin", "check-plan"),
      "#!/usr/bin/env bun\n// check-plan <answer.json>\n// Tests a plan.\nimport x from './x';\n// later\n",
    );
    program(join(tree, "bin", "count"), "#!/bin/sh\n# count [n]\n#\n# Prints n.\necho $1\n");
    program(join(tree, "bin", "bare"), "#!/bin/sh\necho bare\n");
    program(join(tree, "bin", "engine"), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 1, 0x23, 0x20]));
    program(
      join(tree, "bin", "fit"),
      '#!/usr/bin/env python3\n"""fit [task.json]\n\nFits amounts.\n"""\nimport sys\n',
    );
    program(
      join(tree, "bin", "plan"),
      "#!/usr/bin/env node\n/**\n * plan <task.json>\n * Plans pins.\n */\n",
    );
    // A launcher that says nothing of itself runs the file named as it beside its own folder.
    program(
      join(tree, "bin", "check-recipe"),
      '#!/bin/sh\nd="$(cd "$(dirname "$0")/../lib" && pwd)"\nexec python3 "$d/x"\n',
    );
    program(join(tree, "lib", "check_recipe.py"), '"""check-recipe <answer.json>"""\n', 0o644);
    expect(accounts(tree)).toEqual([
      ["bare", null],
      ["check-plan", "check-plan <answer.json>\nTests a plan."],
      ["check-recipe", "check-recipe <answer.json>"],
      ["count", "count [n]\n\nPrints n."],
      ["engine", null],
      ["fit", "fit [task.json]\n\nFits amounts."],
      ["plan", "plan <task.json>\nPlans pins."],
    ]);
  });

  it("read an account only from a file inside the tree and outside the exam side's copy", () => {
    // A program linked to a host file, or to the exam side's copy a v1 harness carries, would
    // otherwise show that file's head on the page.
    const tree = folder();
    const host = folder();
    program(join(host, "script"), "#!/bin/sh\n# the host's own words\n");
    program(join(tree, "lib", "plan.sh"), "#!/bin/sh\n# plan [task.json]\n");
    mkdirSync(join(tree, "bin"), { recursive: true });
    symlinkSync(join(host, "script"), join(tree, "bin", "outside"));
    symlinkSync("../lib/plan.sh", join(tree, "bin", "plan"));
    // A launcher whose file beside it is a link out of the tree takes no account from it.
    program(join(tree, "bin", "sneak"), "#!/bin/sh\nexec sh ../lib/sneak.sh\n");
    symlinkSync(join(host, "script"), join(tree, "lib", "sneak.sh"));
    program(join(tree, "correctness-model", "check.sh"), "#!/bin/sh\n# the hidden values\n");
    symlinkSync("../correctness-model/check.sh", join(tree, "bin", "peek"));
    expect(accounts(tree)).toEqual([
      ["outside", null],
      ["peek", null],
      ["plan", "plan [task.json]"],
      ["sneak", null],
    ]);
  });
});
