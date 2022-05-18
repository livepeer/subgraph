import {
  Address,
  BigDecimal,
  BigInt,
  dataSource,
  log,
} from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  getCalendarDate,
  createOrLoadDay,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createRound,
  EMPTY_ADDRESS,
  getBlockNum,
  getBondingManagerAddress,
  makeEventId,
  makePoolId,
  PERC_DIVISOR,
  ZERO_BD,
} from "../../utils/helpers";
import { BondingManager } from "../types/BondingManager/BondingManager";
// Import event types from the registrar contract ABIs
import {
  NewRound,
  ParameterUpdate,
  RoundsManager,
} from "../types/RoundsManager/RoundsManager";
// Import entity types generated from the GraphQL schema
import {
  NewRoundEvent,
  ParameterUpdateEvent,
  Pool,
  Transcoder,
} from "../types/schema";

// Handler for NewRound events
export function newRound(event: NewRound): void {
  let bondingManagerAddress = getBondingManagerAddress();
  let bondingManager = BondingManager.bind(
    Address.fromString(bondingManagerAddress)
  );
  let roundsManager = RoundsManager.bind(event.address);
  let blockNum = roundsManager.blockNum();
  let round = createOrLoadRound(blockNum);
  let day = createOrLoadDay(event.block.timestamp.toI32());
  let currentTranscoder = EMPTY_ADDRESS;
  let totalActiveStake = BigDecimal.zero();
  let transcoder: Transcoder | null = null;

  // will revert if there are no transcoders in pool
  let callResult = bondingManager.try_getFirstTranscoderInPool();
  if (callResult.reverted) {
    log.info("getFirstTranscoderInPool reverted", []);
  } else {
    currentTranscoder = callResult.value;
    transcoder = createOrLoadTranscoder(currentTranscoder.toHex());
  }

  // will revert if there is no LPT bonded
  let getTotalBondedCallResult = bondingManager.try_getTotalBonded();
  if (getTotalBondedCallResult.reverted) {
    log.info("getTotalBonded reverted", []);
  } else {
    totalActiveStake = convertToDecimal(getTotalBondedCallResult.value);
  }

  let date = getCalendarDate(event.block.timestamp.toI32());
  round.calendarDate = date.calendarDate;
  round.day = date.day;
  round.month = date.month;
  round.year = date.year;

  round.initialized = true;
  round.totalActiveStake = totalActiveStake;
  round.save();

  let poolId: string;
  let pool: Pool;
  let protocol = createOrLoadProtocol();

  // Activate all transcoders pending activation
  let pendingActivation = protocol.pendingActivation;
  if (pendingActivation.length) {
    for (let index = 0; index < pendingActivation.length; index++) {
      let t = createOrLoadTranscoder(pendingActivation[index]);
      t.active = true;
      t.save();
    }
    protocol.pendingActivation = [];
  }

  // Deactivate all transcoders pending deactivation
  let pendingDeactivation = protocol.pendingDeactivation;
  if (pendingDeactivation.length) {
    for (let index = 0; index < pendingDeactivation.length; index++) {
      let t = createOrLoadTranscoder(pendingDeactivation[index]);
      t.active = false;
      t.save();
    }
    protocol.pendingDeactivation = [];
  }

  // Iterate over all active transcoders
  while (EMPTY_ADDRESS.toHex() != currentTranscoder.toHex()) {
    // create a unique "pool" for each active transcoder. If a transcoder calls
    // reward() for a given round, we store its reward tokens inside this Pool
    // entry in a field called "rewardTokens". If "rewardTokens" is null for a
    // given transcoder and round then we know the transcoder failed to call reward()
    poolId = makePoolId(currentTranscoder.toHex(), round.id);
    pool = new Pool(poolId);
    pool.round = round.id;
    pool.delegate = currentTranscoder.toHex();
    if (transcoder) {
      pool.totalStake = transcoder.totalStake;
      pool.rewardCut = transcoder.rewardCut;
      pool.feeShare = transcoder.feeShare;
    }
    pool.save();

    currentTranscoder =
      bondingManager.getNextTranscoderInPool(currentTranscoder);

    transcoder = Transcoder.load(currentTranscoder.toHex());
  }

  protocol.lastInitializedRound = round.id;
  protocol.totalActiveStake = totalActiveStake;
  protocol.currentRound = round.id;

  day.totalActiveStake = totalActiveStake;
  day.totalSupply = protocol.totalSupply;

  if (
    protocol.totalActiveStake.gt(ZERO_BD) &&
    protocol.totalSupply.gt(ZERO_BD)
  ) {
    protocol.participationRate = protocol.totalActiveStake.div(
      protocol.totalSupply
    );
    round.participationRate = protocol.participationRate;
    day.participationRate = protocol.participationRate;
  }

  protocol.save();
  day.save();

  createOrLoadTransactionFromEvent(event);

  let newRoundEvent = new NewRoundEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  newRoundEvent.transaction = event.transaction.hash.toHex();
  newRoundEvent.timestamp = event.block.timestamp.toI32();
  newRoundEvent.round = round.id;
  newRoundEvent.blockHash = event.params.blockHash.toHexString();
  newRoundEvent.save();
}

export function parameterUpdate(event: ParameterUpdate): void {
  let roundsManager = RoundsManager.bind(event.address);
  let protocol = createOrLoadProtocol();
  let currentRound = roundsManager.currentRound();

  if (event.params.param == "roundLength") {
    let roundLength = roundsManager.roundLength();
    let lastRoundLengthUpdateStartBlock =
      roundsManager.lastRoundLengthUpdateStartBlock();
    let lastRoundLengthUpdateRound = roundsManager.lastRoundLengthUpdateRound();

    if (protocol.roundLength.toI32() == 0) {
      createRound(getBlockNum(), roundLength, currentRound);
    }
    protocol.roundLength = roundLength;
    protocol.lastRoundLengthUpdateStartBlock = lastRoundLengthUpdateStartBlock;
    protocol.lastRoundLengthUpdateRound = lastRoundLengthUpdateRound.toString();
    protocol.currentRound = currentRound.toString();
  }

  if (event.params.param == "roundLockAmount") {
    protocol.roundLockAmount = roundsManager.roundLockAmount();
    protocol.lockPeriod = roundsManager
      .roundLength()
      .times(roundsManager.roundLockAmount())
      .div(BigInt.fromI32(PERC_DIVISOR));
  }

  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let parameterUpdateEvent = new ParameterUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  parameterUpdateEvent.transaction = event.transaction.hash.toHex();
  parameterUpdateEvent.timestamp = event.block.timestamp.toI32();
  parameterUpdateEvent.round = currentRound.toString();
  parameterUpdateEvent.param = event.params.param;
  parameterUpdateEvent.save();
}
