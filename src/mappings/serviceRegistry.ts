import {
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  getBlockNum,
  makeEventId,
} from "../../utils/helpers";
// Import entity types generated from the GraphQL schema
import { ServiceURIUpdateEvent } from "../types/schema";
import { ServiceURIUpdate } from "../types/ServiceRegistry/ServiceRegistry";

export function serviceURIUpdate(event: ServiceURIUpdate): void {
  let round = createOrLoadRound(getBlockNum());
  let transcoder = createOrLoadTranscoder(
    event.params.addr.toHex(),
    event.block.timestamp.toI32()
  );
  transcoder.serviceURI = event.params.serviceURI;
  transcoder.save();

  createOrLoadTransactionFromEvent(event);

  let serviceURIUpdateEvent = new ServiceURIUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  serviceURIUpdateEvent.transaction = event.transaction.hash.toHex();
  serviceURIUpdateEvent.timestamp = event.block.timestamp.toI32();
  serviceURIUpdateEvent.round = round.id;
  serviceURIUpdateEvent.addr = event.params.addr.toHex();
  serviceURIUpdateEvent.serviceURI = event.params.serviceURI;
  serviceURIUpdateEvent.save();
}
