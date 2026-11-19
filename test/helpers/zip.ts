/** A zip archive of `[path, text, deflated]` members, laid out as a workbook is. */
export function zipOf(members: readonly (readonly [string, string, boolean])[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [path, text, deflated] of members) {
    const name = Buffer.from(path);
    const data = Buffer.from(text, "latin1");
    const packed = deflated ? Buffer.from(Bun.deflateSync(data)) : data;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04_03_4b_50, 0);
    head.writeUInt16LE(deflated ? 8 : 0, 8);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE(deflated ? 8 : 0, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(head, name, packed);
    centrals.push(central, name);
    offset += head.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06_05_4b_50, 0);
  end.writeUInt16LE(members.length, 8);
  end.writeUInt16LE(members.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
