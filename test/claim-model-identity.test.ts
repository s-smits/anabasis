/**
 * Whether the model that solved the battery is evidenced or merely configured.
 *
 * A backend pin is what the operator asked for; the runtime census is what the provider reported.
 * A complete matching census states `provider-native`. An absence — a route that reports no served
 * model, a graded case whose one turn closed no provider result — discloses `unverified` and refuses
 * nothing, because it is a fact about the route rather than about the scored cases. A broken census
 * is `runtime-model-identity-unproven`, and a census naming another model or transport is
 * `runtime-model-identity-contradicted`. The two refuse alike and are named apart because the climb
 * admits an unproven battery into the difficulty population and must keep a contradicted one out,
 * which is why a row that is both broken and crossed has to carry both clauses.
 */
import { describe, expect, it } from "bun:test";
import type { ScoredCase } from "../src/claim/claim-evidence.ts";
import type {
  RuntimeIdentityCaseEvidence,
  RuntimeModelIdentity,
} from "../src/claim/runtime-model-identity.ts";
import { double } from "./helpers/doubles.ts";
import {
  GREEN_SCORE,
  claudeIdentities,
  clauseDetail,
  clauseNames,
  codexIdentities,
  createClaim,
  greenEvidence,
  identityAt,
  identityRowAt,
} from "./helpers/claim-evidence.ts";

const CLAUDE_PIN = "claude/claude-opus-4-8";
const UNPROVEN = "runtime-model-identity-unproven";
const CONTRADICTED = "runtime-model-identity-contradicted";

type Census = RuntimeIdentityCaseEvidence[];

type Row = {
  pin?: string;
  /** Absent means the battery recorded no census at all. */
  census?: () => Census;
  score?: ScoredCase[];
  clauses: string[];
  modelIdentity?: "provider-native" | "unverified";
  detail?: string;
  notDetail?: string;
};

/** A Claude census with one edit applied to it. */
const claude =
  (edit: (rows: Census) => void = () => undefined) =>
  (): Census => {
    const rows = claudeIdentities();
    edit(rows);
    return rows;
  };

/** Every identity in the census reattested by the given provider fields. */
const provider = (fields: Partial<RuntimeModelIdentity["provider"]>) => (rows: Census) => {
  for (const row of rows) {
    row.identities = row.identities.map((identity) => ({
      ...identity,
      provider: { ...identity.provider, ...fields },
    }));
  }
};

/** Case 0 settled `completed` of `turns` outer turns. */
const turns = (turnCount: number, completed: number) => (rows: Census) => {
  identityRowAt(rows, 0).turns = turnCount;
  identityRowAt(rows, 0).completedTurns = completed;
};

/** Case 0's one identity reports another served model. */
const crossed = (rows: Census) => {
  identityAt(rows, 0).provider.model = "gpt-5.5";
};

/** Case 0 carries two turns whose second identity is the first with the given edit. */
const secondTurn = (edit: (identity: RuntimeModelIdentity) => void) => (rows: Census) => {
  turns(2, 2)(rows);
  const second = structuredClone(identityAt(rows, 0));
  edit(second);
  identityRowAt(rows, 0).identities.push(second);
};

const ROWS = {
  "a complete matching codex census": {
    pin: "codex/gpt-5.5",
    census: codexIdentities,
    clauses: [],
    modelIdentity: "provider-native",
  },
  "a complete matching claude census, native session explicitly absent": {
    census: claude(),
    clauses: [],
    modelIdentity: "provider-native",
  },
  "an aborted outer turn followed by a completed one": {
    census: claude(turns(2, 1)),
    clauses: [],
    modelIdentity: "provider-native",
  },
  "a route that reports no served model": {
    pin: "codex/gpt-6-astra",
    census: claude(provider({ id: "openai-codex", model: null })),
    clauses: [],
    modelIdentity: "unverified",
  },
  "a graded case whose one turn closed no provider result": {
    census: claude((rows) => {
      turns(1, 0)(rows);
      identityRowAt(rows, 0).identities = [];
    }),
    clauses: [],
    modelIdentity: "unverified",
  },
  "an unsupported transport with no census producer": { pin: "openrouter/model", clauses: [] },
  "a codex pin with no census": { pin: "codex/gpt-5.5", clauses: [UNPROVEN] },
  "a claude pin with no census": { clauses: [UNPROVEN] },
  "a claude pin over a codex census": { census: codexIdentities, clauses: [CONTRADICTED] },
  "a route that reports no model on every case but one, which names another": {
    pin: "codex/gpt-6-astra",
    census: claude((rows) => {
      provider({ id: "openai-codex", model: null })(rows);
      identityAt(rows, 0).provider.model = "some-other-model";
    }),
    clauses: [CONTRADICTED],
    detail: 'was served model "some-other-model"',
  },
  "an ungraded case with no identity, named as scored rather than as a non-result": {
    census: claude((rows) => {
      turns(3, 0)(rows);
      identityRowAt(rows, 0).identities = [];
    }),
    score: GREEN_SCORE.map((c) => (c.caseId === "t1" ? { ...c, truthVerified: false } : c)),
    clauses: [UNPROVEN],
    detail: 'scored case "t1" has no recorded provider identity (identity unproven, not a non-result)',
    notDetail: "completed no provider result",
  },
  "anthropic-attested rows relabelled to a codex pin's model": {
    pin: "codex/gpt-5.5",
    census: claude(provider({ model: "gpt-5.5" })),
    clauses: [CONTRADICTED],
  },
  "a row attested by another provider": {
    census: claude((rows) => {
      identityAt(rows, 0).provider.id = "openrouter";
    }),
    clauses: [CONTRADICTED],
  },
  "a claude served model the pin does not name": {
    census: claude((rows) => {
      identityAt(rows, 0).provider.model = "claude-sonnet-4-6";
    }),
    clauses: [CONTRADICTED],
  },
  "a codex served model the pin does not name": {
    pin: "codex/gpt-5.5",
    census: () => {
      const rows = codexIdentities();
      identityAt(rows, 0).provider.model = "some-other-model";
      return rows;
    },
    clauses: [CONTRADICTED],
  },
  "a pin with a blank model segment, even over blank-model identities": {
    pin: "claude/",
    census: claude(provider({ model: "" })),
    clauses: [UNPROVEN],
  },
  "a census row for a case the score does not contain": {
    census: claude((rows) => {
      const ghost = structuredClone(identityAt(rows, 0));
      ghost.agentRuntime.sessionId = "pi-session-ghost";
      ghost.provider.resultId = "pi-result-ghost";
      rows.push({ caseId: "ghost", turns: 1, completedTurns: 1, identities: [ghost] });
    }),
    clauses: [UNPROVEN],
  },
  "two census rows for one scored case": {
    census: claude((rows) => {
      rows.push(structuredClone(identityRowAt(rows, 0)));
    }),
    clauses: [UNPROVEN],
  },
  "a row recorded in an earlier identity shape, read as incomplete rather than a crash": {
    census: claude((rows) => {
      identityRowAt(rows, 0).identities = [double<RuntimeModelIdentity>({ transport: "claude", model: "x" })];
    }),
    clauses: [UNPROVEN],
  },
  "a completed turn that recorded no identity": { census: claude(turns(2, 2)), clauses: [UNPROVEN] },
  "a short identity count beside a crossed identity": {
    census: claude((rows) => {
      turns(2, 2)(rows);
      crossed(rows);
    }),
    clauses: [UNPROVEN, CONTRADICTED],
  },
  "unreadable turn counts beside a crossed identity": {
    census: claude((rows) => {
      turns(0, 1)(rows);
      crossed(rows);
    }),
    clauses: [UNPROVEN, CONTRADICTED],
  },
  "over-counted completed turns beside a crossed identity": {
    census: claude((rows) => {
      turns(1, 4)(rows);
      crossed(rows);
    }),
    clauses: [UNPROVEN, CONTRADICTED],
  },
  "degraded early identities, not accused of reusing a result id": {
    census: claude((rows) => {
      turns(4, 4)(rows);
      const base = identityAt(rows, 0);
      identityRowAt(rows, 0).identities = [0, 1, 2, 3].map((turn) => ({
        ...base,
        provider: { ...base.provider, resultId: turn < 3 ? null : "pi-result-turn-4" },
      }));
    }),
    clauses: [UNPROVEN],
    detail: "incomplete provider identity",
    notDetail: "reused or omitted",
  },
  "a runtime session that changes across one case's turns": {
    census: claude(
      secondTurn((identity) => {
        identity.agentRuntime.sessionId = "pi-session-1b";
        identity.provider.resultId = "pi-result-1b";
      }),
    ),
    clauses: [UNPROVEN],
  },
  "a result id that repeats across one case's turns": {
    census: claude(secondTurn(() => undefined)),
    clauses: [UNPROVEN],
  },
  "two cases sharing one runtime session": {
    census: claude((rows) => {
      identityAt(rows, 1).agentRuntime.sessionId = identityAt(rows, 0).agentRuntime.sessionId;
    }),
    clauses: [UNPROVEN],
  },
  "two cases sharing one provider result": {
    census: claude((rows) => {
      identityAt(rows, 1).provider.resultId = identityAt(rows, 0).provider.resultId;
    }),
    clauses: [UNPROVEN],
  },
} satisfies Record<string, Row>;

/** Each identity field that can go missing or blank. Present-but-blank is a recording defect,
 *  unlike the explicit null native session the green census carries. */
const BLANKED: Array<[string, (identity: RuntimeModelIdentity) => void]> = [
  ["a null served model", (identity) => Object.assign(identity.provider, { model: null })],
  ["a blank native session", (identity) => Object.assign(identity.provider, { nativeSessionId: "" })],
  ["a blank runtime version", (identity) => Object.assign(identity.agentRuntime, { version: "" })],
  ["a blank runtime session", (identity) => Object.assign(identity.agentRuntime, { sessionId: "" })],
  ["a null result id", (identity) => Object.assign(identity.provider, { resultId: null })],
  ["a blank result id", (identity) => Object.assign(identity.provider, { resultId: "" })],
];
const BLANKED_ROWS = BLANKED.map(([name, blank]): [string, Row] => [
  name,
  { census: claude((rows) => blank(identityAt(rows, 0))), clauses: [UNPROVEN] },
]);

describe("the served-model identity a claim may state", () => {
  it.each([...Object.entries<Row>(ROWS), ...BLANKED_ROWS])("%s", (_, row) => {
    const evidence = greenEvidence({ backendPin: row.pin ?? CLAUDE_PIN });
    if (row.census === undefined) delete evidence.runtimeIdentities;
    else evidence.runtimeIdentities = row.census();
    const result = createClaim(evidence, row.score);
    expect(clauseNames(result)).toEqual(row.clauses);
    if (row.modelIdentity !== undefined && result.ok) {
      expect(result.statement.modelIdentity).toBe(row.modelIdentity);
    }
    const detail = clauseDetail(result, row.clauses[0] ?? "");
    if (row.detail !== undefined) expect(detail).toContain(row.detail);
    if (row.notDetail !== undefined) expect(detail).not.toContain(row.notDetail);
  });
});
