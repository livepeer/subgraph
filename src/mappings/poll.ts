import {
  Address,
  BigDecimal,
  dataSource,
  DataSourceContext,
} from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createOrLoadVote,
  getBlockNum,
  getBondingManagerAddress,
  integerFromString,
  makeEventId,
  makeVoteId,
  ONE_BI,
  ZERO_BD,
  ZERO_BI,
} from "../../utils/helpers";
import { BondingManager } from "../types/BondingManager/BondingManager";
import { Delegator, Poll, PollTally, Vote, VoteEvent } from "../types/schema";
import { PollTallyTemplate } from "../types/templates";
import { Vote as VoteEventParam } from "../types/templates/Poll/Poll";

export function vote(event: VoteEventParam): void {
  // Vote must be a "Yes" or "No"
  if (
    event.params.choiceID.notEqual(ZERO_BI) &&
    event.params.choiceID.notEqual(ONE_BI)
  ) {
    return;
  }
  let round = createOrLoadRound(getBlockNum());
  let poll = Poll.load(event.address.toHex()) as Poll;
  let voteId = makeVoteId(event.params.voter.toHex(), poll.id);

  let v = createOrLoadVote(voteId);

  let firstTimeVoter = v.choiceID == null;

  if (event.params.choiceID.equals(ZERO_BI)) {
    v.choiceID = "Yes";
  } else {
    v.choiceID = "No";
  }

  if (firstTimeVoter) {
    v.voter = event.params.voter.toHex();
    v.poll = poll.id;

    // add vote to poll
    let pollVotes = (poll.votes ? poll.votes : new Array<string>()) as string[];
    pollVotes.push(voteId);
    poll.votes = pollVotes;
    poll.save();

    // if voter is a delegator
    let delegator = Delegator.load(event.params.voter.toHex());
    if (delegator && delegator.delegate !== null) {
      let delegate = createOrLoadTranscoder(delegator.delegate!);

      // If voter is a registered transcoder
      if (event.params.voter.toHex() == delegator.delegate) {
        v.voteStake = delegate.totalStake as BigDecimal;
        v.registeredTranscoder = true;
      } else {
        let bondingManagerAddress = getBondingManagerAddress(
          dataSource.network()
        );
        let bondingManager = BondingManager.bind(
          Address.fromString(bondingManagerAddress)
        );
        let pendingStake = convertToDecimal(
          bondingManager.pendingStake(
            event.params.voter,
            integerFromString(round.id)
          )
        );
        v.voteStake = pendingStake;
        v.registeredTranscoder = false;

        // update delegate's vote
        let delegateVoteId = makeVoteId(delegate.id, poll.id);
        let delegateVote = createOrLoadVote(delegateVoteId);
        if (delegate.status == "Registered") {
          delegateVote.registeredTranscoder = true;
        } else {
          delegateVote.registeredTranscoder = false;
        }
        delegateVote.voter = delegate.id;

        delegateVote.nonVoteStake = delegateVote.nonVoteStake.plus(
          v.voteStake as BigDecimal
        );
        delegateVote.save();
      }
    }

    // Watch for events specified in PollTallyTemplate, and trigger handlers
    // with this context
    let context = new DataSourceContext();
    context.setString("poll", poll.id);
    context.setString("voter", event.params.voter.toHex());
    let bondingManagerAddress = getBondingManagerAddress(dataSource.network());
    PollTallyTemplate.createWithContext(
      Address.fromString(bondingManagerAddress),
      context
    );
  }

  v.save();

  // if voter has stake, update poll tally
  if (v.voteStake) {
    tallyVotes(poll);
  }

  createOrLoadTransactionFromEvent(event);

  let voteEvent = new VoteEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  voteEvent.transaction = event.transaction.hash.toHex();
  voteEvent.timestamp = event.block.timestamp.toI32();
  voteEvent.round = round.id;
  voteEvent.choiceID = event.params.choiceID;
  voteEvent.voter = event.params.voter.toHex();
  voteEvent.poll = event.address.toHex();
  voteEvent.save();
}

export function tallyVotes(poll: Poll): void {
  let pollTally = new PollTally(poll.id);
  let votes = poll.votes as Array<string>;
  let v: Vote;
  let nonVoteStake = ZERO_BD;
  pollTally.yes = ZERO_BD;
  pollTally.no = ZERO_BD;

  for (let i = 0; i < votes.length; i++) {
    v = Vote.load(votes[i]) as Vote;

    // Only subtract nonVoteStake if delegate was registered during poll period
    nonVoteStake = v.registeredTranscoder
      ? (v.nonVoteStake as BigDecimal)
      : ZERO_BD;

    if (v.choiceID == "Yes") {
      pollTally.yes = pollTally.yes.plus(v.voteStake.minus(nonVoteStake));
    }
    if (v.choiceID == "No") {
      pollTally.no = pollTally.no.plus(v.voteStake.minus(nonVoteStake));
    }
  }
  pollTally.save();
}
