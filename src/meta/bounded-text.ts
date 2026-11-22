import { plural } from "./text.ts";

/**
 * The one way this repository cuts a text to a size: truncation in UTF-8 bytes and whole
 * lines, applied to the trimmed text and trimmed again at the cut.
 */
interface BoundedText {
  /** The kept text: at most `maxBytes` UTF-8 bytes, trimmed at both ends. */
  readonly text: string;
  /** True when anything of the trimmed input was left out. */
  readonly truncated: boolean;
  /** UTF-8 bytes of the trimmed input. */
  readonly totalBytes: number;
  /** `text`, marked with the bytes left out when the cut removed any. */
  readonly shown: string;
}

const encoder = new TextEncoder();

/** The longest part of `line` at the requested edge, ending on whole code points. */
function partOfLine(line: string, maxBytes: number, keep: "head" | "tail"): string {
  let bytes = 0;
  let length = 0;
  const points = keep === "head" ? line : Array.from(line).toReversed();
  for (const point of points) {
    bytes += encoder.encode(point).byteLength;
    if (bytes > maxBytes) break;
    length += point.length;
  }
  return keep === "head" ? line.slice(0, length) : line.slice(line.length - length);
}

/** Whole lines in the requested direction, or a partial boundary line when none fits. */
function linesWithin(text: string, maxBytes: number, maxLines: number, keep: "head" | "tail"): string {
  const lines = text.split("\n");
  const ordered = keep === "head" ? lines : lines.toReversed();
  const kept: string[] = [];
  let bytes = 0;
  for (const line of ordered) {
    if (kept.length >= maxLines) break;
    const size = encoder.encode(line).byteLength + (kept.length === 0 ? 0 : 1);
    if (bytes + size > maxBytes) {
      if (kept.length === 0) kept.push(partOfLine(line, maxBytes, keep));
      break;
    }
    kept.push(line);
    bytes += size;
  }
  return (keep === "head" ? kept : kept.toReversed()).join("\n");
}

/**
 * Cut `text` to at most `maxBytes` bytes and `maxLines` lines, keeping its head or its tail.
 */
export function boundText(
  text: string,
  maxBytes: number,
  keep: "head" | "tail" = "head",
  maxLines = Number.POSITIVE_INFINITY,
): BoundedText {
  const whole = text.trim();
  const totalBytes = encoder.encode(whole).byteLength;
  const kept = linesWithin(whole, maxBytes, maxLines, keep);
  const bounded = keep === "head" ? kept.trimEnd() : kept.trimStart();
  const truncated = bounded.length < whole.length;
  if (!truncated) return { text: bounded, truncated, totalBytes, shown: bounded };
  const left = totalBytes - encoder.encode(bounded).byteLength;
  const omitted = `[…${plural(left, "byte")} omitted]`;
  const shown =
    bounded === "" ? omitted : keep === "head" ? `${bounded} ${omitted}` : `${omitted} ${bounded}`;
  return { text: bounded, truncated, totalBytes, shown };
}
