/**
 * The text members of a zip archive, as a workbook, a document or a deck is one, read with the
 * runtime's own inflate. A check imports nothing, so without them it holds such a file as base64
 * alone and would have to inflate it by hand. Only stored and deflated members are read, and every
 * member counts its inflated bytes against `most`, an image too, since only its bytes tell that it
 * holds no text; a member whose bytes are not UTF-8 is then left out. An archive this reader cannot
 * walk, or one past `most`, gives no members at all, so a check never reads part of a file as the
 * whole and the file's bytes stay the whole of what it has.
 */
import { inflateRawSync } from "node:zlib";

const LOCAL = 0x04_03_4b_50;
const CENTRAL = 0x02_01_4b_50;
const END = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const NONE = { members: [], used: 0 };

/** The archive's text members within `most` inflated bytes, and the bytes they took. */
export function zipTexts(
  bytes: Buffer,
  most: number,
): { members: { readonly path: string; readonly text: string }[]; used: number } {
  try {
    if (bytes.readUInt32LE(0) !== LOCAL) return NONE;
    // The end record sits in the last 22 bytes and the at most 0xffff of its comment.
    const end = bytes.lastIndexOf(END, bytes.length - 22);
    if (end === -1 || end < bytes.length - 22 - 0xff_ff) return NONE;
    const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const members: { readonly path: string; readonly text: string }[] = [];
    let used = 0;
    let at = bytes.readUInt32LE(end + 16);
    for (let left = bytes.readUInt16LE(end + 10); left > 0; left -= 1) {
      if (bytes.readUInt32LE(at) !== CENTRAL) return NONE;
      const method = bytes.readUInt16LE(at + 10);
      const packed = bytes.readUInt32LE(at + 20);
      const size = bytes.readUInt32LE(at + 24);
      const named = bytes.readUInt16LE(at + 28);
      const path = bytes.toString("utf8", at + 46, at + 46 + named);
      const local = bytes.readUInt32LE(at + 42);
      at += 46 + named + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
      if ((method !== 0 && method !== 8) || path.endsWith("/")) continue;
      used += size;
      if (used > most || bytes.readUInt32LE(local) !== LOCAL) return NONE;
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const raw = bytes.subarray(start, start + packed);
      // `maxOutputLength` refuses 0, and an empty member may still be stored deflated.
      const data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      if (data.length !== size) return NONE;
      try {
        members.push({ path, text: utf8.decode(data) });
      } catch {
        /* A binary member, such as an image, has no text. */
      }
    }
    return { members, used };
  } catch {
    return NONE;
  }
}
