import {
  convertToDecimal,
  createOrLoadDay,
  createOrLoadProtocol,
  createOrLoadRound,
  getBlockNum,
  makeEventId,
  ZERO_BD,
} from "../../utils/helpers";
import { Mint, Burn } from "../types/LivepeerToken/LivepeerToken";
import { Transaction, MintEvent, BurnEvent } from "../types/schema";

export function mint(event: Mint): void {
  let protocol = createOrLoadProtocol();
  let day = createOrLoadDay(event.block.timestamp.toI32());
  let amount = convertToDecimal(event.params.amount);
  let totalSupply = protocol.totalSupply.plus(amount);

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

  let tx =
    Transaction.load(event.transaction.hash.toHex()) ||
    new Transaction(event.transaction.hash.toHex());
  tx.blockNumber = event.block.number;
  tx.gasUsed = event.transaction.gasUsed;
  tx.gasPrice = event.transaction.gasPrice;
  tx.timestamp = event.block.timestamp.toI32();
  tx.from = event.transaction.from.toHex();
  tx.to = event.transaction.to.toHex();
  tx.save();

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
  let totalSupply = protocol.totalSupply.minus(value);

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

  let tx =
    Transaction.load(event.transaction.hash.toHex()) ||
    new Transaction(event.transaction.hash.toHex());
  tx.blockNumber = event.block.number;
  tx.gasUsed = event.transaction.gasUsed;
  tx.gasPrice = event.transaction.gasPrice;
  tx.timestamp = event.block.timestamp.toI32();
  tx.from = event.transaction.from.toHex();
  tx.to = event.transaction.to.toHex();
  tx.save();

  let burnEvent = new BurnEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  burnEvent.transaction = event.transaction.hash.toHex();
  burnEvent.timestamp = event.block.timestamp.toI32();
  burnEvent.round = round.id;
  burnEvent.value = value;
  burnEvent.save();
}
