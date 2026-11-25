/**
 * How a pulse reader turns a log's prose into vectors: the pinned local model, and a store a kill
 * leaves usable. Only `tools/wri/` imports it, so its dependency stays out of every seat's reach. A
 * read embeds only what no earlier read embedded, and finishes offline and with a store it cannot
 * write.
 */
import { sha256 } from "#src/meta/digest.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { homedir } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { dropCutWrites } from "#src/meta/holder.ts";
import { folderOf, storeOf } from "#tools/runs/pulse-readers.ts";

/** Texts in, one vector out for each: tests inject one, a read loads the pinned model. */
export type Embed = (texts: readonly string[]) => Promise<readonly Float32Array[]>;

export interface EmbedWays {
  readonly store: string;
  readonly load: () => Promise<Embed>;
}

const BATCH = 16;
const MODEL = "Xenova/bge-small-en-v1.5";
const REVISION = "ea104dacec62c0de699686887e3f920caeb4f3e3";
/** What a whole cached model holds. Only then does it load from its folder: the library looks for a
 *  hub model's files at its main revision whatever revision is asked for, so offline it built a null
 *  tokenizer from a whole cache, and a folder a cut download left is not a model. */
const MODEL_FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model.onnx"];
/** A cut download's leftover part: `FileCache.put` writes `<file>.tmp.<pid>.<suffix>` and renames
 *  it into place, so the part is its writer's while that pid lives. */
export const CUT_PART = /\.tmp\.(\d+)\.[^/]*$/;

const keyOf = (words: string) => sha256(words).slice(0, 32);
const firstLine = (message: string) => (message.split("\n")[0] ?? "").slice(0, 200);

/** One stored row, or null for a line a kill tore, which is then embedded again. */
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

/** Writes one batch, or says why not, and a read goes on without its store. It opens with a
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
 *  `stopped` is the one line a reader prints where the embedder gave up, with what it finished kept;
 *  `unkept` the line it prints beside its reading where the store could not be written, with every
 *  vector still in hand. Each names the reader. */
export async function vectorLines(
  name: string,
  log: string,
  wanted: readonly string[],
  { store, load }: EmbedWays,
) {
  const file = join(folderOf(store, log), `vectors-${sha256(`${MODEL}@${REVISION}`).slice(0, 8)}.jsonl`);
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const vectors = new Map(lines.map(rowOf).filter((row) => row !== null));
  const { embedded, missing, stopped, unkept } = await embedMissing(vectors, wanted, { file, load });
  return {
    vectorOf: (words: string) => vectors.get(keyOf(words)) ?? new Float32Array(),
    embedded,
    stopped:
      stopped === null
        ? null
        : `${name}: no reading, the local model did not finish, ${String(embedded)} of ${String(missing)} texts embedded: ${stopped}`,
    unkept:
      unkept === null ? [] : [`${name}: the vector store cannot be written, so nothing is kept: ${unkept}`],
  };
}

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

async function localModel(): Promise<Embed> {
  const { env, pipeline } = await import("@huggingface/transformers");
  const cache = join(homedir(), ".cache", "huggingface", "transformers.js");
  const folder = join(cache, MODEL, REVISION);
  env.cacheDir = cache;
  const whole = MODEL_FILES.every((name) => existsSync(join(folder, name)));
  if (!whole && existsSync(folder)) dropCutWrites(folder, CUT_PART, { deep: true });
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
