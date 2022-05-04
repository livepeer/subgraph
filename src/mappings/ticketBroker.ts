import {
  WinningTicketRedeemed,
  ReserveFunded,
  DepositFunded,
  ReserveClaimed,
  Withdrawal,
} from "../types/TicketBroker/TicketBroker";
import { UniswapV3Pool } from "../types/TicketBroker/UniswapV3Pool";
import {
  Transaction,
  Protocol,
  Broadcaster,
  WinningTicketRedeemedEvent,
  ReserveFundedEvent,
  ReserveClaimedEvent,
  DepositFundedEvent,
  WithdrawalEvent,
} from "../types/schema";
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
  getUniswapV3DaiEthPoolAddress,
  makeEventId,
  sqrtPriceX96ToTokenPrices,
  ZERO_BD,
} from "../../utils/helpers";

export function winningTicketRedeemed(event: WinningTicketRedeemed): void {
  let round = createOrLoadRound(getBlockNum());
  let day = createOrLoadDay(event.block.timestamp.toI32());
  let winningTicketRedeemedEvent = new WinningTicketRedeemedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  let protocol = createOrLoadProtocol();
  let faceValue = convertToDecimal(event.params.faceValue);
  let ethPrice = ZERO_BD;

  if (
    dataSource.network() == "arbitrum-one" ||
    dataSource.network() == "arbitrum-rinkeby"
  ) {
    let address = getUniswapV3DaiEthPoolAddress(dataSource.network());
    let daiEthPool = UniswapV3Pool.bind(Address.fromString(address));
    let slot0 = daiEthPool.slot0();
    let sqrtPriceX96 = slot0.value0;
    let prices = sqrtPriceX96ToTokenPrices(
      sqrtPriceX96,
      BigInt.fromI32(18),
      BigInt.fromI32(18)
    );
    ethPrice = prices[1];
  }
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

  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  if (faceValue.gt(broadcaster.deposit)) {
    broadcaster.deposit = ZERO_BD;
  } else {
    broadcaster.deposit = broadcaster.deposit.minus(faceValue);
  }

  // Update transcoder's fee volume
  let transcoder = createOrLoadTranscoder(event.params.recipient.toHex());
  transcoder.totalVolumeETH = transcoder.totalVolumeETH.plus(faceValue);
  transcoder.totalVolumeUSD = transcoder.totalVolumeUSD.plus(
    faceValue.times(ethPrice)
  );
  transcoder.save();

  // Update total protocol fee volume
  protocol.totalVolumeETH = protocol.totalVolumeETH.plus(faceValue);
  protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(
    faceValue.times(ethPrice)
  );

  protocol.winningTicketCount = protocol.winningTicketCount + 1;
  protocol.save();

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
