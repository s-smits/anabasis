import { crc32, inflateRawSync } from "node:zlib";

const LOCAL = 0x04_03_4b_50;
const CENTRAL = 0x02_01_4b_50;
const END = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const NONE = { members: [], used: 0 };

export function zipMembers(
  bytes: Buffer,
  most: number,
): { members: { readonly path: string; readonly data: Buffer }[]; used: number } {
  try {
    if (bytes.readUInt32LE(0) !== LOCAL) return NONE;
    const end = bytes.lastIndexOf(END, bytes.length - 22);
    if (end === -1 || end < bytes.length - 22 - 0xff_ff) return NONE;
    const members: { readonly path: string; readonly data: Buffer }[] = [];
    const seen = new Set<string>();
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
      if (seen.has(path)) return NONE;
      seen.add(path);
      used += size;
      if (used > most || bytes.readUInt32LE(local) !== LOCAL) return NONE;
      const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
      const raw = bytes.subarray(start, start + packed);
      const data = method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      if (data.length !== size) return NONE;
      members.push({ path, data });
    }
    return { members, used };
  } catch {
    return NONE;
  }
}

export function zipTexts(
  bytes: Buffer,
  most: number,
): { members: { readonly path: string; readonly text: string }[]; used: number } {
  const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const { members: raw, used } = zipMembers(bytes, most);
  const members = raw.flatMap(({ path, data }) => {
    try {
      return [{ path, text: utf8.decode(data) }];
    } catch {
      return [];
    }
  });
  return { members, used };
}

export function storedZip(
  members: readonly { readonly path: string; readonly text: string | Buffer }[],
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { path, text } of members) {
    const name = Buffer.from(path);
    const data = Buffer.from(text);
    const fields = Buffer.alloc(24);
    fields.writeUInt16LE(0x08_00, 0);
    fields.writeUInt32LE(crc32(data), 8);
    fields.writeUInt32LE(data.length, 12);
    fields.writeUInt32LE(data.length, 16);
    fields.writeUInt16LE(name.length, 20);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(LOCAL, 0);
    fields.copy(head, 6);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0);
    fields.copy(central, 8);
    central.writeUInt32LE(offset, 42);
    locals.push(head, name, data);
    centrals.push(central, name);
    offset += head.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  END.copy(end);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
