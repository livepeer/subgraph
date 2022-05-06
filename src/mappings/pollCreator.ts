import {
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId
} from "../../utils/helpers";
import { PollCreated } from "../types/PollCreator/PollCreator";
import { Poll, PollCreatedEvent } from "../types/schema";
import { Poll as PollTemplate } from "../types/templates";

export function pollCreated(event: PollCreated): void {
  let round = createOrLoadRound(getBlockNum());

  let poll = new Poll(event.params.poll.toHex());
  poll.tally = event.params.poll.toHex();
  poll.proposal = event.params.proposal.toString();
  poll.endBlock = event.params.endBlock;
  poll.quorum = event.params.quorum;
  poll.quota = event.params.quota;
  poll.votes = [];
  poll.save();

  // Instantiate data source template
  PollTemplate.create(event.params.poll);

  createOrLoadTransactionFromEvent(event);

  let pollCreatedEvent = new PollCreatedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  pollCreatedEvent.transaction = event.transaction.hash.toHex();
  pollCreatedEvent.timestamp = event.block.timestamp.toI32();
  pollCreatedEvent.round = round.id;
  pollCreatedEvent.poll = event.params.poll.toHex();
  pollCreatedEvent.proposal = event.params.proposal;
  pollCreatedEvent.endBlock = event.params.endBlock;
  pollCreatedEvent.quorum = event.params.quorum;
  pollCreatedEvent.quota = event.params.quota;
  pollCreatedEvent.save();
}
