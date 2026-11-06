/**
 * `tools/wri/posture.ts` as a pass runs it, with its embedder injected, so a test can cut a real child
 * process part-way through a read and count what each read embedded. No model and no network.
 *
 *   bun test/helpers/posture-slow.ts <log> --store <dir> --count <file> --hang-after <batches>
 *
 * Once `--hang-after` batches are in, the first read to come here hangs until its limit kills it, which
 * proves the cut without a timing to guess. The file `<count>.hung` says one has, and every later read
 * goes through. `<count>` gets one line per batch, the number of texts in it.
 */
import { appendFileSync, existsSync, writeFileSync } from "#src/meta/filesystem.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { postureOf } from "#tools/wri/posture.ts";
import { fakeEmbed } from "./posture-embed.ts";

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
const lines = await postureOf(log, {
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
console.log(lines.join("\n"));
