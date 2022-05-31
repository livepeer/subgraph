import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadDay,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createRound,
  EMPTY_ADDRESS,
  getBlockNum,
  getBondingManagerAddress,
  getLptPriceEth,
  getTimestampForDaysPast,
  makeEventId,
  makePoolId,
  ONE_BD,
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
  TranscoderDay,
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

  let thirtyDayTimestamp = getTimestampForDaysPast(
    event.block.timestamp.toI32(),
    30
  );
  let sixtyDayTimestamp = getTimestampForDaysPast(
    event.block.timestamp.toI32(),
    60
  );
  let ninetyDayTimestamp = getTimestampForDaysPast(
    event.block.timestamp.toI32(),
    90
  );

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

    if (transcoder) {
      // --- Get the 30, 60, 90 day sums of volume ---
      let thirtyDaySum = ZERO_BD;
      let sixtyDaySum = ZERO_BD;
      let ninetyDaySum = ZERO_BD;

      // capped at <90 - transcoder days are ordered newest first
      let daysLength =
        transcoder.transcoderDays.length > 90
          ? 90
          : transcoder.transcoderDays.length;
      for (let i = 0; i < daysLength; i++) {
        let transcoderDay = TranscoderDay.load(transcoder.transcoderDays[i]);

        if (transcoderDay) {
          if (transcoderDay.date >= thirtyDayTimestamp) {
            thirtyDaySum = thirtyDaySum.plus(transcoderDay.volumeETH);
          }
          if (transcoderDay.date >= sixtyDayTimestamp) {
            sixtyDaySum = sixtyDaySum.plus(transcoderDay.volumeETH);
          }
          if (transcoderDay.date >= ninetyDayTimestamp) {
            ninetyDaySum = ninetyDaySum.plus(transcoderDay.volumeETH);
          }
        }
      }

      transcoder.thirtyDayVolumeETH = thirtyDaySum;
      transcoder.sixtyDayVolumeETH = sixtyDaySum;
      transcoder.ninetyDayVolumeETH = ninetyDaySum;

      transcoder.save();
    }
  }

  let lptPriceEth = getLptPriceEth();

  protocol.lptPriceEth = lptPriceEth;
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

    let inflationRateBD = protocol.inflation
      .toBigDecimal()
      .div(BigDecimal.fromString("1000000000"));
    let roundsPerYear = 417;
    let totalSupply = protocol.totalSupply;
    let totalRewards = ZERO_BD;

    for (let i = 0; i < roundsPerYear; i++) {
      let roundRewards = totalSupply.times(inflationRateBD);
      totalRewards = totalRewards.plus(roundRewards);
      totalSupply = totalSupply.plus(roundRewards);
    }

    protocol.yearlyRewardsToStakeRatio = totalRewards.div(
      protocol.totalActiveStake
    );
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
