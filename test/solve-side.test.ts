import type { JsonValue } from "../src/meta/json-shape.ts";

import { readFileSync, readdirSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import { createSubmissionAuthority, submissionPortOf } from "../src/solve/final-submission.ts";
import {
  compilePublicArtifactSchema,
  publicArtifactSchemaFindings,
  validatePublicArtifactSchema,
} from "../src/solve/public-artifact-schema.ts";
import { double, required } from "./helpers/doubles.ts";

function schemaFor(artifact: Record<string, JsonValue>) {
  return compilePublicArtifactSchema(
    Object.keys(artifact).map((name) => ({ name })),
    [artifact],
  );
}

function authorityFor(artifact: Record<string, JsonValue>, maxAttempts = 3) {
  return createSubmissionAuthority({ maxAttempts, publicArtifactSchema: schemaFor(artifact) });
}

const sources = () =>
  readdirSync("src", { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return { path, text: readFileSync(path, "utf8") };
    });

describe("model-visible prompts match the submission contract", () => {
  it("names only real submission-port methods", () => {
    const members = new Set(Object.keys(submissionPortOf(authorityFor({ plan: { v: 1 } }, 1))));
    let checked = 0;
    for (const { path, text } of sources()) {
      for (const match of text.matchAll(/\bsubmission\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
        const method = match[1] ?? "";
        expect(members.has(method), `${path} names submission.${method}(), absent from the real port`).toBe(
          true,
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("controller-owned final submission", () => {
  it("accepts exact JSON bytes and retains the first accepted submission", () => {
    const authority = authorityFor({ plan: { value: 1 } });
    const port = submissionPortOf(authority);
    const accepted = port.acceptArtifact('{"plan":{"value":2}}');
    expect(accepted).toMatchObject({ accepted: true, attempts: 1, kind: "artifact" });
    expect(accepted.artifactDigest).toBe(
      new Bun.CryptoHasher("sha256")
        .update(required(accepted.artifactJson, "the accepted artifact JSON"))
        .digest("hex"),
    );
    expect(port.acceptArtifact('{"plan":{"value":3}}').artifactJson).toBe(accepted.artifactJson);
    expect(authority.attempts()).toBe(1);
  });

  it("keeps public schema rejection repairable and bounded", () => {
    const authority = authorityFor({ plan: { value: 1 } }, 2);
    expect(authority.acceptArtifact('{"wrong":1}')).toMatchObject({
      accepted: false,
      attempts: 1,
      rejection: { code: "artifact-public-schema" },
    });
    expect(authority.acceptArtifact('{"plan":{"value":2}}')).toMatchObject({
      accepted: true,
      attempts: 2,
    });

    const exhausted = authorityFor({ plan: { value: 1 } }, 1);
    exhausted.acceptArtifact('{"wrong":1}');
    expect(exhausted.acceptArtifact('{"plan":{"value":2}}')).toMatchObject({
      accepted: false,
      attempts: 1,
      rejection: { code: "attempts-exhausted" },
    });
    // The budget state must not erase the diagnosis: run 44 lost draft-unmaterialized in 24 of
    // 25 final submission records this way. A further refused call keeps the composed text stable.
    const again = exhausted.acceptArtifact('{"plan":{"value":3}}');
    expect(again.rejection?.safeRemedy).toContain("rejected as artifact-public-schema");
    expect(exhausted.acceptArtifact('{"plan":{"value":4}}').rejection?.safeRemedy).toBe(
      again.rejection?.safeRemedy,
    );
  });

  it("accepts schema-valid empty, false and zero content for the verifier to judge", () => {
    const sample = { report: { note: "x", tags: ["a"], score: 1, done: true } };
    expect(
      authorityFor(sample).acceptArtifact(
        JSON.stringify({ report: { note: " ", tags: [], score: null, done: null } }),
      ),
    ).toMatchObject({ accepted: false, rejection: { code: "artifact-public-schema" } });
    expect(
      authorityFor(sample).acceptArtifact(
        JSON.stringify({ report: { note: "", tags: [], score: 0, done: false } }),
      ),
    ).toMatchObject({ accepted: true });
    const strings = authorityFor({ report: { note: "x", tags: ["a"] } });
    expect(strings.acceptArtifact('{"report":{"note":" ","tags":[]}}')).toMatchObject({
      accepted: true,
    });
  });

  it("restores only matching schema, budget, digest and terminal state", () => {
    const config = { maxAttempts: 2, publicArtifactSchema: schemaFor({ value: 1 }) };
    const authority = createSubmissionAuthority(config);
    authority.acceptArtifact('{"value":2}');
    const checkpoint = authority.checkpoint();
    expect(createSubmissionAuthority(config, checkpoint).finalSubmission()).toEqual(
      authority.finalSubmission(),
    );

    const bytes = structuredClone(checkpoint);
    bytes.state.artifactJson = '{"value":3}';
    expect(() => createSubmissionAuthority(config, bytes)).toThrow(/digest mismatch/);
    expect(() => createSubmissionAuthority({ ...config, maxAttempts: 3 }, checkpoint)).toThrow(
      /config identity/,
    );
    const kind = structuredClone(checkpoint);
    kind.state.kind = double("falsified");
    expect(() => createSubmissionAuthority(config, kind)).toThrow(/terminal kind/);
  });

  it("refuses malformed bytes and invalid attempt budgets at the authority", () => {
    expect(authorityFor({ value: 1 }).acceptArtifact("undefined")).toMatchObject({
      accepted: false,
      rejection: { code: "artifact-unserialisable" },
    });
    for (const maxAttempts of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => authorityFor({ value: 1 }, maxAttempts)).toThrow(/positive finite integer/);
    }
  });
});

describe("declared scalar values", () => {
  const fields = [{ name: "verdict", "shape": "test", allowedValues: ["pass", "fail"] }];

  it("rejects a value outside the declared set and names the set publicly", () => {
    const schema = compilePublicArtifactSchema(fields, [{ verdict: "pass" }, { verdict: "fail" }]);
    const authority = createSubmissionAuthority({ maxAttempts: 3, publicArtifactSchema: schema });
    const refused = authority.acceptArtifact('{"verdict":"maybe"}');
    expect(refused).toMatchObject({ accepted: false, rejection: { code: "artifact-public-schema" } });
    expect(refused.rejection?.safeRemedy).toContain('expected one of "pass", "fail"');
    expect(authority.acceptArtifact('{"verdict":"fail"}')).toMatchObject({ accepted: true });
  });

  it("a control outside its own declared set does not compile into a schema", () => {
    expect(() => compilePublicArtifactSchema(fields, [{ verdict: "maybe" }])).toThrow(
      /outside the declared allowedValues/,
    );
  });

  it("fields without allowedValues stay open", () => {
    const open = compilePublicArtifactSchema([{ name: "verdict" }], [{ verdict: "pass" }]);
    const authority = createSubmissionAuthority({ maxAttempts: 3, publicArtifactSchema: open });
    expect(authority.acceptArtifact('{"verdict":"maybe"}')).toMatchObject({ accepted: true });
  });

  it("preserves declared values when the schema is serialised", () => {
    const schema = compilePublicArtifactSchema(fields, [{ verdict: "pass" }]);
    expect(validatePublicArtifactSchema(JSON.parse(JSON.stringify(schema)))).toEqual(schema);
  });

  it("null beside two object key sets compiles one flat union the schema validator accepts", () => {
    const accepts = [{ result: null }, { result: { value: 1 } }, { result: { value: 2, warning: "note" } }];
    for (const place of [(v: JsonValue) => v, (v: JsonValue) => [v]]) {
      const schema = compilePublicArtifactSchema(
        [{ name: "result" }],
        accepts.map(({ result }) => ({ result: place(result) })),
      );
      expect(validatePublicArtifactSchema(JSON.parse(JSON.stringify(schema)))).toEqual(schema);
      for (const { result } of accepts) {
        expect(publicArtifactSchemaFindings(schema, { result: place(result) })).toEqual([]);
      }
    }
  });
});

describe("data-keyed maps", () => {
  it("a declared open-map path compiles open over keys and closed over its value shape", () => {
    // Run 68: config.busAddresses (part id → bus address) compiled into a union of the exact key
    // sets the 20 accept controls contained, so 8 of 25 tasks could not express a correct answer
    // through submit. The brief now declares the path; keys stay open, the value shape and the
    // verifier still check the content.
    const accepts = [
      { config: { busAddresses: {} } },
      { config: { busAddresses: { alpha: "0x21" } } },
      { config: { busAddresses: { beta: "0x22", gamma: "0x23" } } },
    ];
    const schema = compilePublicArtifactSchema([{ name: "config", openMapPaths: ["busAddresses"] }], accepts);
    const unseen = { config: { busAddresses: { delta: "0x2a", epsilon: "0x2b" } } };
    expect(publicArtifactSchemaFindings(schema, unseen)).toEqual([]);
    expect(publicArtifactSchemaFindings(schema, { config: { busAddresses: { delta: 42 } } })).toMatchObject([
      { path: "$.config.busAddresses.delta" },
    ]);
    expect(validatePublicArtifactSchema(JSON.parse(JSON.stringify(schema)))).toEqual(schema);
  });

  it("undeclared differing key sets stay a union of the corpus shapes, not an inferred map", () => {
    // The same observations describe an optional-field object: {mode} beside {mode, timeoutMs}.
    // An inferred map would accept {}, {mode: 10} and {typo: "auto"} — dropping the required key,
    // its type, and the closed key set — so inference is off and the brief must declare intent.
    const accepts = [{ config: { mode: "auto" } }, { config: { mode: "manual", timeoutMs: 10 } }];
    const schema = compilePublicArtifactSchema([{ name: "config" }], accepts);
    expect(publicArtifactSchemaFindings(schema, { config: { mode: "auto" } })).toEqual([]);
    expect(publicArtifactSchemaFindings(schema, { config: {} })).not.toEqual([]);
    expect(publicArtifactSchemaFindings(schema, { config: { mode: 10 } })).not.toEqual([]);
    expect(publicArtifactSchemaFindings(schema, { config: { typo: "auto" } })).not.toEqual([]);
  });

  it("records sharing one key set still compile closed unless their path is declared", () => {
    const closed = compilePublicArtifactSchema(
      [{ name: "config" }],
      [{ config: { mode: "a" } }, { config: { mode: "b" } }],
    );
    expect(publicArtifactSchemaFindings(closed, { config: { mode: "c" } })).toEqual([]);
    expect(publicArtifactSchemaFindings(closed, { config: { mode: "c", extra: 1 } })).not.toEqual([]);
    // The corpus boundary the inference could never cross: 20 accepts that happen to share one
    // key set are still a map when the brief says so.
    const declared = compilePublicArtifactSchema(
      [{ name: "config", openMapPaths: ["$"] }],
      [{ config: { alpha: "0x21" } }, { config: { alpha: "0x22" } }],
    );
    expect(publicArtifactSchemaFindings(declared, { config: { beta: "0x23" } })).toEqual([]);
  });

  it("refuses a declared open-map path no accepted example carries", () => {
    expect(() =>
      compilePublicArtifactSchema([{ name: "config", openMapPaths: ["missing"] }], [{ config: { a: 1 } }]),
    ).toThrow(/declares open map \$\.config\.missing/);
  });
});
