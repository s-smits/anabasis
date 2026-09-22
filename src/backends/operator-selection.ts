/**
 * The operator's backend selection files, read as one model.
 *
 * Two files say who serves a run's three slots: `.harness/backends/<slug>.json` and
 * `.harness/backends/default.json`. They combine per slot: the slug file supplies every slot it
 * names, and the default fills the rest.
 *
 * A slot nobody named is not a slot somebody turned off. Only `{"review": {"disabled": true}}` says
 * off, which is why the write side (`project-backends.ts`) states it instead of deleting the key.
 *
 * This module checks file structure only. Values stay `unknown`; the resolvers (`resolve.ts`,
 * `resolve-side.ts`) validate them, so one refusal can name both the file and the slot.
 */
import { join } from "../meta/path.ts";
import type { BackendSlot } from "./backend-kinds.ts";
import { readOptionalConfigFile } from "./config-file.ts";
import { isRecord } from "../meta/json-shape.ts";

/** Where operator selection files live, relative to the repo root; the writer uses it too. */
export const OPERATOR_BACKENDS_DIR = ".harness/backends";

/**
 * The standing selection for every slot no slug file names. An automatic project's id is derived,
 * so an operator cannot name `<slug>.json` in advance.
 */
const OPERATOR_BACKENDS_DEFAULT = "default.json";

/** What a file may say about one slot; the slot's resolver validates each value. `disabled` and
 *  `inherit` are review-only. */
interface OperatorSideConfig {
  kind?: unknown;
  model?: unknown;
  inherit?: unknown;
  disabled?: unknown;
}

/** One file's content: the three slots, each optional. */
type OperatorConfig = Partial<Record<BackendSlot, OperatorSideConfig>>;

const OPERATOR_SLOTS: readonly BackendSlot[] = ["builder", "built", "review"];
const OPERATOR_ROOT_KEYS = new Set<string>(OPERATOR_SLOTS);
const OPERATOR_SIDE_KEYS = new Set(["kind", "model", "inherit", "disabled"]);

/** One slot's selection: what the winning file said, and the file a refusal about it names. */
export interface OperatorPin {
  /** Undefined when no file named this slot — an env pin or the slot default decides it instead. */
  side: OperatorSideConfig | undefined;
  /** The file that named the slot; the leading file read when none did; null when none exist. */
  path: string | null;
}

/** The layered selection: which files were read, and who won each slot. */
export class OperatorSelection {
  private constructor(
    /** Repo-relative, highest precedence first; empty when the operator pinned nothing. */
    readonly files: readonly string[],
    private readonly pins: ReadonlyMap<BackendSlot, { side: OperatorSideConfig; path: string }>,
  ) {}

  static read(repoRoot: string, slug: string): OperatorSelection {
    const files: string[] = [];
    const pins = new Map<BackendSlot, { side: OperatorSideConfig; path: string }>();
    // Lowest precedence first, so the slug file overwrites the default one slot at a time.
    for (const name of [OPERATOR_BACKENDS_DEFAULT, `${slug}.json`]) {
      const path = `${OPERATOR_BACKENDS_DIR}/${name}`;
      const config = readOperatorConfig(join(repoRoot, path), path);
      if (config === null) continue;
      files.unshift(path);
      for (const slot of OPERATOR_SLOTS) {
        const side = config[slot];
        if (side !== undefined) pins.set(slot, { side, path });
      }
    }
    return new OperatorSelection(files, pins);
  }

  /** The selection for one slot, and the file to name if its values are invalid. */
  pin(slot: BackendSlot): OperatorPin {
    return this.pins.get(slot) ?? { side: undefined, path: this.files[0] ?? null };
  }
}

function parseOperatorSide(value: unknown, source: string, slot: BackendSlot): OperatorSideConfig {
  if (!isRecord(value)) throw new Error(`operator backends file ${source}: ${slot} must be a JSON object`);
  const unknown = Object.keys(value).filter((key) => !OPERATOR_SIDE_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `operator backends file ${source}: ${slot} has unknown field(s) [${unknown.join(", ")}]; choose from [kind, model, inherit, disabled]`,
    );
  }
  return value;
}

/** Only ENOENT is absence. Unreadable files, unknown shapes and unknown roots refuse, so a provider
 *  default never replaces the operator's intended condition. Read as JSON5 so an operator may
 *  comment a slot; malformed bytes still refuse. */
function readOperatorConfig(path: string, source: string): OperatorConfig | null {
  const raw = readOptionalConfigFile(path, `operator backends file ${source}`);
  if (raw === null) return null;
  const parsed: unknown = Bun.JSON5.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`operator backends file ${source} must be a JSON object`);
  }
  const unknown = Object.keys(parsed).filter((key) => !OPERATOR_ROOT_KEYS.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `operator backends file ${source} has unknown slot(s) [${unknown.join(", ")}]; choose from [builder, built, review]`,
    );
  }
  const config: OperatorConfig = {};
  for (const slot of OPERATOR_SLOTS) {
    if (parsed[slot] !== undefined) config[slot] = parseOperatorSide(parsed[slot], source, slot);
  }
  return config;
}
