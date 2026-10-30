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
import { join, resolve } from "#src/meta/path.ts";
import { READERS, type Reader, derive, derivedLine, derivedText } from "../tools/wri/derive.ts";

const REPO = resolve(import.meta.dir, "..");
/** A reader that prints the log's size, so a moved log shows in its file. */
const SIZE: Reader = {
  name: "size",
  args: (log) => ["-e", `console.log(require("fs").statSync(${JSON.stringify(log)}).size)`],
};
const BROKEN: Reader = {
  name: "broken",
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
    expect(readFileSync(join(root, "camp", "size.txt"), "utf8").trim()).toBe("27");
    expect((await derive(log, { root, repo: REPO, readers: [SIZE] })).ran).toBe(false);
    appendFileSync(log, '{"kind":"build.started"}\n');
    expect((await derive(log, { root, repo: REPO, readers: [SIZE] })).ran).toBe(true);
    expect(readFileSync(join(root, "camp", "size.txt"), "utf8").trim()).toBe("52");
    // Nothing is left beside the folder that replaced the last.
    expect(readdirSync(root)).toEqual(["camp"]);
  });

  it("names a reader that failed, with its ending, and still writes the others", async () => {
    const done = await derive(log, { root, repo: REPO, readers: [BROKEN, SIZE] });
    expect(done.failed).toEqual(["broken"]);
    expect(readFileSync(join(root, "camp", "broken.txt"), "utf8")).toContain("ended with exit 3");
    expect(existsSync(join(root, "camp", "size.txt"))).toBe(true);
    expect(derivedLine([done], root)).toContain("readers that failed: camp/broken");
    expect(derivedText([done], [SIZE])).toContain("## camp · size\n\n27");
  });

  it("names only scripts the tree holds", () => {
    expect(
      READERS.map(({ args }) => args("log")[0] ?? "").filter((script) => !existsSync(join(REPO, script))),
    ).toEqual([]);
  });
});
