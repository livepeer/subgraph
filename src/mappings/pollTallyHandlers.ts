import { Address, BigDecimal, dataSource } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadRound,
  createOrLoadTranscoder,
  createOrLoadVote,
  getBlockNum,
  integerFromString,
  makeVoteId,
  ZERO_BI,
} from "../../utils/helpers";
import {
  Bond,
  BondingManager,
  Rebond,
  Reward,
  Unbond,
} from "../types/BondingManager/BondingManager";
import { Delegator, Poll, Transcoder, Vote } from "../types/schema";
import { tallyVotes } from "./poll";

export function updatePollTallyOnReward(event: Reward): void {
  let voterAddress = dataSource.context().getString("voter");
  let delegator = Delegator.load(voterAddress) as Delegator;

  // Return if transcoder that called reward isn't voter's delegate
  if (
    delegator === null ||
    delegator.delegate != event.params.transcoder.toHex()
  ) {
    return;
  }

  let pollAddress = dataSource.context().getString("poll");
  let poll = Poll.load(pollAddress) as Poll;

  // Return if poll is no longer active
  if (poll.endBlock.lt(event.block.number)) {
    return;
  }

  let round = createOrLoadRound(getBlockNum());
  let voteId = makeVoteId(delegator.id, poll.id);
  let vote = createOrLoadVote(voteId);
  let transcoder = createOrLoadTranscoder(event.params.transcoder.toHex());

  // update vote stakes
  if (voterAddress == event.params.transcoder.toHex()) {
    vote.voteStake = transcoder.totalStake as BigDecimal;
  } else {
    let bondingManager = BondingManager.bind(event.address);
    let pendingStake = convertToDecimal(
      bondingManager.pendingStake(
        Address.fromString(voterAddress),
        integerFromString(round.id)
      )
    );

    let delegateVoteId = makeVoteId(event.params.transcoder.toHex(), poll.id);
    let delegateVote = createOrLoadVote(delegateVoteId);
    delegateVote.voter = event.params.transcoder.toHex();

    // update nonVoteStake
    delegateVote.nonVoteStake = delegateVote.nonVoteStake
      .minus(vote.voteStake as BigDecimal)
      .plus(pendingStake);

    delegateVote.save();

    vote.voteStake = pendingStake;
  }

  vote.save();
  tallyVotes(poll);
}

export function updatePollTallyOnBond(event: Bond): void {
  let pollAddress = dataSource.context().getString("poll");
  let poll = Poll.load(pollAddress) as Poll;

  // Return if poll is no longer active
  if (poll.endBlock.lt(event.block.number)) {
    return;
  }

  let voterAddress = dataSource.context().getString("voter");
  let updateTally = false;
  let isSwitchingDelegates =
    event.params.bondedAmount
      .minus(event.params.additionalAmount)
      .gt(ZERO_BI) &&
    event.params.oldDelegate.toHex() != event.params.newDelegate.toHex();
  let oldDelegateVoteId = makeVoteId(
    event.params.oldDelegate.toHex(),
    pollAddress
  );
  let oldDelegateVote = createOrLoadVote(oldDelegateVoteId);
  let oldDelegate = createOrLoadTranscoder(event.params.oldDelegate.toHex());
  let newDelegateVoteId = makeVoteId(
    event.params.newDelegate.toHex(),
    pollAddress
  );
  let newDelegateVote = createOrLoadVote(newDelegateVoteId);
  let newDelegate = createOrLoadTranscoder(event.params.newDelegate.toHex());
  let voteId = makeVoteId(voterAddress, pollAddress);
  let vote = createOrLoadVote(voteId);
  let bondedAmount = convertToDecimal(event.params.bondedAmount);

  if (oldDelegateVote) {
    updateTally = true;
    if (oldDelegate.status == "Registered") {
      oldDelegateVote.registeredTranscoder = true;
    } else {
      oldDelegateVote.registeredTranscoder = false;
    }
    if (isSwitchingDelegates) {
      // if old delegate voted, update its vote stake
      if (oldDelegateVote.choiceID != null) {
        oldDelegateVote.voteStake = oldDelegate.totalStake as BigDecimal;
      }

      // if caller is voter, remove its nonVoteStake from old delegate
      if (voterAddress == event.params.delegator.toHex()) {
        oldDelegateVote.nonVoteStake = oldDelegateVote.nonVoteStake.minus(
          bondedAmount.minus(convertToDecimal(event.params.additionalAmount))
        );
      }
    }
    oldDelegateVote.save();
  }

  if (newDelegateVote) {
    updateTally = true;
    if (newDelegate.status == "Registered") {
      newDelegateVote.registeredTranscoder = true;
      if (newDelegateVote.choiceID != null) {
        newDelegateVote.voteStake = newDelegate.totalStake as BigDecimal;
      }
    } else {
      newDelegateVote.registeredTranscoder = false;
    }
    newDelegateVote.save();
  }

  // if caller is voter and *not* a registered transcoder update its vote
  if (
    voterAddress == event.params.delegator.toHex() &&
    voterAddress != event.params.newDelegate.toHex()
  ) {
    updateTally = true;

    // if delegate has not voted, create a "placeholder" vote for tracking
    // nonVoteStake in case it happens to register during the poll period
    if (newDelegateVote == null) {
      newDelegateVote = new Vote(newDelegateVoteId);
      if (newDelegate.status == "Registered") {
        newDelegateVote.registeredTranscoder = true;
      } else {
        newDelegateVote.registeredTranscoder = false;
      }
    }

    newDelegateVote.voter = event.params.newDelegate.toHex();

    // if switching, add stake to new delegate's nonVoteStake, otherwise update
    // new delegate's nonVoteStake
    if (isSwitchingDelegates) {
      newDelegateVote.nonVoteStake = newDelegateVote.nonVoteStake.plus(
        bondedAmount
      );
    } else {
      newDelegateVote.nonVoteStake = newDelegateVote.nonVoteStake
        .minus(vote.voteStake as BigDecimal)
        .plus(bondedAmount);
    }

    newDelegateVote.save();

    vote.voteStake = bondedAmount;
    vote.save();
  }

  // if delegator, oldDelegate, or newDelegate attached to event voted in poll
  // then update the tally
  if (updateTally) {
    tallyVotes(poll);
  }
}

export function updatePollTallyOnUnbond(event: Unbond): void {
  updatePollTally(event);
}

export function updatePollTallyOnRebond(event: Rebond): void {
  updatePollTally(event);
}

function updatePollTally<T extends Rebond>(event: T): void {
  let pollAddress = dataSource.context().getString("poll");
  let poll = Poll.load(pollAddress) as Poll;
  let updateTally = false;

  // Return if poll is no longer active
  if (poll.endBlock.lt(event.block.number)) {
    return;
  }

  let round = createOrLoadRound(getBlockNum());
  let voterAddress = dataSource.context().getString("voter");
  let voteId = makeVoteId(voterAddress, pollAddress);
  let vote = createOrLoadVote(voteId);
  let delegateVoteId = makeVoteId(event.params.delegate.toHex(), pollAddress);
  let delegateVote = createOrLoadVote(delegateVoteId);
  let delegate = createOrLoadTranscoder(event.params.delegate.toHex());
  let bondingManager = BondingManager.bind(event.address);

  if (delegateVote) {
    updateTally = true;
    if (delegate.status == "Registered") {
      delegateVote.registeredTranscoder = true;
      if (delegateVote.choiceID != null) {
        delegateVote.voteStake = delegate.totalStake as BigDecimal;
      }
    } else {
      delegateVote.registeredTranscoder = false;
      if (delegateVote.choiceID != null) {
        delegateVote.voteStake = convertToDecimal(
          bondingManager.pendingStake(
            event.params.delegate,
            integerFromString(round.id)
          )
        );
      }
    }
    delegateVote.save();
  }

  if (
    voterAddress == event.params.delegator.toHex() &&
    voterAddress != event.params.delegate.toHex()
  ) {
    updateTally = true;

    let pendingStake = convertToDecimal(
      bondingManager.pendingStake(
        Address.fromString(voterAddress),
        integerFromString(round.id)
      )
    );

    if (delegateVote == null) {
      delegateVote = new Vote(delegateVoteId);
    }
    delegateVote.voter = event.params.delegate.toHex();
    delegateVote.nonVoteStake = delegateVote.nonVoteStake
      .minus(vote.voteStake as BigDecimal)
      .plus(pendingStake);
    if (delegate.status == "Registered") {
      delegateVote.registeredTranscoder = true;
    } else {
      delegateVote.registeredTranscoder = false;
    }
    vote.voteStake = pendingStake;

    delegateVote.save();
    vote.save();
  }

  // if delegator or delegate attached to event voted in poll then update tally
  if (updateTally) {
    tallyVotes(poll);
  }
}
