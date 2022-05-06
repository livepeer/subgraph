import {
  convertToDecimal,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId,
} from "../../utils/helpers";
import {
  Minter,
  ParameterUpdate,
  SetCurrentRewardTokens,
} from "../types/Minter/Minter";
import {
  ParameterUpdateEvent,
  SetCurrentRewardTokensEvent,
} from "../types/schema";

export function setCurrentRewardTokens(event: SetCurrentRewardTokens): void {
  let minter = Minter.bind(event.address);
  let protocol = createOrLoadProtocol();

  // The variables targetBondingRate, inflationChange, and inflation are
  // initially set inside the Minter's constructor, however constructors are
  // currently disallowed in call handlers so we'll set them in here for now
  protocol.targetBondingRate = minter.targetBondingRate();
  protocol.inflationChange = minter.inflationChange();
  protocol.inflation = minter.inflation();
  protocol.save();

  let round = createOrLoadRound(getBlockNum());

  round.mintableTokens = convertToDecimal(event.params.currentMintableTokens);
  round.save();

  createOrLoadTransactionFromEvent(event);
  let setCurrentRewardTokensEvent = new SetCurrentRewardTokensEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  setCurrentRewardTokensEvent.transaction = event.transaction.hash.toHex();
  setCurrentRewardTokensEvent.timestamp = event.block.timestamp.toI32();
  setCurrentRewardTokensEvent.round = round.id;
  setCurrentRewardTokensEvent.currentMintableTokens = convertToDecimal(
    event.params.currentMintableTokens
  );
  setCurrentRewardTokensEvent.currentInflation = event.params.currentInflation;
  setCurrentRewardTokensEvent.save();
}

export function parameterUpdate(event: ParameterUpdate): void {
  let minter = Minter.bind(event.address);
  let round = createOrLoadRound(getBlockNum());
  let protocol = createOrLoadProtocol();

  if (event.params.param == "targetBondingRate") {
    protocol.targetBondingRate = minter.targetBondingRate();
  }

  if (event.params.param == "inflationChange") {
    protocol.inflationChange = minter.inflationChange();
  }

  protocol.save();

  createOrLoadTransactionFromEvent(event);
  let parameterUpdateEvent = new ParameterUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  parameterUpdateEvent.transaction = event.transaction.hash.toHex();
  parameterUpdateEvent.timestamp = event.block.timestamp.toI32();
  parameterUpdateEvent.round = round.id;
  parameterUpdateEvent.param = event.params.param;
  parameterUpdateEvent.save();
}
