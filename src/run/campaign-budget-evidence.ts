import { assertCampaignBudget, type CampaignBudget } from "./campaign-budget.ts";
import type { JsonValue } from "../meta/json-shape.ts";

/** The two controller evidence records this module joins; `schema` is parsed bytes, so the
 *  compiler cannot own these tags as a member type and every reader compares them by hand. */
export const CAMPAIGN_OPENING_SCHEMA = "campaign-opening/v2";
export const CAMPAIGN_TERMINAL_SCHEMA = "campaign-terminal/v2";

type BudgetEvidenceRecord = {
  schema?: JsonValue;
  budget?: JsonValue;
};

/** Join the opening and terminal budget snapshots of one recorded run. Both sides carry a snapshot,
 *  so the join either proves the same run's spend or refuses; there is no late-bound disclosure. */
export function joinControllerBudgetEvidence(
  openingPath: string,
  terminalPath: string,
  opening: BudgetEvidenceRecord,
  terminal: BudgetEvidenceRecord,
): CampaignBudget {
  if (opening.schema !== CAMPAIGN_OPENING_SCHEMA || terminal.schema !== CAMPAIGN_TERMINAL_SCHEMA) {
    throw new Error(`${terminalPath}: opening and terminal budget evidence versions disagree`);
  }
  const openingBudget = assertCampaignBudget(opening.budget, `${openingPath}.budget`);
  const terminalBudget = assertCampaignBudget(terminal.budget, `${terminalPath}.budget`);
  if (openingBudget.turnBudget !== terminalBudget.turnBudget) {
    throw new Error(`${terminalPath}: budget cap disagrees with opening budget`);
  }
  if (terminalBudget.turnsUsed < openingBudget.turnsUsed) {
    throw new Error(`${terminalPath}: budget spend is lower than the opening snapshot`);
  }
  return terminalBudget;
}
