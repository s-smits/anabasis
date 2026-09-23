/** The disclosure of each census discrimination finding (brief.ts `FindingDisclosure`).
 *
 * A census finding's message is evidence and may hold issue text or a thrown message. The producer
 * states once what the author may read: a sentence composed only of public authoring identities —
 * control row ids, mutation classes, family names and declared check ids — or a withheld
 * classification. Without that, the author reads a payload-free label and cannot tell which
 * control row the finding is about, and a session can spend dozens of iterations against a row it
 * cannot name. The disclosure travels on the finding row itself, so a copied
 * or recorded row keeps it, and a finding the producer did not mark stays withheld. */
import { keyIfDefined } from "../meta/optional-key.ts";
import type { DiscriminationClaimabilityFinding } from "../claim/discrimination-claimability.ts";
import type { FindingDisclosure, GeneratedExecutionClassification } from "./brief.ts";

/** The author reads `authorDetail`, a sentence of public identities. It is required, so a producer
 *  writes the decision down rather than taking it by omission. */
export function identityComposedFinding(
  finding: DiscriminationClaimabilityFinding,
  authorDetail: string,
): DiscriminationClaimabilityFinding {
  return { ...finding, disclosure: { class: "authored", detail: authorDetail } };
}

/** The author reads the classification and, when given, a note of public identities. */
export function withheldDiscrimination(
  finding: DiscriminationClaimabilityFinding,
  classification: GeneratedExecutionClassification,
  note?: string,
): DiscriminationClaimabilityFinding {
  const disclosure: FindingDisclosure = { class: "withheld", classification, ...keyIfDefined("note", note) };
  return { ...finding, disclosure };
}

/** An unmarked row is a withheld evaluate result, or a verifier relay for an unbound tool result. */
export function discriminationDisclosure(finding: DiscriminationClaimabilityFinding): FindingDisclosure {
  return (
    finding.disclosure ?? {
      class: "withheld",
      classification:
        finding.code === "EXTERNAL_RESULT_UNBOUND"
          ? "generated-correctness-model-relay"
          : "generated-evaluate-result",
    }
  );
}
