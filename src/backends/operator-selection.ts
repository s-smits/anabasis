/**
 * The operator's backend selection files, read as one model.
 *
 * Two files say who serves a run's three slots: `.harness/backends/<slug>.json` and
 * `.harness/backends/default.json`. They combine per slot: the slug file supplies every slot it names,
 * and the default fills the rest. Run 15 showed why whole-file precedence was wrong.
 * `--built-backend claude` on a fresh project wrote `{built}` alone, that one key shadowed the
 * default entirely, the review slot resolved `unconfigured`, and 50 measured cases recorded `judge: "off"`
 * with no control census at all. Run 16, same code and no flag, read the default and ran 86 control
 * subjects per condition. `bb28.json` (builder only) and the partial project pin (builder + built) were
 * silently review-less the same way.
 *
 * A slot nobody named is not a slot somebody turned off. Only `{"review": {"disabled": true}}` says
 * off, which is why the write side (`project-backends.ts`) states it instead of deleting the key.
 *
 * This module checks the file structure and combines selections. Every field stays `unknown` and no
 * value is validated here: which values are legal, and which slot may carry which key, belongs to the
 * resolver (`resolve.ts`, `resolve-side.ts`), so one refusal can name both the file and the slot.
 */
import { join } from "../meta/path.ts";
import type { BackendSlot } from "./backend-kinds.ts";
import { readOptionalConfigFile } from "./config-file.ts";
import { isRecord } from "../meta/json-shape.ts";

/** Where operator selection files live, relative to the repo root. One owner for the path: the
 *  writer (`project-backends.ts`) builds its target from this constant. */
export const OPERATOR_BACKENDS_DIR = ".harness/backends";

/**
 * The slug-agnostic file. An automatic project's initial id is `<stem>-<sha256[0:8]>`
 * (`src/run/full-run-launch.ts`), so an operator cannot name `<slug>.json` in advance — which is how
 * run 4 measured with both judges disabled while the intended selection sat in `short-request.json`,
 * named for the user's request rather than its derived slug. This file is the standing selection
 * for every slot no slug file names.
 */
const OPERATOR_BACKENDS_DEFAULT = "default.json";

/** What a file may say about one slot. Values stay untyped on purpose — this is the declared shape,
 *  and each field's meaning is completed by the slot's resolver. `disabled` is review-only: a slot
 *  that serves a measured run has no off state, and `resolveSide` refuses the key there instead of
 *  ignoring it. */
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
    /** Repo-relative, highest precedence first. Empty when the operator pinned nothing — a slot
     *  reading `source: "default"` beside an empty list is the silent fallback stated out loud. */
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

/** Only ENOENT is absence. Unreadable files and unknown shapes refuse before a provider default can
 *  replace the operator's intended condition. An unknown root, the former `judge` slot included,
 *  refuses as a typo.
 *
 *  Read as JSON5, which is a strict superset of JSON: every backends file that parsed before still
 *  parses to the same value, and an operator may now write a comment beside a slot. These files
 *  encode which three-slot condition a run is — the Sol and Opus 5 rows differ only in three
 *  `kind` fields — and the file alone could not say which one it meant. Malformed bytes still
 *  refuse; JSON5 adds spellings, not tolerance. */
function readOperatorConfig(path: string, source: string): OperatorConfig | null {
  const raw = readOptionalConfigFile(path, `operator backends file ${source}`);
  if (raw === null) return null;
  const parsed: unknown = Bun.JSON5.parse(raw);
  if (parsed == null || !isRecord(parsed)) {
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
