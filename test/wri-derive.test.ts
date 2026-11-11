// The readers' folders: one parse of the log for every reader that needs only its events, written
// once a log moves, kept while it stands, replaced whole, and a reader that fails named without
// stopping the rest; and any one reader printed by `wri.ts reader`.
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { LogEvent } from "#src/kernel/log.ts";
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
import { capturedExecPath } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import {
  READERS,
  type Reader,
  derive,
  derivedLine,
  derivedMap,
  derivedText,
  folderOf,
} from "../tools/wri/derive.ts";

/** What an in-process reader is handed: the log's events, and those without the seats' traces. */
interface Parsed {
  readonly events: readonly LogEvent[];
  readonly quiet: readonly LogEvent[];
}

const REPO = resolve(import.meta.dir, "..");
const OPENED = '{"at":"2026-11-01T00:00:00.000Z","kind":"campaign.opened","data":{}}\n';
const STARTED = '{"at":"2026-11-01T00:01:00.000Z","kind":"build.started","data":{"session":"b-1"}}\n';
const TURN = '{"at":"2026-11-01T00:02:00.000Z","kind":"build.turn","data":{"session":"b-1"}}\n';
/** A reader that counts the log's events, so a moved log shows in its file. */
const COUNT: Reader = {
  name: "count",
  answers: "the log's events, counted",
  read: ({ events }: Parsed) => [String(events.length)],
};
const THROWS: Reader = {
  name: "throws",
  answers: "a reader that throws",
  read: () => {
    throw new Error("no such fold");
  },
};
const EXITS: Reader = {
  name: "exits",
  answers: "a reader of its own process that fails",
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
  writeFileSync(log, OPENED);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const fileOf = (done: { dir: string }, name: string) => readFileSync(join(done.dir, `${name}.txt`), "utf8");

describe("deriving a campaign's readers", () => {
  it("keeps a folder while its log stands and replaces it whole once the log moves", async () => {
    const first = await derive(log, { root, repo: REPO, readers: [COUNT] });
    expect(first).toMatchObject({ name: "camp", ran: true, failed: [] });
    expect(fileOf(first, "count")).toBe("1\n");
    expect((await derive(log, { root, repo: REPO, readers: [COUNT] })).ran).toBe(false);
    appendFileSync(log, STARTED);
    expect((await derive(log, { root, repo: REPO, readers: [COUNT] })).ran).toBe(true);
    expect(fileOf(first, "count")).toBe("2\n");
    // Nothing is left beside the folder that replaced the last.
    expect(readdirSync(root)).toEqual([basename(first.dir)]);
  });

  it("keeps a folder for each log of one campaign name, so neither replaces the other", async () => {
    // A snapshot, a host's copy and the live log share the campaign's name: until 9 November they
    // shared its folder, and the pulse's derivation of the live log replaced the one a `start
    // --snapshot` had pointed its lanes at.
    const copy = join(dir, "snapshot", "camp", "log.jsonl");
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, OPENED + STARTED);
    const live = await derive(log, { root, repo: REPO, readers: [COUNT] });
    const frozen = await derive(copy, { root, repo: REPO, readers: [COUNT] });
    expect(frozen.dir).not.toBe(live.dir);
    expect(frozen.name).toBe("camp");
    expect(basename(frozen.dir)).toStartWith("camp@");
    expect((await derive(log, { root, repo: REPO, readers: [COUNT] })).ran).toBe(false);
    expect(fileOf(frozen, "count")).toBe("2\n");
  });

  it("does not keep a folder written by fewer readers in place of a whole one", async () => {
    const whole = { root, repo: REPO, readers: [COUNT, THROWS] };
    expect((await derive(log, { root, repo: REPO, readers: [COUNT] })).ran).toBe(true);
    expect((await derive(log, whole)).ran).toBe(true);
    expect((await derive(log, whole)).ran).toBe(false);
  });

  it("names each reader that failed, in this process or its own, and still writes the others", async () => {
    const done = await derive(log, { root, repo: REPO, readers: [THROWS, EXITS, COUNT] });
    expect(done.failed).toEqual(["throws", "exits"]);
    // The last line names the failure, which is the line a look of the pulse says of it.
    expect(fileOf(done, "throws").trimEnd().split("\n").at(-1)).toBe("-- throws failed: no such fold");
    expect(fileOf(done, "exits")).toContain("ended with exit 3");
    expect(fileOf(done, "exits")).toContain("no such fold");
    expect(fileOf(done, "count")).toBe("1\n");
    expect(derivedLine([done], root)).toContain("readers that failed: camp/throws, camp/exits");
    expect(derivedText([done], [COUNT])).toContain("## camp · count\n\n1");
  });

  it("parses the log once, to its last whole line, and hands every reader the same events", async () => {
    // A live log's last line may be an append in flight; until this rewrite each reader parsed the
    // log again, and those that refused a torn line failed on a log a campaign was writing.
    appendFileSync(log, STARTED + TURN + STARTED.slice(0, 20));
    const seen: (readonly LogEvent[])[] = [];
    const keep = (name: string): Reader => ({
      name,
      answers: "the events it was handed",
      read: ({ events, quiet }: Parsed) => {
        seen.push(events);
        return [`${String(events.length)} ${String(quiet.length)}`];
      },
    });
    const done = await derive(log, { root, repo: REPO, readers: [keep("one"), keep("other")] });
    expect(done.failed).toEqual([]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
    // `quiet` leaves out the seats' turns and calls, which a reader of no seat's words never reads.
    expect(fileOf(done, "one")).toBe("3 2\n");
  });

  it("runs no reader that finds a campaign by name on a log the name does not find", async () => {
    // The repository holds no campaign named `camp`, as it holds another log for a snapshot's name.
    const ran: Reader = { name: "ran", answers: "a reader of the log it is handed", args: COUNT_ARGS };
    const done = await derive(log, {
      root,
      repo: REPO,
      readers: [{ ...ran, name: "byname", named: true }, ran],
    });
    expect(done.failed).toEqual([]);
    const said = fileOf(done, "byname");
    expect(said).toStartWith(
      "not read: byname finds a campaign by its name, and camp names no one campaign here",
    );
    expect(said).toContain(log);
    expect(fileOf(done, "ran")).toBe("1\n");
    expect(READERS.filter(({ named }) => named === true).map(({ name }) => name)).toEqual([
      "view",
      "loop",
      "source",
      "logged",
      "cost",
      "table",
    ]);
  });

  it("keeps a process only for a reader that needs more than the log", () => {
    // Those that find their campaign by name, read every campaign beside it, load the embedding
    // model or open each kept harness.
    expect(READERS.flatMap((reader) => ("args" in reader ? [reader.name] : []))).toEqual([
      "view",
      "loop",
      "source",
      "logged",
      "cost",
      "table",
      "replay",
      "restated",
      "nearness",
      "versions",
      "chain",
    ]);
    expect(
      READERS.flatMap((reader) => ("args" in reader ? [reader.args("log", REPO)[0] ?? ""] : [])).filter(
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

/** A reader of its own process that counts the log's lines. */
const COUNT_ARGS = (path: string) => [
  "-e",
  `console.log(require("fs").readFileSync(${JSON.stringify(path)}, "utf8").trim().split("\\n").length)`,
];

describe("one reader, by name", () => {
  const reader = (...args: string[]) =>
    runSync([capturedExecPath, "tools/wri/wri.ts", "reader", ...args], { cwd: REPO });

  it("prints what derive writes to that reader's file", async () => {
    appendFileSync(log, STARTED);
    const degradations = READERS.find(({ name }) => name === "degradations");
    if (degradations === undefined) throw new Error("no degradations reader");
    const done = await derive(log, { root, repo: REPO, readers: [degradations] });
    const ran = reader("degradations", "--log", log);
    expect(ran.exitCode).toBe(0);
    expect(decodeOutput(ran.stdout)).toBe(fileOf(done, "degradations"));
  });

  it("refuses a name no reader has, naming those it has", () => {
    const ran = reader("no-such-reader", "--log", log);
    expect(ran.exitCode).not.toBe(0);
    expect(decodeOutput(ran.stderr)).toContain("rows");
    expect(decodeOutput(ran.stderr)).toContain("chain");
  });
});

describe("the map of derived files a lane's prompt carries", () => {
  it("names each file with what it holds and its lines, a campaign a column, in the folder derive wrote", async () => {
    const copy = join(dir, "snapshot", "camp", "log.jsonl");
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, OPENED + STARTED);
    const lines: Reader = {
      name: "lines",
      answers: "the log's events, one line each",
      read: ({ events }: Parsed) => events.map(({ kind }) => kind),
    };
    const [one, other] = [
      await derive(log, { root, repo: REPO, readers: [lines] }),
      await derive(copy, { root, repo: REPO, readers: [lines] }),
    ];
    expect([one.dir, other.dir]).toEqual([folderOf(root, log), folderOf(root, copy)]);
    const map = derivedMap([one, other], [lines, THROWS]);
    expect(map).toContain(`\`${one.dir}/\``);
    expect(map).toContain("| `lines.txt` | the log's events, one line each | 1 / 2 |");
    // A reader the folders were not derived with has no file, which is said, not counted as empty.
    expect(map).toContain("| `throws.txt` | a reader that throws | none / none |");
  });

  it("is empty where no folder stands, and leaves out a campaign whose folder is gone", async () => {
    expect(derivedMap([{ name: "camp", dir: folderOf(root, log) }])).toBe("");
    const one = await derive(log, { root, repo: REPO, readers: [COUNT] });
    const map = derivedMap([one, { name: "gone", dir: join(root, "gone@0") }], [COUNT]);
    expect(map).toContain("| `count.txt` | the log's events, counted | 1 |");
    expect(map).not.toContain("gone");
  });
});
