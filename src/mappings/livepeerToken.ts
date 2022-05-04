import { Address, dataSource, log } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadDay,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  getMinterAddress,
  makeEventId,
  ZERO_BD,
} from "../../utils/helpers";
import { Mint, Burn } from "../types/LivepeerToken/LivepeerToken";
import { Minter } from "../types/Minter/Minter";
import { Transaction, MintEvent, BurnEvent } from "../types/schema";

export function mint(event: Mint): void {
  let protocol = createOrLoadProtocol();
  let day = createOrLoadDay(event.block.timestamp.toI32());
  let amount = convertToDecimal(event.params.amount);
  let minterAddress = getMinterAddress(dataSource.network());
  let minter = Minter.bind(Address.fromString(minterAddress));
  let callResult = minter.try_getGlobalTotalSupply();
  let totalSupply = ZERO_BD;

  // getGlobalTotalSupply will revert until block #6253359 when the new minter was deployed
  if (callResult.reverted) {
    log.info("getGlobalTotalSupply reverted", []);
    totalSupply = protocol.totalSupply.plus(
      convertToDecimal(event.params.amount)
    );
  } else {
    totalSupply = convertToDecimal(callResult.value);
  }

  protocol.totalSupply = totalSupply;

  day.totalSupply = totalSupply;
  day.totalActiveStake = protocol.totalActiveStake;

  // check if total active stake is greater than 0 to avoid divide by zero
  if (protocol.totalActiveStake.gt(ZERO_BD)) {
    protocol.participationRate = protocol.totalActiveStake.div(totalSupply);
    day.participationRate = protocol.participationRate;
  }

  let round = createOrLoadRound(getBlockNum());
  round.totalSupply = totalSupply;
  round.participationRate = protocol.participationRate;
  round.save();

  protocol.save();
  day.save();

  createOrLoadTransactionFromEvent(event);

  let mintEvent = new MintEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  mintEvent.transaction = event.transaction.hash.toHex();
  mintEvent.timestamp = event.block.timestamp.toI32();
  mintEvent.round = round.id;
  mintEvent.to = event.params.to.toHex();
  mintEvent.amount = amount;
  mintEvent.save();
}

export function burn(event: Burn): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(getBlockNum());
  let day = createOrLoadDay(event.block.timestamp.toI32());
  let value = convertToDecimal(event.params.value);
  let minterAddress = getMinterAddress(dataSource.network());
  let minter = Minter.bind(Address.fromString(minterAddress));

  let callResult = minter.try_getGlobalTotalSupply();
  let totalSupply = ZERO_BD;

  // getGlobalTotalSupply will revert until block #6253359 when the new minter was deployed
  if (callResult.reverted) {
    log.info("getGlobalTotalSupply reverted", []);
    totalSupply = protocol.totalSupply.minus(
      convertToDecimal(event.params.value)
    );
  } else {
    totalSupply = convertToDecimal(callResult.value);
  }

  protocol.totalSupply = totalSupply;

  day.totalSupply = totalSupply;
  day.totalActiveStake = protocol.totalActiveStake;

  if (protocol.totalActiveStake.gt(ZERO_BD)) {
    protocol.participationRate = protocol.totalActiveStake.div(totalSupply);
    day.participationRate = protocol.participationRate;
  }

  round.totalSupply = totalSupply;
  round.participationRate = protocol.participationRate;
  round.save();

  protocol.save();
  day.save();

  createOrLoadTransactionFromEvent(event);

  let burnEvent = new BurnEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  burnEvent.transaction = event.transaction.hash.toHex();
  burnEvent.timestamp = event.block.timestamp.toI32();
  burnEvent.round = round.id;
  burnEvent.value = value;
  burnEvent.save();
}
