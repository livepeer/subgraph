import { TreasuryProposal } from "../types/schema";
import { ProposalCreated } from "../types/Treasury/LivepeerGovernor";

export function proposalCreated(event: ProposalCreated): void {
  const { proposalId, proposer, targets, values, calldatas, voteStart, voteEnd, description } = event.params;

  const proposal = new TreasuryProposal(proposalId.toString());
  proposal.proposer = proposer.toHex();
  proposal.targets = targets.map<string>((t) => t.toHex());
  proposal.values = values;
  proposal.calldatas = calldatas;
  proposal.voteStart = voteStart;
  proposal.voteEnd = voteEnd;
  proposal.description = description;
  proposal.save();
}
