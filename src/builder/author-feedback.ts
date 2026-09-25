/**
 * Bounded, lossless navigation over the latest author-visible gate result.
 *
 * A refusal can carry hundreds of large rows; returning them whole can exceed the transport ceiling
 * and hide the refusal the Builder must repair. Rows fold into (code, path) groups, the overview
 * stays small, and every code, path and detail stays readable by group and character page. Every
 * row passes through `projectFindingForAuthor` first, so everything rendered here is author-visible.
 * This owner makes no acceptance decision.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { CampaignFeedback } from "../author/campaign-types.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { type ContractFinding, controllerValidatedFinding, projectFindingForAuthor } from "../truth/brief.ts";
import { characterWindow, windowRange } from "./read-window.ts";
import { boundText } from "../meta/bounded-text.ts";

const GROUP_PAGE_ROWS = 20;
/** UTF-8 bytes of each field's preview; the exact field pages by character offset. */
const FIELD_PREVIEW_BYTES = 240;
/** Enough rows to list every variant of a typical large group, which holds a handful at the median
 *  and a couple of dozen at the tail — more than the 240-byte preview shows. */
const VARIANT_INDEX_ROWS = 32;
/** UTF-8 bytes of each variant's line in the index. */
const VARIANT_INDEX_BYTES = 160;

/** Both submit and correctness_check end with this sentence: they record into the same store. */
export const FEEDBACK_NAVIGATION =
  'Use harness_inspect {"action":"feedback"} to page every group; add "group", "field" and "offset" to read an exact code, path or detail.';

export type AuthorCheckStage = "bundle" | "validation" | "conformance" | "gates";
interface AuthorRefusalIdentity {
  attempt: number;
  turn: number;
  stage: AuthorCheckStage;
  commit: string;
}
export interface AuthorFeedbackQuery {
  group?: number;
  field?: "code" | "path" | "detail";
  offset?: number;
  limit?: number;
}
interface FindingDelta {
  carried: number;
  resolved: number;
  introduced: number;
}

/** One distinct repair within a group. `alsoFor` lists, in arrival order, the subjects of later
 *  rows that read the same apart from their subject. A submit can carry eighty control rows
 *  differing only by example id, which is one repair and eighty subjects. */
interface Variant {
  detail: string;
  count: number;
  alsoFor: string[];
  key: string;
  subject: string | undefined;
}
interface Group {
  code: string;
  path: string;
  detail: string;
  count: number;
  variants: Variant[];
}

type FindingAction = "readiness" | "feedback";

type Latest =
  | (AuthorRefusalIdentity & { source: "submit"; findings: ContractFinding[] })
  | {
      source: "correctness_check";
      stage: AuthorCheckStage;
      findings: ContractFinding[];
      snapshotId?: string;
    };

function variantText({ detail, alsoFor }: Variant): string {
  return alsoFor.length === 0 ? detail : `${detail} Also for: ${alsoFor.map((id) => `"${id}"`).join(", ")}.`;
}

/**
 * Fold on (code, path), so one defect reads as one group even where its detail varies. Under a
 * (code, path, detail) key a refusal renders almost as many groups as it has findings, which is a
 * list and not a diagnosis. Each distinct repair keeps its count in first-seen order, and the
 * paged detail frames
 * every variant with its count and character length so the rendering stays reconstructible; a
 * single variant pages bare.
 */
export function groupAuthorFindings(findings: readonly ContractFinding[]): Group[] {
  const groups = new Map<string, Group>();
  for (const finding of findings.map(projectFindingForAuthor)) {
    const id = capturedJsonStringify([finding.code, finding.path]);
    const group = groups.get(id) ?? {
      code: finding.code,
      path: finding.path,
      detail: "",
      count: 0,
      variants: [],
    };
    groups.set(id, group);
    group.count += 1;
    // The producer's subject blanked, so a row naming another control is the same repair; a row
    // without a subject folds only with a byte-identical detail.
    const key =
      finding.subject === undefined
        ? finding.detail
        : finding.detail.replaceAll(`"${finding.subject}"`, '"…"');
    const variant = group.variants.find((row) => row.key === key);
    if (variant === undefined) {
      group.variants.push({ detail: finding.detail, count: 1, alsoFor: [], key, subject: finding.subject });
    } else {
      variant.count += 1;
      if (
        finding.subject !== undefined &&
        finding.subject !== variant.subject &&
        !variant.alsoFor.includes(finding.subject)
      ) {
        variant.alsoFor.push(finding.subject);
      }
    }
  }
  for (const group of groups.values()) {
    const { variants } = group;
    group.detail =
      variants.length === 1 && variants[0] !== undefined
        ? variantText(variants[0])
        : variants
            .map(
              (row, i) =>
                `[variant ${i + 1}/${variants.length} ×${row.count}, ${Array.from(row.detail).length} chars]\n${variantText(row)}`,
            )
            .join("\n");
  }
  return [...groups.values()];
}

/** One line per variant, count first, so a group's repairs read without paging. */
function variantIndex({ variants }: Group): string[] {
  const lines = variants
    .slice(0, VARIANT_INDEX_ROWS)
    .map((row) => `×${row.count} ${boundText(variantText(row), VARIANT_INDEX_BYTES).shown}`);
  const more = variants.length - lines.length;
  return more > 0 ? [...lines, `(${more} more variants; page this group's detail)`] : lines;
}

/** Multiset overlap by code: carried survive from the previous list, resolved left it, introduced
 *  arrived. A reworded detail or a moved path is not a new defect class, which is why the refusal
 *  line says "finding codes" and not "findings". */
export function codeDelta(previous: readonly string[], current: readonly string[]): FindingDelta {
  const remaining = new Map<string, number>();
  for (const code of previous) remaining.set(code, (remaining.get(code) ?? 0) + 1);
  let carried = 0;
  for (const code of current) {
    const left = remaining.get(code) ?? 0;
    if (left === 0) continue;
    carried += 1;
    remaining.set(code, left - 1);
  }
  return { carried, resolved: previous.length - carried, introduced: current.length - carried };
}

function preview(value: string) {
  const bounded = boundText(value, FIELD_PREVIEW_BYTES);
  return { text: bounded.text, characters: Array.from(value).length, complete: !bounded.truncated };
}

const previews = (group: Group) => ({
  code: preview(group.code),
  path: preview(group.path),
  detail: preview(group.detail),
});

export function authorFindingOverview(
  findings: readonly ContractFinding[],
  offset?: number,
  limit?: number,
  action: FindingAction = "readiness",
) {
  const groups = groupAuthorFindings(findings);
  const rows =
    limit === undefined || !Number.isFinite(limit)
      ? GROUP_PAGE_ROWS
      : Math.min(GROUP_PAGE_ROWS, Math.max(1, Math.trunc(limit)));
  const range = windowRange(groups.length, offset, rows);
  const hidden = groups.length - range.to;
  return {
    totalFindings: findings.length,
    totalGroups: groups.length,
    ...range,
    groups: groups.slice(range.from - 1, range.to).map((group, index) => ({
      group: range.from + index,
      count: group.count,
      variants: group.variants.length,
      ...previews(group),
      ...keyIfDefined("variantIndex", group.variants.length > 1 ? variantIndex(group) : undefined),
    })),
    navigation:
      groups.length === 0
        ? "No author-visible findings are present."
        : action === "readiness"
          ? `${hidden > 0 ? `${hidden} more ${hidden === 1 ? "group is" : "groups are"} not shown; ` : ""}correctness_check records every finding, and harness_inspect feedback then pages any group exactly with group and field.`
          : 'Use harness_inspect {"action":"feedback"} with group and field to read an exact code, path or detail; use offset for later characters or, without group, later groups.',
  };
}

/** One exact field page of a group, or the overview when no group is named. */
export function authorFindingPage(findings: readonly ContractFinding[], query: AuthorFeedbackQuery = {}) {
  if (query.group === undefined) {
    return authorFindingOverview(findings, query.offset, query.limit, "feedback");
  }
  const groups = groupAuthorFindings(findings);
  const number = Math.trunc(query.group);
  const group = number < 1 ? undefined : groups[number - 1];
  const totals = { totalFindings: findings.length, totalGroups: groups.length, group: number };
  if (group === undefined) {
    return {
      ...totals,
      stale: true as const,
      navigation: "That group is absent from the current findings; repeat the action without group.",
    };
  }
  const field = query.field ?? "detail";
  return {
    ...totals,
    count: group.count,
    field,
    ...characterWindow(group[field], query.offset, query.limit),
    previews: previews(group),
  };
}

/** The latest of submit and correctness_check, read by harness_inspect in the same Builder session. */
export class BuilderAuthorFeedback {
  private latest: Latest | null = null;

  record(identity: AuthorRefusalIdentity, findings: readonly ContractFinding[]): void {
    this.latest = { ...identity, source: "submit", findings: [...findings] };
  }

  /** The code delta against the previous result, so a changed tree reads as progress or regression;
   *  submits take theirs from the execution record. A second check of the same snapshot gets none. */
  recordCheck(
    stage: AuthorCheckStage,
    findings: readonly ContractFinding[],
    snapshotId?: string,
  ): FindingDelta | null {
    const previous = this.latest;
    this.latest = {
      source: "correctness_check",
      stage,
      findings: [...findings],
      ...keyIfDefined("snapshotId", snapshotId),
    };
    if (
      previous === null ||
      (previous.source === "correctness_check" &&
        snapshotId !== undefined &&
        previous.snapshotId === snapshotId)
    ) {
      return null;
    }
    return codeDelta(
      previous.findings.map(({ code }) => code),
      findings.map(({ code }) => code),
    );
  }

  page(query: AuthorFeedbackQuery = {}) {
    const { latest } = this;
    if (latest === null) {
      return {
        available: false as const,
        phase: "before-submit" as const,
        nextAction:
          "No correctness_check or submit has run this round, so there is no feedback yet; harness_inspect readiness shows what the candidate still lacks.",
      };
    }
    const identity =
      latest.source === "submit"
        ? {
            refusal: {
              attempt: latest.attempt,
              turn: latest.turn,
              stage: latest.stage,
              commit: latest.commit.slice(0, 12),
            },
          }
        : { check: { stage: latest.stage } };
    return {
      available: true as const,
      source: latest.source,
      ...identity,
      ...authorFindingPage(latest.findings, query),
      note: "Use group and field to read every code, path or detail in exact character pages.",
    };
  }
}

/** Gate feedback as submit and correctness_check both show it. A row without controller-validated
 *  findings keeps its prose claim in the evidence and hands the author only the file it names,
 *  since an unvalidated claim is routing metadata rather than a finding. */
export function gateFeedbackFindings(feedback: readonly CampaignFeedback[]): ContractFinding[] {
  return feedback.flatMap((row) =>
    row.findings !== undefined && row.findings.length > 0
      ? row.findings
      : [
          controllerValidatedFinding({
            code: "gate-unvalidated",
            path: row.owner,
            detail: "this gate produced no controller-validated finding; no public detail is available",
          }),
        ],
  );
}
