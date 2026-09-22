import type { JsonValue } from "#src/meta/json-shape.ts";

/** Declarations for `query-complexity.mjs`, so callers and its test read the real contract rather
 *  than asserting their way through a plain-JS import. */

export interface CheckExecution {
  families?: "all" | string[];
  artifactPaths?: string[];
  publicInputPaths?: string[];
  requiredToolIds?: string[];
}

export interface TruthCheck {
  id?: string;
  assertion?: string;
  description?: string;
  citedDecisionIds?: string[];
  numericBoundaries?: { publicInputPath?: string; constantName?: string }[];
  execution?: CheckExecution;
}

export interface Brief {
  domain?: string;
  decisions?: string[];
  ruleDecisions?: (string | { rule?: string; decision?: string })[];
  truthChecks?: TruthCheck[];
}

export interface Task {
  taskId: string;
  family: string;
  publicInput?: unknown;
}

export interface Structure {
  checks: number;
  limits: number;
  coupled: number;
  tooled: number;
  rules: number;
  roots: number;
  inputs: number;
  scenarios: number;
}

export interface QueryRow {
  taskId: string;
  family: string;
  tier: string;
  /** How many of the family's checks reached that tier: one frontier check among ten is not six. */
  reached: number;
  tierScore: number;
  tierMargin: number;
  structure: Structure;
  numerics: Record<string, number>;
}

export interface BatteryReading {
  schema: string;
  tasks: number;
  families: string[];
  histogram: Record<string, number>;
  checkTiers: Record<string, number>;
  medians: Structure;
  rows: QueryRow[];
  familyVectors: Record<string, number[][]>;
}

export type Embed = (texts: string[]) => Promise<number[][]>;
export interface ReadOptions {
  embed?: Embed;
  batchSize?: number;
}

export declare const COMPLEXITY_SCHEMA: string;
export declare const TIERS: Record<string, string[]>;
export declare const TIER_ORDER: string[];
export declare const STRUCTURE_KEYS: (keyof Structure)[];
export declare const ANCHOR_SHA256: string;
export declare const MODEL_IDENTITY: Record<string, string | boolean>;

export declare function leafPaths(value: JsonValue, prefix?: string): string[];
export declare function numericLeaves(value: JsonValue, prefix?: string): Record<string, number>;
export declare function appliesTo(check: TruthCheck, family: string): boolean;
export declare function structureOf(task: Task, brief: Brief): Structure;
export declare function unitsOf(family: string, brief: Brief): string[];
export declare function loadBundle(dir: string): { brief: Brief; tasks: Task[] };
export declare function readBattery(
  bundle: { brief: Brief; tasks: Task[] },
  options?: ReadOptions,
): Promise<BatteryReading>;
export declare function readVersionDir(dir: string, options?: ReadOptions): Promise<BatteryReading>;
export declare function renderBattery(reading: BatteryReading): string;
export declare function batteryDirs(target: string): string[];
