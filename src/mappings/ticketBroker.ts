import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  dataSource,
} from "@graphprotocol/graph-ts";
import {
  convertFromDecimal,
  convertToDecimal,
  createOrLoadBroadcaster,
  createOrLoadBroadcasterDay,
  createOrLoadDay,
  createOrLoadPool,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createOrLoadTranscoderDay,
  getBlockNum,
  getBondingManagerAddress,
  getEthPriceUsd,
  integerFromString,
  latestCumulativeRewardFactor,
  makeEventId,
  ONE_BI,
  percOf,
  precisePercOf,
  ZERO_BD,
  ZERO_BI,
} from "../../utils/helpers";
import {
  DepositFundedEvent,
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
import { BondingManager } from "../types/TicketBroker/BondingManager";

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

  // The faceValue of the ticket is subtracted from the ticket sender (broadcaster) deposit.
  // If the deposit can't cover it, the contract empties the deposit and pays the shortfall
  // (capped at the recipient's reserve allocation) from the reserve, emitting ReserveClaimed
  // with the amount actually paid. The reserveClaimed handler subtracts that amount, so the
  // reserve must not be touched here or the claim would be counted twice.
  //
  // The recipient is paid what the contract actually transferred, not the face
  // value: the deposit, plus any reserve claimed, can fall short of it (and be
  // zero), and the contract credits fees with only the transferred amount.
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  let paid = faceValue;
  if (faceValue.gt(broadcaster.deposit)) {
    paid = broadcaster.deposit.plus(
      reserveClaimedForTicket(
        event.transaction.hash,
        event.logIndex,
        event.params.sender.toHex(),
        event.params.recipient.toHex()
      )
    );
    broadcaster.deposit = ZERO_BD;
  } else {
    broadcaster.deposit = broadcaster.deposit.minus(faceValue);
  }
  let paidUSD = paid.times(ethPrice);
  let paidWei = convertFromDecimal(paid);

  broadcaster.totalVolumeETH = broadcaster.totalVolumeETH.plus(paid);
  broadcaster.totalVolumeUSD = broadcaster.totalVolumeUSD.plus(paidUSD);
  
  let broadcasterDay = createOrLoadBroadcasterDay(
    timestamp,
    event.params.sender.toHex()
  );
  broadcaster.lastFundedDay = broadcasterDay.date;
  broadcaster.lastActiveDay = broadcasterDay.date;
  broadcasterDay.volumeETH = broadcasterDay.volumeETH.plus(paid);
  broadcasterDay.volumeUSD = broadcasterDay.volumeUSD.plus(paidUSD);
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
    timestamp
  );
  transcoder.totalVolumeETH = transcoder.totalVolumeETH.plus(paid);
  transcoder.totalVolumeUSD = transcoder.totalVolumeUSD.plus(paidUSD);

  // Update total protocol fee volume
  protocol.totalVolumeETH = protocol.totalVolumeETH.plus(paid);
  protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(paidUSD);

  // Track active broadcasters based on ticket activity.
  let activeBroadcasters = protocol.activeBroadcasters;
  if (!activeBroadcasters.includes(broadcaster.id)) {
    activeBroadcasters.push(broadcaster.id);
    protocol.activeBroadcasters = activeBroadcasters;
  }

  protocol.winningTicketCount = protocol.winningTicketCount + 1;
  protocol.save();

  // update the transcoder pool fees and cumulative fee factor
  let pool = createOrLoadPool(round.id, event.params.recipient.toHex());

  // Read the round's earnings pool from the contract, which has already
  // applied these fees. Its cumulativeFeeFactor is exact, including the
  // contract's retroactive CRF estimate when round - 1 missed reward().
  let bondingManager = BondingManager.bind(
    Address.fromString(getBondingManagerAddress())
  );
  let onChainPool = bondingManager.try_getTranscoderEarningsPoolForRound(
    event.params.recipient,
    integerFromString(round.id)
  );

  let totalStakeBI = convertFromDecimal(pool.totalStake);
  let feeShare = pool.feeShare;
  // The pool is only initialized once the contract has credited fees or
  // stake for this round. A ticket that transferred nothing (sender's deposit
  // and reserve exhausted) still emits WinningTicketRedeemed but skips
  // updateTranscoderWithFees, leaving an all-zero pool, so ignore zeros.
  if (!onChainPool.reverted && onChainPool.value.value0.gt(ZERO_BI)) {
    totalStakeBI = onChainPool.value.value0;
    feeShare = onChainPool.value.value2;
    // Persist the contract's values so later handlers (e.g. reward) see them
    pool.totalStake = convertToDecimal(totalStakeBI);
    pool.rewardCut = onChainPool.value.value1;
    pool.feeShare = feeShare;
  }

  let delegatorsFees = percOf(paidWei, feeShare);
  let transcoderFeeCommission = paidWei.minus(delegatorsFees);

  // Fees earned by the transcoder's own staked commission, mirroring the
  // contract's transcoderRewardStakeFees. Until reward() is called this round
  // the contract uses cumulativeRewards (pendingRewardCommission here).
  let rewardCalledThisRound =
    transcoder.lastRewardRound != null &&
    transcoder.lastRewardRound! == round.id;
  let activeCumulativeRewards = rewardCalledThisRound
    ? transcoder.activeCumulativeRewards
    : transcoder.pendingRewardCommission;
  let transcoderRewardStakeFees = ZERO_BI;
  if (totalStakeBI.gt(ZERO_BI)) {
    transcoderRewardStakeFees = precisePercOf(
      delegatorsFees,
      activeCumulativeRewards,
      totalStakeBI
    );
  }

  // Accumulate orchestrator fee commission (feeShare + fees on staked commission)
  transcoder.pendingFeeCommission = transcoder.pendingFeeCommission
    .plus(transcoderFeeCommission)
    .plus(transcoderRewardStakeFees);
  transcoder.lifetimeFeeCommission = transcoder.lifetimeFeeCommission
    .plus(transcoderFeeCommission)
    .plus(transcoderRewardStakeFees);

  if (!onChainPool.reverted && onChainPool.value.value4.gt(ZERO_BI)) {
    pool.cumulativeFeeFactor = onChainPool.value.value4;
  } else if (totalStakeBI.gt(ZERO_BI)) {
    // Fallback: compute it as the contract does, from the previous round's
    // CRF (latestCumulativeFactorsPool(_round - 1)).
    let prevRoundNum = integerFromString(round.id).minus(ONE_BI);
    let prevCRF = latestCumulativeRewardFactor(
      event.params.recipient.toHex(),
      prevRoundNum.toString()
    );
    pool.cumulativeFeeFactor = pool.cumulativeFeeFactor.plus(
      precisePercOf(prevCRF, delegatorsFees, totalStakeBI)
    );
  }

  pool.fees = pool.fees.plus(paid);
  pool.save();
  if (paid.gt(ZERO_BD)) {
    transcoder.lastFeeRound = round.id;
  }

  day.totalSupply = protocol.totalSupply;
  day.totalActiveStake = protocol.totalActiveStake;
  day.participationRate = protocol.participationRate;
  day.volumeETH = day.volumeETH.plus(paid);
  day.volumeUSD = day.volumeUSD.plus(paidUSD);
  day.save();

  let transcoderDay = createOrLoadTranscoderDay(
    timestamp,
    event.params.recipient.toHex()
  );
  transcoderDay.volumeETH = transcoderDay.volumeETH.plus(paid);
  transcoderDay.volumeUSD = transcoderDay.volumeUSD.plus(paidUSD);
  transcoderDay.save();

  // Manually manage the array of transcoder days (add newest to the beginning of the list)
  let transcoderDays = transcoder.transcoderDays;
  if (!transcoderDays.includes(transcoderDay.id)) {
    transcoderDays.unshift(transcoderDay.id);
    transcoder.transcoderDays = transcoderDays;
  }
  transcoder.save();

  // Update fee volume for this round
  round.volumeETH = round.volumeETH.plus(paid);
  round.volumeUSD = round.volumeUSD.plus(paidUSD);
  round.save();
}

export function depositFunded(event: DepositFunded): void {
  let round = createOrLoadRound(getBlockNum());
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  const timestamp = event.block.timestamp.toI32();
  
  // One-time initialization: set to start of day for this timestamp.
  if (broadcaster.firstFundedDay == 0) {
    const startOfDay = (timestamp / 86400) * 86400;
    broadcaster.firstFundedDay = startOfDay;
    broadcaster.firstActiveDay = startOfDay;
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
  if (broadcaster.firstFundedDay == 0) {
    const startOfDay = (timestamp / 86400) * 86400;
    broadcaster.firstFundedDay = startOfDay;
    broadcaster.firstActiveDay = startOfDay;
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

// The reserve paid toward a winning ticket. When a ticket's face value exceeds
// the sender's deposit, the contract claims the shortfall from the reserve
// (emitting ReserveClaimed, handled earlier in the same transaction) just
// before emitting WinningTicketRedeemed. Look back a few logs for it, stopping
// at an earlier ticket in the same transaction (batch redemptions).
function reserveClaimedForTicket(
  txHash: Bytes,
  logIndex: BigInt,
  sender: string,
  recipient: string
): BigDecimal {
  let index = logIndex;
  for (let i = 0; i < 8 && index.gt(ZERO_BI); i++) {
    index = index.minus(ONE_BI);
    let id = makeEventId(txHash, index);
    if (WinningTicketRedeemedEvent.load(id) != null) {
      break;
    }
    let claim = ReserveClaimedEvent.load(id);
    if (claim != null) {
      if (claim.reserveHolder == sender && claim.claimant == recipient) {
        return claim.amount;
      }
      break;
    }
  }
  return ZERO_BD;
}
