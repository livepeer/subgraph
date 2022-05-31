import {
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId
} from "../../utils/helpers";
import { Pause, Unpause } from "../types/Controller/Controller";
import {
  PauseEvent,
  UnpauseEvent
} from "../types/schema";

export function pause(event: Pause): void {
  let round = createOrLoadRound(getBlockNum());
  let protocol = createOrLoadProtocol();
  protocol.paused = true;
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let pauseEvent = new PauseEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  pauseEvent.transaction = event.transaction.hash.toHex();
  pauseEvent.timestamp = event.block.timestamp.toI32();
  pauseEvent.round = round.id;
  pauseEvent.save();
}

export function unpause(event: Unpause): void {
  let round = createOrLoadRound(getBlockNum());
  let protocol = createOrLoadProtocol();
  protocol.paused = false;
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let unpauseEvent = new UnpauseEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  unpauseEvent.transaction = event.transaction.hash.toHex();
  unpauseEvent.timestamp = event.block.timestamp.toI32();
  unpauseEvent.round = round.id;
  unpauseEvent.save();
}
