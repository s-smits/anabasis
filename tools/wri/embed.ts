/**
 * How a reader of the pulse turns a log's prose into vectors: the pinned local model, and a store that
 * a kill leaves usable. Only `tools/wri/` imports it, so its dependency stays out of every seat's reach.
 *
 * Kept from v1 (`5bc9988:.claude/skills/whole-run-investigation/classifier/`): the pin and two failures
 * that taught something. `40e540bdd` embeds only what no earlier read embedded, and `495c4cde2` finishes
 * offline and with a store it cannot write.
 *
 * Progress survives a kill. A cut reader keeps its last result and says nothing (`readInto`,
 * `tools/wri/pass.ts`), so the vectors go down after every batch, and the next read embeds the rest. A
 * reader that calls this marks itself `resumes`, or a cut never comes round again (`runQueue`).
 * The vectors are made from text that may hold hidden values, so they lie in the reader store under
 * `.ana/`, closed to every seat by name, instead of v1's `~/.cache`. The public model's files stay in
 * the shared cache, outside every worktree, so a fresh checkout downloads nothing. One log has one file
 * for one pin, whichever reader asks, so a text two readers want is embedded once.
 *
 * A read with nothing new loads no model. One thread at the pass's lowest priority holds it to the one
 * core `room` allows a reader: 3,083 texts took 50 s at a peak footprint of 609 MB, and the next read
 * 0.3 s and 238 MB (5 November, the most prose in 238 logs).
 */
import { sha256 } from "#src/meta/digest.ts";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { folderOf, storeOf } from "#tools/runs/pulse-readers.ts";

/** Texts in, one vector out for each: tests inject one, a read loads the pinned model. */
export type Embed = (texts: readonly string[]) => Promise<readonly Float32Array[]>;

/** How a read reaches its store and its embedder. */
export interface EmbedWays {
  readonly store: string;
  readonly load: () => Promise<Embed>;
}

const BATCH = 16;
const MODEL = "Xenova/bge-small-en-v1.5";
const REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";
/** What a whole cached model holds. Only then does it load from its folder: the library looks for a
 *  hub model's files at its main revision whatever revision is asked for, so offline it built a null
 *  tokenizer from a whole cache (`495c4cde2`), and a folder a cut download left is not a model. */
const MODEL_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model.onnx"];
/** A cut download leaves its part behind (`FileCache.put`), up to 133 MB a try. Older than any read. */
const PART_MS = 10 * 60_000;

const keyOf = (words: string) => sha256(words).slice(0, 32);
const firstLine = (message: string) => (message.split("\n")[0] ?? "").slice(0, 200);

/** One stored row, or null for a line a kill tore: a torn line never parses, so it is embedded again. */
function rowOf(line: string): readonly [string, Float32Array] | null {
  try {
    const row = capturedJsonParse(line);
    if (!Array.isArray(row) || !isString(row[0]) || !isString(row[1])) return null;
    const bytes = Buffer.from(row[1], "base64");
    return [row[0], new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length))];
  } catch {
    return null;
  }
}

/** Write one batch, and why not where it could not: a read goes on without its store. It opens with a
 *  newline, so what follows a torn line stays whole. */
function kept(file: string, keys: readonly string[], made: readonly Float32Array[]): string | null {
  const lines = keys.map((key, at) => {
    const vector = made[at] ?? new Float32Array();
    const bytes = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    return capturedJsonStringify([key, bytes.toString("base64")]);
  });
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `\n${lines.join("\n")}\n`);
    return null;
  } catch (error) {
    return firstLine(errorMessage(error));
  }
}

/** Embed what `vectors` lacks of `wanted`, the shortest first, keeping each batch as it is made. */
async function embedMissing(
  vectors: Map<string, Float32Array>,
  wanted: readonly string[],
  { file, load }: { readonly file: string; readonly load: EmbedWays["load"] },
) {
  const missing = [...new Set(wanted)]
    .filter((words) => !vectors.has(keyOf(words)))
    .toSorted((one, other) => one.length - other.length);
  let embedded = 0;
  let unkept: string | null = null;
  let stopped: string | null = null;
  if (missing.length === 0) return { embedded, unkept, stopped, missing: 0 };
  try {
    const embed = await load();
    for (let at = 0; at < missing.length; at += BATCH) {
      const batch = missing.slice(at, at + BATCH);
      const keys = batch.map(keyOf);
      const made = await embed(batch);
      for (const [index, key] of keys.entries()) vectors.set(key, made[index] ?? new Float32Array());
      embedded += batch.length;
      unkept ??= kept(file, keys, made);
    }
  } catch (error) {
    stopped = firstLine(errorMessage(error));
  }
  return { embedded, unkept, stopped, missing: missing.length };
}

/** The vectors of `wanted` for one log: those kept, and the rest embedded and appended batch by batch.
 *  `stopped` says why the embedder gave up, with what it finished kept; `unkept` why the store could not
 *  be written, with every vector still in hand. `missing` counts what this read found to embed. */
export async function vectorsOf(log: string, wanted: readonly string[], { store, load }: EmbedWays) {
  const file = join(folderOf(store, log), `vectors-${sha256(`${MODEL}@${REVISION}`).slice(0, 8)}.jsonl`);
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const vectors = new Map(lines.map(rowOf).filter((row) => row !== null));
  const found = await embedMissing(vectors, wanted, { file, load });
  return { ...found, vectorOf: (words: string) => vectors.get(keyOf(words)) ?? new Float32Array() };
}

/** `vectorsOf` for a reader's lines: `stopped` is the one line it then prints, and `unkept` the line to
 *  print beside its reading, each naming the reader. */
export async function vectorLines(name: string, log: string, wanted: readonly string[], ways: EmbedWays) {
  const { vectorOf, embedded, missing, stopped, unkept } = await vectorsOf(log, wanted, ways);
  return {
    vectorOf,
    embedded,
    stopped:
      stopped === null
        ? null
        : `${name}: no reading, the local model did not finish, ${String(embedded)} of ${String(missing)} texts embedded: ${stopped}`,
    unkept:
      unkept === null ? [] : [`${name}: the vector store cannot be written, so nothing is kept: ${unkept}`],
  };
}

/** Cosine of two normalised vectors. */
export const dot = (one: Float32Array, other: Float32Array) => {
  let sum = 0;
  for (let at = 0; at < one.length; at += 1) sum += (one[at] ?? 0) * (other[at] ?? 0);
  return sum;
};

/** Which group each vector falls in, by its index: two at `least` or above share one, and so does
 *  whatever links them, so a group's size reads as a chain of near texts and no text's own closeness. */
export function groupsOf(vectors: readonly Float32Array[], least: number): number[] {
  const parent = vectors.map((_, at) => at);
  const root = (at: number): number => {
    let found = at;
    while ((parent[found] ?? found) !== found) found = parent[found] ?? found;
    return found;
  };
  for (const [at, vector] of vectors.entries()) {
    for (const [other, near] of vectors.slice(at + 1).entries()) {
      if (dot(vector, near) >= least) parent[root(at + 1 + other)] = root(at);
    }
  }
  return vectors.map((_, at) => root(at));
}

/** The pinned model on one thread, from its folder where that holds all of it, else fetched there. */
export async function localModel(): Promise<Embed> {
  const { env, pipeline } = await import("@huggingface/transformers");
  const cache = join(homedir(), ".cache", "huggingface", "transformers.js");
  const folder = join(cache, MODEL, REVISION);
  env.cacheDir = cache;
  const whole = MODEL_FILES.every((name) => existsSync(join(folder, name)));
  if (!whole && existsSync(folder)) {
    for (const name of readdirSync(folder, { recursive: true, encoding: "utf8" })) {
      const part = join(folder, name);
      if (/\.tmp\.\d+\./.test(name) && Date.now() - statSync(part).mtimeMs > PART_MS) rmSync(part);
    }
  }
  const extract = await pipeline("feature-extraction", whole ? folder : MODEL, {
    dtype: "fp32",
    revision: REVISION,
    session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 },
  });
  return async (texts) => {
    const { data, dims } = await extract([...texts], { pooling: "mean", normalize: true });
    const width = dims[1] ?? 0;
    return texts.map((_, at) => Float32Array.from(data.slice(at * width, (at + 1) * width)));
  };
}

/** A reader's command line: `bun tools/wri/<name>.ts <log> [--store <dir>]`. */
export async function runVectorReader(
  name: string,
  readOf: (log: string, ways: EmbedWays) => Promise<readonly string[]>,
): Promise<void> {
  const { values, positionals } = parseArgs({
    args: runtimeProcess.argv.slice(2),
    allowPositionals: true,
    options: { store: { type: "string" } },
  });
  const [log] = positionals;
  if (log === undefined) throw new Error(`name a log: bun tools/wri/${name}.ts <log> [--store <dir>]`);
  const store = values.store ?? storeOf(runtimeProcess.cwd());
  console.log((await readOf(log, { store, load: localModel })).join("\n"));
}
