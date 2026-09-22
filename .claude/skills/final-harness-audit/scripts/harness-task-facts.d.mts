export interface TaskSetRecorded {
  state: "recorded";
  tasks: number;
  families: Record<string, number>;
  publicInputLayouts: number;
  exactPublicDuplicates: Array<{ digest: string; taskIds: string[] }>;
  lexical: {
    tokens: number;
    uniqueTokens: number;
    medianSameFamilyCosine: number | null;
    p90SameFamilyCosine: number | null;
    closestPairs: Array<{
      left: string;
      right: string;
      family: string;
      cosine: number;
      samePublicLayout: boolean;
    }>;
  };
}

export interface TaskFactsUnobservable {
  state: "unobservable";
  reason: string;
}

export interface TaskTransitionRecorded {
  state: "recorded";
  previousTasks: number;
  currentTasks: number;
  linkKinds: Record<"parentTaskId" | "sameTaskId" | "nearestLexical" | "unmatched", number>;
  exactPublicRepeats: number;
  vocabulary: { previous: number; current: number; added: number; removed: number };
  linkedLexicalCosine: { min: number | null; median: number | null; max: number | null };
  changedPublicInputPaths: Array<{ path: string; tasks: number }>;
}

export declare function taskSetFacts(text: string): TaskSetRecorded | TaskFactsUnobservable;
export declare function taskTransitionFacts(
  previousText: string,
  currentText: string,
): TaskTransitionRecorded | TaskFactsUnobservable;
