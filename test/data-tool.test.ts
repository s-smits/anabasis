import { expect, test } from "bun:test";
import { dataTool } from "../src/correctness-bundle/data-tool.ts";
import { commitPublicTask } from "../src/correctness-bundle/task-split.ts";

test("controller SQL queries a fixed public snapshot and bounds hostile statements", async () => {
  const original = {
    taskId: "first",
    family: "data",
    publicInput: {
      rows: [
        { id: "a", n: 2 },
        { id: "b", n: 3 },
      ],
    },
    hidden: "PRIVATE_ANSWER",
  };
  const resources = [
    {
      name: "catalogue",
      content: [
        { id: "a", rate: 10 },
        { id: "b", rate: 20 },
      ],
      digest: "public-digest",
    },
  ];
  const reader = dataTool(commitPublicTask(original).view(), resources);
  original.publicInput.rows[0]!.n = 999;
  resources[0]!.content[0]!.rate = 999;
  const query = async (sql?: string) => {
    const result = await reader.execute(
      "test",
      /* SAFETY: requests exercise the declared optional string sql parameter. */ (sql === undefined
        ? {}
        : { sql }) as never,
    );
    return result.details;
  };
  expect(await query()).toMatchObject({ ok: true, dialect: "sqlite" });
  expect(
    await query(
      "SELECT SUM(json_extract(a.value,'$.n') * json_extract(b.value,'$.rate')) AS total FROM task, json_each(task.json,'$.publicInput.rows') a, resources, json_each(resources.json) b WHERE json_extract(a.value,'$.id') = json_extract(b.value,'$.id')",
    ),
  ).toMatchObject({ ok: true, rows: [{ total: 80 }] });
  expect(await query("SELECT json_extract(json,'$.hidden') AS hidden FROM task")).toMatchObject({
    rows: [{ hidden: null }],
  });
  for (const sql of [
    "DELETE FROM task",
    "ATTACH DATABASE '/etc/passwd' AS secret",
    "SELECT readfile('/etc/passwd')",
    "SELECT load_extension('/tmp/evil')",
    "SELECT randomblob(100000000)",
    "SELECT 1; DELETE FROM task",
  ]) {
    expect(await query(sql)).toMatchObject({ ok: false });
  }
  // Escaping the wrapper can only change the first SELECT; subsequent statements never execute.
  expect(await query("SELECT 1) ; DELETE FROM task; --")).toMatchObject({ ok: true });
  // An aggregate comes back as a number, so the solver can use it without parsing it first;
  // past 2^53 it stays a decimal string, where a JSON number would round it.
  expect(await query("SELECT count(*) AS n FROM task")).toMatchObject({ rows: [{ n: 1 }] });
  expect(
    await query("SELECT 9007199254740993 AS big, -9007199254740993 AS small, 9007199254740991 AS edge"),
  ).toMatchObject({
    rows: [{ big: "9007199254740993", small: "-9007199254740993", edge: 9007199254740991 }],
  });
  expect(
    await query("WITH RECURSIVE r(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM r WHERE n<102) SELECT n FROM r"),
  ).toMatchObject({ ok: true, truncated: true });
  expect(await query("SELECT printf('%40000s','x') AS long")).toMatchObject({
    ok: true,
    rows: [],
    truncated: true,
  });
  expect(
    await query("WITH RECURSIVE r(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM r) SELECT sum(n) FROM r"),
  ).toMatchObject({ ok: false });
  const second = dataTool({ taskId: "second", family: "data", publicInput: {} }, []);
  const result = await second.execute(
    "test",
    /* SAFETY: the SQL string uses the declared parameter. */ {
      sql: "SELECT json_extract(json,'$.taskId') AS id FROM task",
    } as never,
  );
  expect(result.details).toMatchObject({ rows: [{ id: "second" }] });
});
