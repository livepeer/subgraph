import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  dataSource,
  ethereum,
} from "@graphprotocol/graph-ts";
import { RoundsManager } from "../src/types/RoundsManager/RoundsManager";
import {
  Broadcaster,
  Day,
  Delegator,
  Protocol,
  Round,
  Transaction,
  Transcoder,
  TranscoderDay,
  Vote,
} from "../src/types/schema";

let x = BigInt.fromI32(2);
let y = 255 as u8;
let z = BigInt.fromI32(1);

export let MAXIMUM_VALUE_UINT256: BigInt = x.pow(y).minus(z);
export let EMPTY_ADDRESS = Address.fromString(
  "0000000000000000000000000000000000000000"
);
export let PERC_DIVISOR = 1000000;

export let ZERO_BI = BigInt.fromI32(0);
export let ONE_BI = BigInt.fromI32(1);
export let ZERO_BD = BigDecimal.fromString("0");
export let ONE_BD = BigDecimal.fromString("1");
export let BI_18 = BigInt.fromI32(18);

// Make a number the specified number of digits
export function leftPad(str: string, size: i32): string {
  while (str.length < size) {
    str = "0" + str;
  }
  return str;
}

// Make a derived pool ID from a transcoder address
export function makePoolId(transcoderAddress: string, roundId: string): string {
  return leftPad(roundId, 10) + "-" + transcoderAddress;
}

// Make a derived share ID from a delegator address
export function makeShareId(delegatorAddress: string, roundId: string): string {
  return leftPad(roundId, 10) + "-" + delegatorAddress;
}

// Make a vote id
export function makeVoteId(
  delegatorAddress: string,
  pollAddress: string
): string {
  return delegatorAddress + "-" + pollAddress;
}

// Make a derived unlocking ID from a delegator address
export function makeUnbondingLockId(
  delegatorAddress: Address,
  unbondingLockId: BigInt
): string {
  return (
    leftPad(unbondingLockId.toString(), 10) + "-" + delegatorAddress.toHex()
  );
}

export function makeEventId(hash: Bytes, index: BigInt): string {
  return hash.toHex() + "-" + index.toString();
}

export function percOfWithDenom(
  _amount: BigInt,
  _fracNum: BigInt,
  _fracDenom: BigInt
): BigInt {
  return _amount
    .times(percPoints(_fracNum, _fracDenom))
    .div(BigInt.fromI32(PERC_DIVISOR));
}

export function percOf(_amount: BigInt, _fracNum: BigInt): BigInt {
  return _amount.times(_fracNum).div(BigInt.fromI32(PERC_DIVISOR));
}

export function percPoints(_fracNum: BigInt, _fracDenom: BigInt): BigInt {
  return _fracNum.times(BigInt.fromI32(PERC_DIVISOR)).div(_fracDenom);
}

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString("1");
  for (let i = ZERO_BI; i.lt(decimals); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString("10"));
  }
  return bd;
}

export function convertToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(BI_18));
}

export function createOrLoadTransactionFromEvent<T extends ethereum.Event>(
  event: T
): Transaction {
  let tx = Transaction.load(event.transaction.hash.toHex());
  if (tx == null) {
    tx = new Transaction(event.transaction.hash.toHex());

    tx.blockNumber = event.block.number;
    tx.gasUsed = event.transaction.gasLimit;
    tx.gasPrice = event.transaction.gasPrice;
    tx.timestamp = event.block.timestamp.toI32();
    tx.from = event.transaction.from.toHex();

    if (event.transaction.to) {
      tx.to = event.transaction.to!.toHex();
    }

    tx.save();
  }
  return tx;
}

export function createOrLoadProtocol(): Protocol {
  let protocol = Protocol.load("0");
  if (protocol == null) {
    protocol = new Protocol("0");
    protocol.paused = false;
    protocol.currentRound = ZERO_BI.toString();
    protocol.lastInitializedRound = ZERO_BI.toString();
    protocol.lastRoundLengthUpdateRound = ZERO_BI.toString();
    protocol.inflation = ZERO_BI;
    protocol.inflationChange = ZERO_BI;
    protocol.lastRoundLengthUpdateStartBlock = ZERO_BI;
    protocol.lockPeriod = ZERO_BI;
    let roundsManager = RoundsManager.bind(
      Address.fromString(getRoundsManagerAddress())
    );
    protocol.roundLength = roundsManager.roundLength();
    protocol.roundLockAmount = ZERO_BI;
    protocol.targetBondingRate = ZERO_BI;
    protocol.totalActiveStake = ZERO_BD;
    protocol.totalSupply = ZERO_BD;
    protocol.participationRate = ZERO_BD;
    protocol.totalVolumeETH = ZERO_BD;
    protocol.totalVolumeUSD = ZERO_BD;
    protocol.unbondingPeriod = ZERO_BI;
    protocol.numActiveTranscoders = 0;
    protocol.winningTicketCount = 0;
    protocol.roundCount = 0;
    protocol.pendingActivation = [];
    protocol.pendingDeactivation = [];
    protocol.save();
  }
  return protocol;
}

export function createOrLoadBroadcaster(id: string): Broadcaster {
  let broadcaster = Broadcaster.load(id);

  if (broadcaster == null) {
    broadcaster = new Broadcaster(id);
    broadcaster.deposit = ZERO_BD;
    broadcaster.reserve = ZERO_BD;

    broadcaster.save();
  }

  return broadcaster;
}

export function createOrLoadVote(id: string): Vote {
  let vote = Vote.load(id);

  if (vote == null) {
    vote = new Vote(id);
    vote.voter = EMPTY_ADDRESS.toHexString();
    vote.voteStake = ZERO_BD;
    vote.nonVoteStake = ZERO_BD;

    // bool types must be set to something before they can accessed
    vote.registeredTranscoder = false;

    vote.save();
  }

  return vote;
}

export function createOrLoadTranscoder(id: string): Transcoder {
  let transcoder = Transcoder.load(id);
  if (transcoder == null) {
    transcoder = new Transcoder(id);
    transcoder.activationRound = ZERO_BI;
    transcoder.deactivationRound = ZERO_BI;
    transcoder.lastActiveStakeUpdateRound = ZERO_BI;
    transcoder.active = false;
    transcoder.status = "NotRegistered";
    transcoder.rewardCut = ZERO_BI;
    transcoder.feeShare = ZERO_BI;
    transcoder.pricePerSegment = ZERO_BI;
    transcoder.pendingPricePerSegment = ZERO_BI;
    transcoder.pendingRewardCut = ZERO_BI;
    transcoder.pendingFeeShare = ZERO_BI;
    transcoder.totalStake = ZERO_BD;
    transcoder.totalVolumeETH = ZERO_BD;
    transcoder.totalVolumeUSD = ZERO_BD;
    transcoder.save();
  }
  return transcoder;
}

export function createOrLoadDelegator(id: string): Delegator {
  let delegator = Delegator.load(id);
  if (delegator == null) {
    delegator = new Delegator(id);
    delegator.startRound = ZERO_BI;
    delegator.bondedAmount = ZERO_BD;
    delegator.principal = ZERO_BD;
    delegator.unbonded = ZERO_BD;
    delegator.fees = ZERO_BD;
    delegator.withdrawnFees = ZERO_BD;
    delegator.delegatedAmount = ZERO_BD;
    delegator.save();
  }
  return delegator;
}

export function createOrLoadDay(timestamp: i32): Day {
  let dayID = timestamp / 86400;
  let dayStartTimestamp = dayID * 86400;
  let day = Day.load(dayID.toString());

  if (day == null) {
    day = new Day(dayID.toString());
    day.date = dayStartTimestamp;
    day.volumeUSD = ZERO_BD;
    day.volumeETH = ZERO_BD;
    day.totalSupply = ZERO_BD;
    day.totalActiveStake = ZERO_BD;
    day.participationRate = ZERO_BD;
    day.save();
  }
  return day;
}

export function createOrLoadTranscoderDay(
  timestamp: i32,
  transcoderAddress: string
): TranscoderDay {
  let dayID = timestamp / 86400;
  let dayStartTimestamp = dayID * 86400;
  let transcoderDayID = transcoderAddress
    .concat("-")
    .concat(BigInt.fromI32(dayID).toString());
  let transcoderDay = TranscoderDay.load(transcoderDayID);

  if (transcoderDay == null) {
    transcoderDay = new TranscoderDay(transcoderDayID);
    transcoderDay.date = dayStartTimestamp;
    transcoderDay.transcoder = transcoderAddress;
    transcoderDay.volumeUSD = ZERO_BD;
    transcoderDay.volumeETH = ZERO_BD;
    transcoderDay.save();
  }
  return transcoderDay;
}

export function createOrLoadRound(blockNumber: BigInt): Round {
  let protocol = createOrLoadProtocol();
  let roundsSinceLastUpdate = blockNumber
    .minus(protocol.lastRoundLengthUpdateStartBlock)
    .div(protocol.roundLength);

  let newRound = integerFromString(protocol.lastRoundLengthUpdateRound).plus(
    roundsSinceLastUpdate
  );

  let round = Round.load(newRound.toString());

  if (round) {
    // We are already aware of this round so just return it without creating a new one
    return round;
  }

  // Need to get the start block according to the contracts, not just the start block this
  // entity was created in the subgraph
  let startBlock = protocol.lastRoundLengthUpdateStartBlock.plus(
    roundsSinceLastUpdate.times(protocol.roundLength)
  );
  // We are not aware of this round so create and return it
  protocol.roundCount = protocol.roundCount + 1;
  protocol.currentRound = newRound.toString();
  protocol.save();

  return createRound(startBlock, protocol.roundLength, newRound);
}

export function createRound(
  startBlock: BigInt,
  roundLength: BigInt,
  roundNumber: BigInt
): Round {
  let protocol = createOrLoadProtocol();
  let round = new Round(roundNumber.toString());
  round.startBlock = startBlock;
  round.endBlock = startBlock.plus(roundLength);
  round.initialized = false;
  round.length = roundLength;
  round.startBlock = startBlock;
  round.totalActiveStake = protocol.totalActiveStake;
  round.totalSupply = protocol.totalSupply;
  round.participationRate = protocol.participationRate;
  round.mintableTokens = ZERO_BD;
  round.volumeETH = ZERO_BD;
  round.volumeUSD = ZERO_BD;
  round.movedStake = ZERO_BD;
  round.newStake = ZERO_BD;
  round.save();
  return round;
}

// return 0 if denominator is 0 in division
export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.equals(ZERO_BD)) {
    return ZERO_BD;
  } else {
    return amount0.div(amount1);
  }
}

let Q192 = 2 ** 192;
export function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: BigInt,
  token0Decimals: BigInt,
  token1Decimals: BigInt
): BigDecimal[] {
  let num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal();
  let denom = BigDecimal.fromString(Q192.toString());
  let price1 = num
    .div(denom)
    .times(exponentToBigDecimal(token0Decimals))
    .div(exponentToBigDecimal(token1Decimals));

  let price0 = safeDiv(BigDecimal.fromString("1"), price1);
  return [price0, price1];
}

export function integerFromString(s: string): BigInt {
  return BigInt.fromString(s);
}

export function getUniswapV3DaiEthPoolAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "0xa961f0473da4864c5ed28e00fcc53a3aab056c1b";
  } else if (network == "arbitrum-rinkeby") {
    return "01ab0834e140f1d33c99b6380a77a6b75b283b3f";
  } else {
    return "01ab0834e140f1d33c99b6380a77a6b75b283b3f";
  }
}

export function getBondingManagerAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "35Bcf3c30594191d53231E4FF333E8A770453e40";
  } else if (network == "arbitrum-rinkeby") {
    return "e42229d764F673EB3FB8B9a56016C2a4DA45ffd7";
  } else {
    return "f71AA2E1DE77E8eE9cbB88A91Dbd228FF3160635";
  }
}

export function getRoundsManagerAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "dd6f56DcC28D3F5f27084381fE8Df634985cc39f";
  } else if (network == "arbitrum-rinkeby") {
    return "3BEc08BA9D8A5b44F5C5E38F654b3efE73555d58";
  } else {
    return "4D3620B1d9146116707d763AEbFe3dF59E00a883";
  }
}

export function getMinterAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "c20DE37170B45774e6CD3d2304017fc962f27252";
  } else if (network == "arbitrum-rinkeby") {
    return "E5bE54705D41DAaA33A043aa51dE472ED637C3d9";
  } else {
    return "3Eb31D0b427e40F01FA3d38F627fE928a33DA0E3";
  }
}

export function getBlockNum(): BigInt {
  let roundsManagerAddress = getRoundsManagerAddress();

  let roundsManager = RoundsManager.bind(
    Address.fromString(roundsManagerAddress)
  );
  return roundsManager.blockNum();
}
