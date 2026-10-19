export {
  detectOpportunities,
  type DetectOpportunitiesParams,
  findFundedOpportunityForBet,
  indexOpportunities,
} from "./detect";

export {
  diffOpportunities,
  type OpportunityTransition,
  snapshotOpportunities,
} from "./state";

export {
  type ArbDetectScope,
  type ArbOpportunity,
  betAnchor,
  opportunityKey,
  type OpportunityKey,
} from "./types";
