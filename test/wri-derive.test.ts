// The readers' folders: written once a log moves, kept while it stands, replaced whole, and a
// reader that fails named without stopping the rest.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import {
  READERS,
  type Reader,
  derive,
  derivedLine,
  derivedMap,
  derivedText,
  folderOf,
} from "../tools/wri/derive.ts";

const REPO = resolve(import.meta.dir, "..");
/** A reader that prints the log's size, so a moved log shows in its file. */
const SIZE: Reader = {
  name: "size",
  answers: "the log's size in bytes",
  args: (log) => ["-e", `console.log(require("fs").statSync(${JSON.stringify(log)}).size)`],
};
const BROKEN: Reader = {
  name: "broken",
  answers: "a reader that fails",
  args: () => ["-e", "console.error('no such fold'); process.exit(3)"],
};

let dir = "";
let log = "";
let root = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ana-derive-"));
  log = join(dir, "d2", "camp", "log.jsonl");
  root = join(dir, "derived");
  mkdirSync(join(dir, "d2", "camp"), { recursive: true });
  writeFileSync(log, '{"kind":"campaign.opened"}\n');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("deriving a campaign's readers", () => {
  it("keeps a folder while its log stands and replaces it whole once the log moves", async () => {
    const first = await derive(log, { root, repo: REPO, readers: [SIZE] });
    expect(first).toMatchObject({ name: "camp", ran: true, failed: [] });
    expect(readFileSync(join(first.dir, "size.txt"), "utf8").trim()).toBe("27");
    expect((await derive(log, { root, repo: REPO, readers: [SIZE] })).ran).toBe(false);
    appendFileSync(log, '{"kind":"build.started"}\n');
    expect((await derive(log, { root, repo: REPO, readers: [SIZE] })).ran).toBe(true);
    expect(readFileSync(join(first.dir, "size.txt"), "utf8").trim()).toBe("52");
    // Nothing is left beside the folder that replaced the last.
    expect(readdirSync(root)).toEqual([basename(first.dir)]);
  });

  it("keeps a folder for each log of one campaign name, so neither replaces the other", async () => {
    // A snapshot, a host's copy and the live log share the campaign's name: until 9 November they
    // shared its folder, and the pulse's derivation of the live log replaced the one a `start
    // --snapshot` had pointed its lanes at.
    const copy = join(dir, "snapshot", "camp", "log.jsonl");
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, '{"kind":"campaign.opened"}\n{"kind":"build.started"}\n');
    const live = await derive(log, { root, repo: REPO, readers: [SIZE] });
    const frozen = await derive(copy, { root, repo: REPO, readers: [SIZE] });
    expect(frozen.dir).not.toBe(live.dir);
    expect(frozen.name).toBe("camp");
    expect(basename(frozen.dir)).toStartWith("camp@");
    expect((await derive(log, { root, repo: REPO, readers: [SIZE] })).ran).toBe(false);
    expect(readFileSync(join(frozen.dir, "size.txt"), "utf8").trim()).toBe("52");
  });

  it("does not keep a folder written by fewer readers in place of a whole one", async () => {
    const whole = { root, repo: REPO, readers: [SIZE, BROKEN] };
    expect((await derive(log, { root, repo: REPO, readers: [SIZE] })).ran).toBe(true);
    expect((await derive(log, whole)).ran).toBe(true);
    expect((await derive(log, whole)).ran).toBe(false);
  });

  it("names a reader that failed, with its ending, and still writes the others", async () => {
    const done = await derive(log, { root, repo: REPO, readers: [BROKEN, SIZE] });
    expect(done.failed).toEqual(["broken"]);
    expect(readFileSync(join(done.dir, "broken.txt"), "utf8")).toContain("ended with exit 3");
    expect(existsSync(join(done.dir, "size.txt"))).toBe(true);
    expect(derivedLine([done], root)).toContain("readers that failed: camp/broken");
    expect(derivedText([done], [SIZE])).toContain("## camp · size\n\n27");
  });

  it("names only scripts the tree holds", () => {
    expect(
      READERS.map(({ args }) => args("log", REPO)[0] ?? "").filter(
        (script) => !existsSync(join(REPO, script)),
      ),
    ).toEqual([]);
  });

  it("says in one line what each reader's file holds", () => {
    // The line stands in every open lane's prompt, so it is short and makes no cell of its own.
    expect(
      READERS.filter(({ answers }) => answers.length < 20 || answers.length > 100 || /[|\n]/u.test(answers)),
    ).toEqual([]);
  });
});

describe("the map of derived files a lane's prompt carries", () => {
  it("names each file with what it holds and its lines, a campaign a column, in the folder derive wrote", async () => {
    const copy = join(dir, "snapshot", "camp", "log.jsonl");
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, '{"kind":"campaign.opened"}\n{"kind":"build.started"}\n');
    const lines: Reader = {
      name: "lines",
      answers: "the log's lines, one each",
      args: (path) => [
        "-e",
        `console.log(require("fs").readFileSync(${JSON.stringify(path)}, "utf8").trim())`,
      ],
    };
    const [one, other] = [
      await derive(log, { root, repo: REPO, readers: [lines] }),
      await derive(copy, { root, repo: REPO, readers: [lines] }),
    ];
    expect([one.dir, other.dir]).toEqual([folderOf(root, log), folderOf(root, copy)]);
    const map = derivedMap([one, other], [lines, BROKEN]);
    expect(map).toContain(`\`${one.dir}/\``);
    expect(map).toContain("| `lines.txt` | the log's lines, one each | 1 / 2 |");
    // A reader the folders were not derived with has no file, which is said, not counted as empty.
    expect(map).toContain("| `broken.txt` | a reader that fails | none / none |");
  });

  it("is empty where no folder stands, and leaves out a campaign whose folder is gone", async () => {
    expect(derivedMap([{ name: "camp", dir: folderOf(root, log) }])).toBe("");
    const one = await derive(log, { root, repo: REPO, readers: [SIZE] });
    const map = derivedMap([one, { name: "gone", dir: join(root, "gone@0") }], [SIZE]);
    expect(map).toContain("| `size.txt` | the log's size in bytes | 1 |");
    expect(map).not.toContain("gone");
  });
});
