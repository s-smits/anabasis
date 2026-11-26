import io, json, posixpath, re, sys, xml.etree.ElementTree as ET, zipfile

ERRORS = {"#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!"}
CELL_REF = re.compile(r"(?<![A-Za-z0-9_])\$?[A-Z]{1,3}\$?\d+(?![A-Za-z0-9_(])|[A-Za-z_][\w.]*!")
UNDECLARED_NS = re.compile(r"</?([A-Za-z_][\w.-]*):")
MAX_MEMBER_BYTES = 16 * 1024 * 1024
MAX_DB_CELL_CHARS = 2000
MAX_DB_CHARS = 500_000
MAX_SQLITE_LENGTH = 16 * 1024 * 1024
tag = lambda el: el.tag.rsplit("}", 1)[-1].rsplit(":", 1)[-1]
num = lambda path: int(m.group(1)) if (m := re.search(r"(\d+)\.xml$", path)) else 0
text_of = lambda el, name: "".join(n.text or "" for n in el.iter() if tag(n) == name)

def read_member(zf, path):
    if zf.getinfo(path).file_size > MAX_MEMBER_BYTES:
        raise ValueError(f"{path} exceeds {MAX_MEMBER_BYTES} byte limit")
    with zf.open(path) as f:
        data = f.read(MAX_MEMBER_BYTES + 1)
    if len(data) > MAX_MEMBER_BYTES:
        raise ValueError(f"{path} exceeds {MAX_MEMBER_BYTES} byte limit")
    return data

def parse_xml(raw):
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        s = raw.decode("utf-8", "replace")
        prefixes = {p for p in UNDECLARED_NS.findall(s) if p != "xml"}
        decls = "".join(f' xmlns:{p}="urn:x:{p}"' for p in sorted(prefixes) if f"xmlns:{p}=" not in s)
        return ET.fromstring(re.sub(r"(<[A-Za-z_][\w.:-]*)", lambda m: m.group(1) + decls, s, count=1))

def paras(raw):
    return "\n".join(line for p in parse_xml(raw).iter() if tag(p) == "p" and (line := text_of(p, "t")))

def visuals_note(names, prefix, charts=None):
    imgs = sum(1 for n in names if n.startswith(prefix) and not n.endswith("/"))
    ch = sum(1 for n in names if charts and re.match(charts, n))
    parts = [f"{imgs} image(s)"] if imgs else []
    if ch:
        parts.append(f"{ch} chart(s)")
    return [f"embedded visuals: {', '.join(parts)}"] if parts else []

def docx(zf):
    root = parse_xml(read_member(zf, "word/document.xml"))
    body = next((n for n in root if tag(n) == "body"), root)
    lines = []
    for node in body:
        kind = tag(node)
        if kind == "p" and (line := text_of(node, "t")):
            lines.append(line)
        elif kind == "tbl":
            for tr in node:
                if tag(tr) == "tr":
                    cells = [text_of(tc, "t").replace("\t", " ") for tc in tr if tag(tc) == "tc"]
                    if any(cells):
                        lines.append("\t".join(cells))
    return {"text": "\n".join(lines), "formulas": None, "notes": visuals_note(zf.namelist(), "word/media/")}

def xlsx(zf, max_cells, max_empty):
    all_names = zf.namelist()
    name_set = set(all_names)
    shared = []
    if "xl/sharedStrings.xml" in name_set:
        shared = [text_of(si, "t") for si in parse_xml(read_member(zf, "xl/sharedStrings.xml")).iter() if tag(si) == "si"]
    ordered = []
    seen = set()
    if "xl/workbook.xml" in name_set and "xl/_rels/workbook.xml.rels" in name_set:
        rels = {r.attrib.get("Id"): r.attrib.get("Target", "").lstrip("/") for r in parse_xml(read_member(zf, "xl/_rels/workbook.xml.rels")).iter() if tag(r) == "Relationship"}
        for s in parse_xml(read_member(zf, "xl/workbook.xml")).iter():
            if tag(s) == "sheet":
                rid = next((v for k, v in s.attrib.items() if k.endswith("}id") or k == "r:id"), "")
                if (t := rels.get(rid)):
                    norm = posixpath.normpath(t if t.startswith("xl/") else f"xl/{t}")
                    if norm in name_set and norm not in seen:
                        seen.add(norm)
                        ordered.append((norm, s.attrib.get("name", t)))
    for path in sorted((p for p in all_names if p not in seen and re.match(r"^xl/worksheets/sheet\d+\.xml$", p)), key=num):
        label = path[len("xl/worksheets/"):] if path.startswith("xl/worksheets/") else path
        ordered.append((path, label))
    counts = {"cachedEvaluated": 0, "uncachedFormula": 0, "formulaError": 0, "zeroRefFormulaCount": 0}
    out = []
    dims = []
    for path, title in ordered:
        cells = empty = max_cols = 0
        rows = []
        for row in parse_xml(read_member(zf, path)).iter():
            if tag(row) != "row":
                continue
            if cells >= max_cells or empty >= max_empty:
                break
            vals = []
            for c in row:
                if tag(c) != "c":
                    continue
                cells += 1
                ctype = c.attrib.get("t")
                f = next((n for n in c if tag(n) == "f"), None)
                v = next((n for n in c if tag(n) == "v"), None)
                vtxt = None if v is None else (v.text or "")
                shown = shared[int(vtxt)] if ctype == "s" and vtxt and vtxt.isascii() and vtxt.isdigit() and int(vtxt) < len(shared) else text_of(c, "t") if ctype == "inlineStr" else (vtxt or "")
                if f is not None:
                    ftxt = f.text or ""
                    if ctype == "e" or shown in ERRORS:
                        counts["formulaError"] += 1
                    elif v is None:
                        counts["uncachedFormula"] += 1
                    else:
                        counts["cachedEvaluated"] += 1
                    if ftxt and not CELL_REF.search(ftxt):
                        counts["zeroRefFormulaCount"] += 1
                    vals.append(f"={ftxt}" if v is None else shown)
                else:
                    vals.append(shown)
            empty = empty + 1 if all(x == "" for x in vals) else 0
            max_cols = max(max_cols, len(vals))
            rows.append("\t".join(vals))
        dims.append(f"{title} ({len(rows)}x{max_cols})")
        out.append(f"## {title}\n" + "\n".join(rows))
    notes = ([f"sheets: {', '.join(dims)}"] if dims else []) + visuals_note(all_names, "xl/media/", r"^xl/charts/chart\d+\.xml$")
    return {"text": "\n\n".join(out), "formulas": counts, "notes": notes}

def db(raw):
    import sqlite3
    buf = bytearray(raw)
    if len(buf) >= 20 and (buf[18] == 2 or buf[19] == 2):
        buf[18] = 1
        buf[19] = 1
    con = sqlite3.connect(":memory:")
    try:
        con.deserialize(bytes(buf))
        con.execute("PRAGMA trusted_schema = OFF")
        con.execute("PRAGMA query_only = ON")
        if hasattr(con, "setlimit"):
            con.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, MAX_SQLITE_LENGTH)
        con.text_factory = lambda b: b.decode("utf-8", "replace")
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        indexes = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")]
        blocks = []
        counts = []
        total = 0
        for tbl in tables:
            q = tbl.replace('"', '""')
            counts.append(f"{tbl} ({con.execute(f'SELECT COUNT(*) FROM \"{q}\"').fetchone()[0]} rows)")
            cols = [r[1] for r in con.execute(f'PRAGMA table_info("{q}")')]
            if not cols:
                blocks.append(f"## {tbl}")
                continue
            exprs = []
            for c in cols:
                qc = '"' + c.replace('"', '""') + '"'
                exprs.append(
                    f"CASE WHEN {qc} IS NULL THEN '' "
                    f"WHEN typeof({qc}) = 'blob' THEN '<blob ' || length({qc}) || ' bytes>' "
                    f"WHEN length(CAST({qc} AS TEXT)) > {MAX_DB_CELL_CHARS} "
                    f"THEN substr(CAST({qc} AS TEXT), 1, {MAX_DB_CELL_CHARS}) || '\u2026' "
                    f"ELSE CAST({qc} AS TEXT) END"
                )
            rows = []
            for r in con.execute(f'SELECT {", ".join(exprs)} FROM "{q}" LIMIT 50'):
                line = "\t".join("" if v is None else str(v) for v in r)
                total += len(line)
                if total > MAX_DB_CHARS:
                    rows.append("[truncated]")
                    break
                rows.append(line)
            blocks.append(f"## {tbl}\n" + "\t".join(cols) + ("\n" + "\n".join(rows) if rows else ""))
            if total > MAX_DB_CHARS:
                break
        notes = ([f"tables: {', '.join(counts)}"] if counts else []) + ([f"indexes: {', '.join(indexes)}"] if indexes else [])
        return {"text": "\n\n".join(blocks), "formulas": None, "notes": notes}
    finally:
        con.close()

mode, max_cells, max_empty = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
raw = sys.stdin.buffer.read()
if mode == "sqlite":
    res = db(raw)
else:
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        if mode == "xlsx":
            res = xlsx(zf, max_cells, max_empty)
        elif mode == "docx":
            res = docx(zf)
        else:
            slides = sorted((p for p in zf.namelist() if re.match(r"^ppt/slides/slide\d+\.xml$", p)), key=num)
            res = {"text": "\n\n".join(f"## slide {num(p)}\n{paras(read_member(zf, p))}" for p in slides), "formulas": None, "notes": visuals_note(zf.namelist(), "ppt/media/")}
sys.stdout.write(json.dumps(res))
