import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  dataSource,
} from "@graphprotocol/graph-ts";
import { integer } from "@protofire/subgraph-toolkit";
import {
  Day,
  Delegator,
  Protocol,
  Round,
  Transcoder,
  TranscoderDay,
} from "../src/types/schema";
import { RoundsManager } from "../src/types/RoundsManager/RoundsManager";

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
  for (let i = ZERO_BI; i.lt(decimals as BigInt); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString("10"));
  }
  return bd;
}

export function convertToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(BI_18));
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
    protocol.roundLength = ZERO_BI;
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
  return protocol as Protocol;
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
  return transcoder as Transcoder;
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
  return delegator as Delegator;
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
  return day as Day;
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
  return transcoderDay as TranscoderDay;
}

export function createOrLoadRound(blockNumber: BigInt): Round {
  let protocol = Protocol.load("0");
  let roundsSinceLastUpdate = blockNumber
    .minus(protocol.lastRoundLengthUpdateStartBlock)
    .div(protocol.roundLength);

  let newRound = integer
    .fromString(protocol.lastRoundLengthUpdateRound)
    .plus(roundsSinceLastUpdate);

  let round = Round.load(newRound.toString()) as Round;
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
  let protocol = Protocol.load("0");
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

export function getUniswapV3DaiEthPoolAddress(network: string): string {
  if (network == "arbitrum-one") {
    return "0xa961f0473da4864c5ed28e00fcc53a3aab056c1b";
  } else if (network == "arbitrum-rinkeby") {
    return "01ab0834e140f1d33c99b6380a77a6b75b283b3f";
  } else {
    return "01ab0834e140f1d33c99b6380a77a6b75b283b3f";
  }
}

export function getBondingManagerAddress(network: string): string {
  if (network == "arbitrum-one") {
    return "35Bcf3c30594191d53231E4FF333E8A770453e40";
  } else if (network == "arbitrum-rinkeby") {
    return "e42229d764F673EB3FB8B9a56016C2a4DA45ffd7";
  } else {
    return "A94B7f0465E98609391C623d0560C5720a3f2D33";
  }
}

export function getRoundsManagerAddress(network: string): string {
  if (network == "arbitrum-one") {
    return "dd6f56DcC28D3F5f27084381fE8Df634985cc39f";
  } else if (network == "arbitrum-rinkeby") {
    return "3BEc08BA9D8A5b44F5C5E38F654b3efE73555d58";
  } else {
    return "a3Aa52cE79e85a21d9cCdA705C57e426B160112c";
  }
}

export function getMinterAddress(network: string): string {
  if (network == "arbitrum-one") {
    return "c20DE37170B45774e6CD3d2304017fc962f27252";
  } else if (network == "arbitrum-rinkeby") {
    return "E5bE54705D41DAaA33A043aa51dE472ED637C3d9";
  } else {
    return "c20DE37170B45774e6CD3d2304017fc962f27252";
  }
}

export function getBlockNum(): BigInt {
  let network = dataSource.network();
  let roundsManagerAddress = "";
  if (network == "arbitrum-one") {
    roundsManagerAddress = "dd6f56DcC28D3F5f27084381fE8Df634985cc39f";
  } else if (network == "arbitrum-rinkeby") {
    roundsManagerAddress = "3BEc08BA9D8A5b44F5C5E38F654b3efE73555d58";
  } else {
    roundsManagerAddress = "C40df4db2f99e7e235780A93B192F1a934f0c45b";
  }

  let roundsManager = RoundsManager.bind(
    Address.fromString(roundsManagerAddress)
  );
  return roundsManager.blockNum();
}
