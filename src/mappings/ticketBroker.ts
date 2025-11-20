import { Address, BigInt, dataSource, log } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadBroadcaster,
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
  ZERO_BD,
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
import {
  BondingManager,
} from "../types/BondingManager/BondingManager";

export function winningTicketRedeemed(event: WinningTicketRedeemed): void {
  let round = createOrLoadRound(getBlockNum());
  let day = createOrLoadDay(event.block.timestamp.toI32());
  let winningTicketRedeemedEvent = new WinningTicketRedeemedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  let protocol = createOrLoadProtocol();
  let faceValue = convertToDecimal(event.params.faceValue);
  let ethPrice = getEthPriceUsd();
  let poolId = makePoolId(event.params.recipient.toHex(), round.id);
  let pool = Pool.load(poolId);

  createOrLoadTransactionFromEvent(event);

  winningTicketRedeemedEvent.transaction = event.transaction.hash.toHex();
  winningTicketRedeemedEvent.timestamp = event.block.timestamp.toI32();
  winningTicketRedeemedEvent.round = round.id;
  winningTicketRedeemedEvent.sender = event.params.sender.toHex();
  winningTicketRedeemedEvent.recipient = event.params.recipient.toHex();
  winningTicketRedeemedEvent.faceValue = faceValue;
  winningTicketRedeemedEvent.faceValueUSD = faceValue.times(ethPrice);
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
  broadcaster.save();

  // Update transcoder's fee volume
  let transcoder = createOrLoadTranscoder(
    event.params.recipient.toHex(),
    event.block.timestamp.toI32()
  );
  transcoder.totalVolumeETH = transcoder.totalVolumeETH.plus(faceValue);
  transcoder.totalVolumeUSD = transcoder.totalVolumeUSD.plus(
    faceValue.times(ethPrice)
  );

  // Update total protocol fee volume
  protocol.totalVolumeETH = protocol.totalVolumeETH.plus(faceValue);
  protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(
    faceValue.times(ethPrice)
  );

  protocol.winningTicketCount = protocol.winningTicketCount + 1;
  protocol.save();

  // update the transcoder pool fees and cummulative factors
  if (pool) {
    pool.fees = pool.fees.plus(faceValue);

    let bondingManager = BondingManager.bind(event.address);
    let earningsPool = bondingManager.getTranscoderEarningsPoolForRound(
      Address.fromString(transcoder.id),
      integerFromString(round.id)
    );
    pool.cumulativeFeeFactor = convertToDecimal(earningsPool.cumulativeFeeFactor);
    
    pool.save();
  }

  day.totalSupply = protocol.totalSupply;
  day.totalActiveStake = protocol.totalActiveStake;
  day.participationRate = protocol.participationRate;
  day.volumeETH = day.volumeETH.plus(faceValue);
  day.volumeUSD = day.volumeUSD.plus(faceValue.times(ethPrice));
  day.save();

  let transcoderDay = createOrLoadTranscoderDay(
    event.block.timestamp.toI32(),
    event.params.recipient.toHex()
  );
  transcoderDay.volumeETH = transcoderDay.volumeETH.plus(faceValue);
  transcoderDay.volumeUSD = transcoderDay.volumeUSD.plus(
    faceValue.times(ethPrice)
  );
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
  round.volumeUSD = round.volumeUSD.plus(faceValue.times(ethPrice));
  round.save();
}

export function depositFunded(event: DepositFunded): void {
  let round = createOrLoadRound(getBlockNum());
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());

  broadcaster.deposit = broadcaster.deposit.plus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let depositFundedEvent = new DepositFundedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  depositFundedEvent.transaction = event.transaction.hash.toHex();
  depositFundedEvent.timestamp = event.block.timestamp.toI32();
  depositFundedEvent.round = round.id;
  depositFundedEvent.sender = event.params.sender.toHex();
  depositFundedEvent.amount = convertToDecimal(event.params.amount);
  depositFundedEvent.save();
}

export function reserveFunded(event: ReserveFunded): void {
  let round = createOrLoadRound(getBlockNum());
  let broadcaster = createOrLoadBroadcaster(event.params.reserveHolder.toHex());

  broadcaster.reserve = broadcaster.reserve.plus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let reserveFundedEvent = new ReserveFundedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  reserveFundedEvent.transaction = event.transaction.hash.toHex();
  reserveFundedEvent.timestamp = event.block.timestamp.toI32();
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
