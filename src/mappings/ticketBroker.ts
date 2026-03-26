import { Address, BigInt, dataSource, log } from "@graphprotocol/graph-ts";
import {
  convertFromDecimal,
  convertToDecimal,
  createOrLoadBroadcaster,
  createOrLoadBroadcasterDay,
  createOrLoadDay,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createOrLoadTranscoderDay,
  getBlockNum,
  getEthPriceUsd,
  integerFromString,
  makeEventId,
  makePoolId,
  ONE_BI,
  percOf,
  PRECISE_PERC_DIVISOR,
  precisePercOf,
  ZERO_BD,
  ZERO_BI,
} from "../../utils/helpers";
import {
  DepositFundedEvent,
  Pool,
  ReserveClaimedEvent,
  ReserveFundedEvent,
  WinningTicketRedeemedEvent,
  WithdrawalEvent,
} from "../types/schema";
import {
  DepositFunded,
  ReserveClaimed,
  ReserveFunded,
  WinningTicketRedeemed,
  Withdrawal,
} from "../types/TicketBroker/TicketBroker";

export function winningTicketRedeemed(event: WinningTicketRedeemed): void {
  let round = createOrLoadRound(getBlockNum());
  let timestamp = event.block.timestamp.toI32();
  let day = createOrLoadDay(timestamp);
  let winningTicketRedeemedEvent = new WinningTicketRedeemedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  let protocol = createOrLoadProtocol();
  let faceValue = convertToDecimal(event.params.faceValue);
  let ethPrice = getEthPriceUsd();
  let faceValueUSD = faceValue.times(ethPrice);
  let poolId = makePoolId(event.params.recipient.toHex(), round.id);
  let pool = Pool.load(poolId);

  createOrLoadTransactionFromEvent(event);

  winningTicketRedeemedEvent.transaction = event.transaction.hash.toHex();
  winningTicketRedeemedEvent.timestamp = event.block.timestamp.toI32();
  winningTicketRedeemedEvent.round = round.id;
  winningTicketRedeemedEvent.sender = event.params.sender.toHex();
  winningTicketRedeemedEvent.recipient = event.params.recipient.toHex();
  winningTicketRedeemedEvent.faceValue = faceValue;
  winningTicketRedeemedEvent.faceValueUSD = faceValueUSD;
  winningTicketRedeemedEvent.winProb = event.params.winProb;
  winningTicketRedeemedEvent.senderNonce = event.params.senderNonce;
  winningTicketRedeemedEvent.recipientRand = event.params.recipientRand;
  winningTicketRedeemedEvent.auxData = event.params.auxData;
  winningTicketRedeemedEvent.save();

  // The faceValue of the ticket will be subtracted from the ticket sender (broadcaster) deposit.
  // In case the deposit is insufficient to cover the faceValue, the difference will be subtracted from the reserve.
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  if (faceValue.gt(broadcaster.deposit)) {
    broadcaster.deposit = ZERO_BD;

    let difference = faceValue.minus(broadcaster.deposit);
    if (difference.gt(broadcaster.reserve)) {
      // we have an error here, broadcaster reserves have been fully depleted
      log.error("Broadcaster reserves have been depleted to zero for ID: {}", [
        broadcaster.id,
      ]);
      broadcaster.reserve = ZERO_BD;
    } else {
      broadcaster.reserve = broadcaster.reserve.minus(difference);
    }
  } else {
    broadcaster.deposit = broadcaster.deposit.minus(faceValue);
  }

  broadcaster.totalVolumeETH = broadcaster.totalVolumeETH.plus(faceValue);
  broadcaster.totalVolumeUSD = broadcaster.totalVolumeUSD.plus(faceValueUSD);
  
  let broadcasterDay = createOrLoadBroadcasterDay(
    timestamp,
    event.params.sender.toHex()
  );
  broadcaster.lastActiveDay = broadcasterDay.date;
  broadcasterDay.volumeETH = broadcasterDay.volumeETH.plus(faceValue);
  broadcasterDay.volumeUSD = broadcasterDay.volumeUSD.plus(faceValueUSD);
  broadcasterDay.save();
  let broadcasterDays = broadcaster.broadcasterDays;
  if (!broadcasterDays.includes(broadcasterDay.id)) {
    broadcasterDays.unshift(broadcasterDay.id);
    broadcaster.broadcasterDays = broadcasterDays;
  }
  broadcaster.save();

  // Update transcoder's fee volume
  let transcoder = createOrLoadTranscoder(
    event.params.recipient.toHex(),
    event.block.timestamp.toI32()
  );
  transcoder.totalVolumeETH = transcoder.totalVolumeETH.plus(faceValue);
  transcoder.totalVolumeUSD = transcoder.totalVolumeUSD.plus(faceValueUSD);

  // Update total protocol fee volume
  protocol.totalVolumeETH = protocol.totalVolumeETH.plus(faceValue);
  protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(faceValueUSD);

  protocol.winningTicketCount = protocol.winningTicketCount + 1;
  protocol.save();

  // update the transcoder pool fees and cumulative fee factor
  if (pool) {
    // Use previous round's CRF for fee factor calculation, matching the
    // contract's latestCumulativeFactorsPool(currentRound - 1). Fall back
    // to the current pool's propagated CRF on reactivation (no prev pool).
    let prevRoundNum = integerFromString(round.id).minus(ONE_BI);
    let prevPoolForFees = Pool.load(
      makePoolId(event.params.recipient.toHex(), prevRoundNum.toString())
    );
    let prevCRF = PRECISE_PERC_DIVISOR; // default: 10^27
    if (
      prevPoolForFees &&
      !prevPoolForFees.cumulativeRewardFactor.equals(ZERO_BI)
    ) {
      prevCRF = prevPoolForFees.cumulativeRewardFactor;
    } else if (!pool.cumulativeRewardFactor.equals(ZERO_BI)) {
      // Current pool's CRF was propagated from lastRewardRound in newRound,
      // so it holds the correct previous factor when prev pool doesn't exist.
      prevCRF = pool.cumulativeRewardFactor;
    }

    let delegatorsFees = percOf(event.params.faceValue, pool.feeShare);
    let transcoderCommissionFees = event.params.faceValue.minus(delegatorsFees);

    // Compute fees earned by the transcoder's own staked commission.
    // If reward() hasn't been called yet this round, use pendingRewardCommission
    // directly (mirrors contract's updateTranscoderWithFees line 339).
    let activeCumulativeRewards = transcoder.lastRewardRound == round.id
      ? transcoder.activeCumulativeRewards
      : transcoder.pendingRewardCommission;

    let totalStakeBI = convertFromDecimal(pool.totalStake);
    let transcoderRewardStakeFees = ZERO_BI;
    if (totalStakeBI.gt(ZERO_BI)) {
      transcoderRewardStakeFees = precisePercOf(
        delegatorsFees,
        activeCumulativeRewards,
        totalStakeBI
      );
    }

    // Accumulate orchestrator fee commission (feeShare cut + fees on staked commission)
    let totalFeeCommission = transcoderCommissionFees.plus(transcoderRewardStakeFees);
    transcoder.pendingFeeCommission = transcoder.pendingFeeCommission.plus(totalFeeCommission);
    transcoder.lifetimeFeeCommission = transcoder.lifetimeFeeCommission.plus(totalFeeCommission);

    if (totalStakeBI.gt(ZERO_BI)) {
      pool.cumulativeFeeFactor = pool.cumulativeFeeFactor.plus(
        precisePercOf(prevCRF, delegatorsFees, totalStakeBI)
      );
    }

    transcoder.lastFeeRound = round.id;
    pool.fees = pool.fees.plus(faceValue);
    pool.save();
  }

  day.totalSupply = protocol.totalSupply;
  day.totalActiveStake = protocol.totalActiveStake;
  day.participationRate = protocol.participationRate;
  day.volumeETH = day.volumeETH.plus(faceValue);
  day.volumeUSD = day.volumeUSD.plus(faceValueUSD);
  day.save();

  let transcoderDay = createOrLoadTranscoderDay(
    timestamp,
    event.params.recipient.toHex()
  );
  transcoderDay.volumeETH = transcoderDay.volumeETH.plus(faceValue);
  transcoderDay.volumeUSD = transcoderDay.volumeUSD.plus(faceValueUSD);
  transcoderDay.save();

  // Manually manage the array of transcoder days (add newest to the beginning of the list)
  let transcoderDays = transcoder.transcoderDays;
  if (!transcoderDays.includes(transcoderDay.id)) {
    transcoderDays.unshift(transcoderDay.id);
    transcoder.transcoderDays = transcoderDays;
  }
  transcoder.save();

  // Update fee volume for this round
  round.volumeETH = round.volumeETH.plus(faceValue);
  round.volumeUSD = round.volumeUSD.plus(faceValueUSD);
  round.save();
}

export function depositFunded(event: DepositFunded): void {
  let round = createOrLoadRound(getBlockNum());
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  const timestamp = event.block.timestamp.toI32();
  
  // One-time initialization: set to start of day for this timestamp.
  if (broadcaster.firstActiveDay == 0) {
    broadcaster.firstActiveDay = (timestamp / 86400) * 86400;
  }

  broadcaster.deposit = broadcaster.deposit.plus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let depositFundedEvent = new DepositFundedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  depositFundedEvent.transaction = event.transaction.hash.toHex();
  depositFundedEvent.timestamp = timestamp;
  depositFundedEvent.round = round.id;
  depositFundedEvent.sender = event.params.sender.toHex();
  depositFundedEvent.amount = convertToDecimal(event.params.amount);
  depositFundedEvent.save();
}

export function reserveFunded(event: ReserveFunded): void {
  let round = createOrLoadRound(getBlockNum());
  let broadcaster = createOrLoadBroadcaster(event.params.reserveHolder.toHex());
  const timestamp = event.block.timestamp.toI32();

  // One-time initialization: set to start of day for this timestamp.
  if (broadcaster.firstActiveDay == 0) {
    broadcaster.firstActiveDay = (timestamp / 86400) * 86400;
  }

  broadcaster.reserve = broadcaster.reserve.plus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let reserveFundedEvent = new ReserveFundedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  reserveFundedEvent.transaction = event.transaction.hash.toHex();
  reserveFundedEvent.timestamp = timestamp;
  reserveFundedEvent.round = round.id;
  reserveFundedEvent.reserveHolder = event.params.reserveHolder.toHex();
  reserveFundedEvent.amount = convertToDecimal(event.params.amount);
  reserveFundedEvent.save();
}

export function reserveClaimed(event: ReserveClaimed): void {
  let round = createOrLoadRound(getBlockNum());
  let broadcaster = createOrLoadBroadcaster(event.params.reserveHolder.toHex());
  broadcaster.reserve = broadcaster.reserve.minus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let reserveClaimedEvent = new ReserveClaimedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  reserveClaimedEvent.transaction = event.transaction.hash.toHex();
  reserveClaimedEvent.timestamp = event.block.timestamp.toI32();
  reserveClaimedEvent.round = round.id;
  reserveClaimedEvent.reserveHolder = event.params.reserveHolder.toHex();
  reserveClaimedEvent.claimant = event.params.claimant.toHex();
  reserveClaimedEvent.amount = convertToDecimal(event.params.amount);
  reserveClaimedEvent.save();
}

export function withdrawal(event: Withdrawal): void {
  let round = createOrLoadRound(getBlockNum());
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  broadcaster.deposit = ZERO_BD;
  broadcaster.reserve = ZERO_BD;
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let withdrawalEvent = new WithdrawalEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  withdrawalEvent.transaction = event.transaction.hash.toHex();
  withdrawalEvent.timestamp = event.block.timestamp.toI32();
  withdrawalEvent.round = round.id;
  withdrawalEvent.sender = event.params.sender.toHex();
  withdrawalEvent.deposit = convertToDecimal(event.params.deposit);
  withdrawalEvent.reserve = convertToDecimal(event.params.reserve);
  withdrawalEvent.save();
}
