import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { runSync, decodeOutput } from "../meta/subprocess.ts";
import { runtimeProcess } from "../meta/process.ts";
import { isString, type JsonValue } from "../meta/json-shape.ts";
import { requireJsonValue } from "../meta/stable-json.ts";
import { DATA_READER_TOOL } from "./data-session.ts";
import type { PublicBriefResource } from "./public-resources.ts";
import type { PublicTask } from "./task-split.ts";

const bunExecutable = runtimeProcess.execPath;
const nativeFreeze = Object.freeze.bind(Object);
const Params = Type.Object({ sql: Type.Optional(Type.String({ maxLength: 16000 })) });

// SQL executes in a disposable process with only in-memory, controller-projected public data.
// The outer SELECT and query_only forbid writes; SQLite prepares just that first statement.
// No generated reader, database file, extension, credentials or connection string is loaded.
const QUERY_WORKER = `
import { Database } from 'bun:sqlite';
const { task, resources, sql } = JSON.parse(await Bun.stdin.text());
const db = new Database(':memory:', { safeIntegers: true });
db.exec('PRAGMA hard_heap_limit=33554432; CREATE TABLE task(json TEXT); CREATE TABLE resources(name TEXT, json TEXT, digest TEXT)');
db.query('INSERT INTO task VALUES (?)').run(JSON.stringify(task));
for (const r of resources) db.query('INSERT INTO resources VALUES (?, ?, ?)').run(r.name, JSON.stringify(r.content), r.digest);
db.exec('PRAGMA query_only=ON');
try {
  const rows = [];
  let truncated = false;
  const SAFE = 9007199254740991n;
  const encode = value => JSON.stringify(value, (_, v) =>
    typeof v === 'bigint' ? (v >= -SAFE && v <= SAFE ? Number(v) : v.toString()) : v);
  const query = db.prepare('SELECT * FROM (' + sql + '\\n) LIMIT 101');
  for (const row of query.iterate()) {
    if (rows.length === 100 || Buffer.byteLength(encode({ok:true, rows:[...rows, row], truncated:false})) > 30000) { truncated = true; break; }
    rows.push(row);
  }
  console.log(encode({ ok: true, rows, truncated }));
} catch (error) { console.log(JSON.stringify({ok:false, error:String(error).slice(0,1000)})); }
finally { db.close(); }
`;

/** The snapshot is captured before generated code starts and is never read from its workspace. */
export function dataTool(
  task: PublicTask<unknown>,
  resources: readonly PublicBriefResource[],
): AgentTool<never> {
  const snapshot = capturedJsonStringify({
    task: { taskId: task.taskId, family: task.family, publicInput: task.publicInput },
    resources,
  });
  const tool: AgentTool<typeof Params> = {
    name: DATA_READER_TOOL,
    label: "Query data",
    description:
      "Query committed public data with SQLite SQL. Omit sql to discover tables. task(json) contains this public task; resources(name,json,digest) contains public domain resources. Use json_extract and json_each for nested data, joins and aggregation. Read-only; at most 100 rows and 30 KB, 2.5 seconds. A count or sum returns a JSON number; an integer past 2^53 returns as a decimal string so it stays exact. No live database connections.",
    parameters: Params,
    execute: async (_id, args) => {
      const { sql } = args;
      let details: JsonValue;
      if (sql === undefined) {
        details = {
          ok: true,
          dialect: "sqlite",
          tables: { task: ["json"], resources: ["name", "json", "digest"] },
          example: "SELECT json_extract(json, '$.publicInput') AS input FROM task",
        };
      } else if (!isString(sql) || sql.length === 0 || sql.length > 16000) {
        details = { ok: false, error: "sql must contain 1–16000 characters" };
      } else {
        const result = runSync([bunExecutable, "--no-env-file", "-e", QUERY_WORKER], {
          input: snapshot.slice(0, -1) + ',"sql":' + capturedJsonStringify(sql) + "}",
          env: {},
          timeout: 2500,
          maxBuffer: 32768,
        });
        try {
          details =
            result.exitCode === 0 && result.cappedAt === null
              ? requireJsonValue(capturedJsonParse(decodeOutput(result.stdout)))
              : { ok: false, error: "query exceeded its resource limit or the SQLite process failed" };
        } catch {
          details = { ok: false, error: "SQLite returned an invalid result" };
        }
      }
      return { content: [{ type: "text", text: capturedJsonStringify(details) }], details };
    },
  };
  nativeFreeze(tool);
  return /* SAFETY: the roster uses AgentTool<never>; the frozen tool retains its checked parameter schema. */ tool as AgentTool<never>;
}
