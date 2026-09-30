/**
 * The TOML encoder Harbor writes `task.toml` with: `toml` 0.10.2 (https://github.com/uiri/toml,
 * `toml/encoder.py`), ported to TypeScript line for line with its names and messages. Python's types
 * map as str → string, float → number, int → bigint, bool → boolean, None → null, list → array and
 * dict → plain object, so `dump_funcs` becomes a `typeof` dispatch.
 *
 * Rewritten because TypeScript has no equivalent: `repr()` of a string (`python_str_repr`) and of a
 * float (`python_float_repr`), and `id()` (object identity). Left out, since Harbor's dump never
 * reaches them: `dump` to a file, the datetime, time, date and Decimal writers, inline-table
 * preservation and the `TomlPreserveInlineDictEncoder` and `TomlArraySeparatorEncoder` subclasses.
 *
 * Kept as upstream writes it: a string holding a control character loses the backslash of each
 * `\xNN` and one of each escaped backslash, so that line is not valid TOML, and one that starts with
 * a control character raises `IndexError`.
 */

export type TomlValue = string | number | bigint | boolean | null | TomlValue[] | TomlTable;
export type TomlTable = { [key: string]: TomlValue };

/** Python's `isprintable()` is false for these categories, and true for every other character and
 *  for the ASCII space. */
const UNPRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

const isTable = (value: TomlValue | undefined): value is TomlTable =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `repr(str)`: single quotes unless the text holds one and no double quote, and `\xNN`, `\uNNNN`
 *  or `\UNNNNNNNN` for a character Python does not print. */
function python_str_repr(v: string): string {
  const quote = v.includes("'") && !v.includes('"') ? '"' : "'";
  const hex = (code: number, width: number) => code.toString(16).padStart(width, "0");
  let out = quote;
  for (const ch of v) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === quote || ch === "\\") out += `\\${ch}`;
    else if (ch === "\t") out += String.raw`\t`;
    else if (ch === "\n") out += String.raw`\n`;
    else if (ch === "\r") out += String.raw`\r`;
    else if (code < 0x20 || code === 0x7f) out += `\\x${hex(code, 2)}`;
    else if (code < 0x7f || ch === " " || !UNPRINTABLE.test(ch)) out += ch;
    else if (code <= 0xff) out += `\\x${hex(code, 2)}`;
    else if (code <= 0xffff) out += `\\u${hex(code, 4)}`;
    else out += `\\U${hex(code, 8)}`;
  }
  return out + quote;
}

/** `"{}".format(float)`: the shortest digits that read back, with `.0` on a whole number, and an
 *  exponent of at least two digits below 1e-4 and from 1e16. */
function python_float_repr(v: number): string {
  if (Number.isNaN(v)) return "nan";
  if (!Number.isFinite(v)) return v > 0 ? "inf" : "-inf";
  const [mantissa = "", exponent = "0"] = v.toExponential().split("e");
  const e = Number(exponent);
  if (e < -4 || e >= 16) return `${mantissa}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  const fixed = Object.is(v, -0) ? "-0" : String(v);
  return fixed.includes(".") ? fixed : `${fixed}.0`;
}

/** `type(v).__name__` for a value TypeScript holds. */
function python_type_name(v: TomlValue): string {
  if (v === null) return "NoneType";
  if (Array.isArray(v)) return "list";
  if (typeof v === "bigint") return "int";
  if (typeof v === "number") return "float";
  if (typeof v === "string") return "str";
  if (typeof v === "boolean") return "bool";
  return "dict";
}

/** Stringifies input dict as toml */
export function dumps(o: TomlTable): string {
  let retval = "";
  const [addtoretval, first] = dump_sections(o, "");
  retval += addtoretval;
  let sections = first;
  const outer_objs: TomlTable[] = [o];
  while (Object.keys(sections).length > 0) {
    const section_ids = Object.values(sections);
    for (const outer_obj of outer_objs) {
      if (section_ids.includes(outer_obj)) throw new Error("Circular reference detected");
    }
    outer_objs.push(...section_ids);
    const newsections: Record<string, TomlTable> = {};
    for (const [section, table] of Object.entries(sections)) {
      const [addto, addtosections] = dump_sections(table, section);
      if (addto || (!addto && Object.keys(addtosections).length === 0)) {
        if (retval && retval.slice(-2) !== "\n\n") retval += "\n";
        retval += `[${section}]\n`;
        if (addto) retval += addto;
      }
      for (const [s, sub] of Object.entries(addtosections)) newsections[`${section}.${s}`] = sub;
    }
    sections = newsections;
  }
  return retval;
}

function _dump_str(value: string): string {
  let v = python_str_repr(value);
  const singlequote = v.startsWith("'");
  if (singlequote || v.startsWith('"')) v = v.slice(1, -1);
  if (singlequote) {
    v = v.replaceAll(String.raw`\'`, "'");
    v = v.replaceAll('"', String.raw`\"`);
  }
  let parts = v.split(String.raw`\x`);
  while (parts.length > 1) {
    let i = -1;
    if ((parts[0] ?? "") === "") parts = parts.slice(1);
    const head = (parts[0] ?? "").replaceAll(String.raw`\\`, "\\");
    // No, I don't know why != works and == breaks
    let joinx = head.at(i) !== "\\";
    while (head.slice(0, i) && head.at(i) === "\\") {
      joinx = !joinx;
      i -= 1;
    }
    const joiner = joinx ? "x" : "u00";
    const next = parts[1];
    if (next === undefined) throw new RangeError("IndexError: list index out of range");
    parts = [head + joiner + next, ...parts.slice(2)];
  }
  return `"${parts[0] ?? ""}"`;
}

function _dump_float(v: number): string {
  return python_float_repr(v).replaceAll("e+0", "e+").replaceAll("e-0", "e-");
}

function dump_list(v: readonly TomlValue[]): string {
  let retval = "[";
  for (const u of v) retval += ` ${dump_value(u)},`;
  retval += "]";
  return retval;
}

function dump_value(v: TomlValue): string {
  if (typeof v === "string") return _dump_str(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "bigint") return String(v);
  if (typeof v === "number") return _dump_float(v);
  if (Array.isArray(v)) return dump_list(v);
  // `_dump_str(None)`: repr(None) is None, which has no quotes to strip.
  if (v === null) return '"None"';
  // A dict iterates over its keys, so it dumps as the list of them.
  return dump_list(Object.keys(v));
}

function dump_sections(o: TomlTable, supIn: string): [string, Record<string, TomlTable>] {
  let retstr = "";
  const sup = supIn !== "" && supIn.at(-1) !== "." ? `${supIn}.` : supIn;
  const retdict: Record<string, TomlTable> = {};
  let arraystr = "";
  for (const [section, value] of Object.entries(o)) {
    const qsection = /^[A-Za-z0-9_-]+$/.test(section) ? section : _dump_str(section);
    if (isTable(value)) {
      retdict[qsection] = value;
    } else if (Array.isArray(value) && value.some((a) => isTable(a))) {
      for (const a of value) {
        if (!isTable(a)) throw new TypeError(`'${python_type_name(a)}' object is not iterable`);
        let arraytabstr = "\n";
        arraystr += `[[${sup}${qsection}]]\n`;
        const [s, first] = dump_sections(a, sup + qsection);
        if (s) {
          if (s[0] === "[") arraytabstr += s;
          else arraystr += s;
        }
        let d = first;
        while (Object.keys(d).length > 0) {
          const newd: Record<string, TomlTable> = {};
          for (const [dsec, table] of Object.entries(d)) {
            const [s1, d1] = dump_sections(table, `${sup}${qsection}.${dsec}`);
            if (s1) {
              arraytabstr += `[${sup}${qsection}.${dsec}]\n`;
              arraytabstr += s1;
            }
            for (const [key, sub] of Object.entries(d1)) newd[`${dsec}.${key}`] = sub;
          }
          d = newd;
        }
        arraystr += arraytabstr;
      }
    } else if (value !== null) {
      retstr += `${qsection} = ${dump_value(value)}\n`;
    }
  }
  retstr += arraystr;
  return [retstr, retdict];
}
