import { TreasuryProposal } from "../types/schema";
import { ProposalCreated } from "../types/Treasury/LivepeerGovernor";

export function proposalCreated(event: ProposalCreated): void {
  const p = event.params;

  const proposal = new TreasuryProposal(p.proposalId.toString());
  proposal.proposer = p.proposer.toHex();
  proposal.targets = p.targets.map<string>((t) => t.toHex());
  proposal.values = p.values;
  proposal.calldatas = p.calldatas;
  proposal.voteStart = p.voteStart;
  proposal.voteEnd = p.voteEnd;
  proposal.description = p.description;
  proposal.save();
}
