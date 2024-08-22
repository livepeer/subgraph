import { Delegator, Transcoder, TreasureProposalTally, TreasuryProposal, TreasuryProposalVote } from "../types/schema";
import { ProposalCreated, VoteCast } from "../types/Treasury/LivepeerGovernor";
import { BigDecimal, BigInt } from "@graphprotocol/graph-ts";
export function proposalCreated(event: ProposalCreated): void {
  const p = event.params;

  const tally = new TreasureProposalTally(p.proposalId.toString())
  tally.yes = BigDecimal.zero()
  tally.no = BigDecimal.zero()
  tally.abstain = BigDecimal.zero()
  tally.save();

  const proposal = new TreasuryProposal(p.proposalId.toString());
  proposal.proposer = p.proposer.toHex();
  proposal.targets = p.targets.map<string>((t) => t.toHex());
  proposal.values = p.values;
  proposal.calldatas = p.calldatas;
  proposal.voteStart = p.voteStart;
  proposal.voteEnd = p.voteEnd;
  proposal.description = p.description;
  proposal.tally = tally.id;
  proposal.save();
}

export function handleVoteCast(event: VoteCast): void {
  const v = event.params;

  let proposal = TreasuryProposal.load(v.proposalId.toString());

  if (!proposal) {
    return;
  }

  const del = Delegator.load(v.voter.toHex());
  if (!del) {
    return;
  }

  let vote = TreasuryProposalVote.load(v.proposalId.toString() + "-" + v.voter.toHex());
  if (vote) {
    return
  }

  const tally = TreasureProposalTally.load(proposal.tally);
  if (!tally) {
    return;
  }

  vote = new TreasuryProposalVote(v.proposalId.toString() + "-" + v.voter.toHex());
  const transcoder = Transcoder.load(del.delegate || '');

  vote.proposal = proposal.id;
  vote.voter = v.voter.toHex();
  if (v.support === 0) {
    vote.support = "No"
    tally.no = tally.no.plus(new BigDecimal(v.weight) || BigDecimal.zero())
  } else if (v.support === 1) {
    vote.support = "Yes"
    tally.yes = tally.yes.plus(new BigDecimal(v.weight) || BigDecimal.zero())
  } else {
    vote.support = "Abstain"
    tally.abstain = tally.abstain.plus(new BigDecimal(v.weight) || BigDecimal.zero())
  }
  vote.registeredTranscoder = del.delegate === v.voter.toHexString()

  if (vote.registeredTranscoder) {
    vote.voteStake = new BigDecimal(v.weight)
  } else {
    vote.nonVoteStake = new BigDecimal(v.weight)
  }

  // check transcoder vote 
  const tVote = TreasuryProposalVote.load(v.proposalId.toString() + "-" + transcoder?.id);
  if (tVote && v.voter.toHexString() != del.delegate && tVote.support != vote.support) {
    if (tVote.support == "Yes") {
      tally.yes = tally.yes.minus(new BigDecimal(v.weight) || BigDecimal.zero())
    } else if (tVote.support == "No") {
      tally.no = tally.no.minus(new BigDecimal(v.weight) || BigDecimal.zero())
    } else {
      tally.abstain = tally.abstain.minus(new BigDecimal(v.weight) || BigDecimal.zero())
    }
  }

  vote.save();
  tally.save();
}