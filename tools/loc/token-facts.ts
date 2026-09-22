// Token-level source facts built on TypeScript 7's scanner. The 7.0.2 native port exports no
// stable parser API — its "." entry is version-only and the AST contract is behind unstable/ — so
// source policy and analysis tools read tokens rather than trees. The scanner skips trivia, so a
// refused word inside a comment never triggers a source-policy finding.

import { SyntaxKind } from "typescript/unstable/ast";
import { type Scanner, computeLineStarts, createScanner } from "typescript/unstable/ast/scanner";

interface TokenFacts {
  /** Every string and template literal value. */
  literals: Set<string>;
  /** Identifiers immediately followed by "(", except those preceded by `function`. */
  calls: Set<string>;
  /** The longest brace-bodied function. */
  worstFunction: { lines: number; name: string };
  /** Closed brace-bodied function frames; expression-bodied arrows are not counted. */
  functionCount: number;
  /** Every closed frame with the line span measured by `worstFunction`. */
  spans: Array<{ name: string; start: number; end: number }>;
}

const LITERAL_KINDS = new Set<SyntaxKind>([
  SyntaxKind.StringLiteral,
  SyntaxKind.NoSubstitutionTemplateLiteral,
  SyntaxKind.TemplateHead,
  SyntaxKind.TemplateMiddle,
  SyntaxKind.TemplateTail,
]);

interface ScanState {
  scanner: Scanner;
  lineStarts: number[];
  literals: Set<string>;
  calls: Set<string>;
  worst: { lines: number; name: string };
  functionCount: number;
  prevKind: SyntaxKind;
  prevPrevKind: SyntaxKind;
  prevIdentifier: string;
  lastNamedIdentifier: string;
  braceDepth: number;
  parenDepth: number;
  pending: { startLine: number; parenDepth: number; name: string } | null;
  open: Array<{ startLine: number; depth: number; name: string }>;
  spans: Array<{ name: string; start: number; end: number }>;
}

function lineOf(lineStarts: number[], pos: number): number {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function noteIdentifiersAndCalls(state: ScanState, kind: SyntaxKind): void {
  if (LITERAL_KINDS.has(kind)) state.literals.add(state.scanner.getTokenValue());
  if (kind === SyntaxKind.Identifier) {
    state.prevIdentifier = state.scanner.getTokenText();
    state.lastNamedIdentifier = state.prevIdentifier;
    if (state.pending && state.prevKind === SyntaxKind.FunctionKeyword) {
      state.pending.name = state.prevIdentifier;
    }
  }
  if (kind === SyntaxKind.OpenParenToken) {
    if (state.prevKind === SyntaxKind.Identifier && state.prevPrevKind !== SyntaxKind.FunctionKeyword) {
      state.calls.add(state.prevIdentifier);
    }
    state.parenDepth += 1;
  }
  if (kind === SyntaxKind.CloseParenToken) state.parenDepth -= 1;
}

function trackFunctionFrames(state: ScanState, kind: SyntaxKind): void {
  if (kind === SyntaxKind.FunctionKeyword || kind === SyntaxKind.EqualsGreaterThanToken) {
    state.pending = {
      startLine: lineOf(state.lineStarts, state.scanner.getTokenStart()),
      parenDepth: state.parenDepth,
      name: state.lastNamedIdentifier,
    };
  } else if (
    state.pending &&
    kind !== SyntaxKind.OpenBraceToken &&
    state.prevKind === SyntaxKind.EqualsGreaterThanToken
  ) {
    state.pending = null;
  }
  if (kind === SyntaxKind.OpenBraceToken) {
    state.braceDepth += 1;
    if (state.pending && state.parenDepth === state.pending.parenDepth) {
      state.open.push({
        startLine: state.pending.startLine,
        depth: state.braceDepth,
        name: state.pending.name,
      });
      state.pending = null;
    }
  }
  if (kind === SyntaxKind.CloseBraceToken) {
    const top = state.open.at(-1);
    if (top && top.depth === state.braceDepth) {
      state.open.pop();
      state.functionCount += 1;
      const endLine = lineOf(state.lineStarts, state.scanner.getTokenStart());
      state.spans.push({ name: top.name, start: top.startLine, end: endLine });
      const lines = endLine - top.startLine + 1;
      if (lines > state.worst.lines) state.worst = { lines, name: `${top.name}@${top.startLine}` };
    }
    state.braceDepth -= 1;
  }
}

export function scanTokens(text: string): TokenFacts {
  const state: ScanState = {
    scanner: createScanner(/* skipTrivia */ true, undefined, text),
    lineStarts: computeLineStarts(text),
    literals: new Set(),
    calls: new Set(),
    worst: { lines: 0, name: "" },
    functionCount: 0,
    prevKind: SyntaxKind.Unknown,
    prevPrevKind: SyntaxKind.Unknown,
    prevIdentifier: "",
    lastNamedIdentifier: "<anonymous>",
    braceDepth: 0,
    parenDepth: 0,
    pending: null,
    open: [],
    spans: [],
  };
  // Without a parser driving the scanner, the `}` ending a template substitution is a plain
  // CloseBrace. Re-scan it exactly as the parser does so the rest of the template is not code.
  const templateStack: number[] = [];
  // A token-only scan never re-scans `/` as a regex, and TypeScript 7's scanner does not advance
  // past a bare `#` inside one (`/##/`), so the gate held its full 3600 s wall twice on
  // 2026-09-07. Step over a position the scanner did not leave instead of looping on it.
  let lastEnd = -1;
  for (let kind = state.scanner.scan(); kind !== SyntaxKind.EndOfFile; kind = state.scanner.scan()) {
    const end = state.scanner.getTokenEnd();
    if (end === lastEnd) {
      state.scanner.resetTokenState(end + 1);
      continue;
    }
    lastEnd = end;
    if (kind === SyntaxKind.TemplateHead) templateStack.push(state.braceDepth);
    if (
      kind === SyntaxKind.CloseBraceToken &&
      templateStack.length > 0 &&
      state.braceDepth === templateStack.at(-1)
    ) {
      kind = state.scanner.reScanTemplateToken(/* isTaggedTemplate */ false);
      if (kind === SyntaxKind.TemplateTail) templateStack.pop();
    }
    noteIdentifiersAndCalls(state, kind);
    trackFunctionFrames(state, kind);
    state.prevPrevKind = state.prevKind;
    state.prevKind = kind;
  }
  return {
    literals: state.literals,
    calls: state.calls,
    worstFunction: state.worst,
    functionCount: state.functionCount,
    spans: state.spans,
  };
}
