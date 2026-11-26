/**
 * A reader of a log's words with its embedder injected, so a test can cut a real child process
 * mid-read and count what each read embedded: `bun test/helpers/vectors-slow.ts <log> --store <dir>
 * --count <file> --hang-after <batches>`. After `--hang-after` batches the first read hangs until
 * its limit kills it, `<count>.hung` marks that, and later reads go through; `<count>` gets one
 * line per batch, its text count.
 */
import { read } from "#src/kernel/log.ts";
import { appendFileSync, existsSync, writeFileSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { vectorLines } from "#tools/wri/embed.ts";
import { fakeEmbed } from "./fake-embed.ts";

const { values, positionals } = parseArgs({
  args: runtimeProcess.argv.slice(2),
  allowPositionals: true,
  options: {
    store: { type: "string" },
    count: { type: "string" },
    "hang-after": { type: "string" },
  },
});
const [log] = positionals;
const { store, count, "hang-after": hangAfter } = values;
if (log === undefined || store === undefined || count === undefined) throw new Error("name all three");
let batches = 0;
const words = read(log).flatMap(({ kind, data }) =>
  kind === "build.turn" && isString(data.text) ? [data.text] : [],
);
const { stopped } = await vectorLines("slow", log, words, {
  store,
  load: async () => async (texts) => {
    if (batches === Number(hangAfter) && !existsSync(`${count}.hung`)) {
      writeFileSync(`${count}.hung`, "");
      await Bun.sleep(600_000);
    }
    batches += 1;
    appendFileSync(count, `${String(texts.length)}\n`);
    return fakeEmbed(texts);
  },
});
console.log(stopped ?? "read");
