import {
  Transaction,
  MigrateDelegatorFinalizedEvent,
  StakeClaimedEvent,
} from "../types/schema";
import {
  createOrLoadRound,
  getBlockNum,
  makeEventId,
  convertToDecimal,
} from "../../utils/helpers";
import {
  MigrateDelegatorFinalized,
  StakeClaimed,
} from "../types/L2Migrator/L2Migrator";

export function migrateDelegatorFinalized(
  event: MigrateDelegatorFinalized
): void {
  let round = createOrLoadRound(getBlockNum());

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

  let migrateDelegatorFinalizedEvent = new MigrateDelegatorFinalizedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  migrateDelegatorFinalizedEvent.transaction = event.transaction.hash.toHex();
  migrateDelegatorFinalizedEvent.timestamp = event.block.timestamp.toI32();
  migrateDelegatorFinalizedEvent.round = round.id;
  migrateDelegatorFinalizedEvent.l1Addr = event.params.params.l1Addr.toHex();
  migrateDelegatorFinalizedEvent.l2Addr = event.params.params.l1Addr.toHex();
  migrateDelegatorFinalizedEvent.stake = convertToDecimal(
    event.params.params.stake
  );
  migrateDelegatorFinalizedEvent.delegatedStake = convertToDecimal(
    event.params.params.delegatedStake
  );
  migrateDelegatorFinalizedEvent.fees = convertToDecimal(
    event.params.params.fees
  );
  migrateDelegatorFinalizedEvent.delegate = event.params.params.delegate.toHex();
  migrateDelegatorFinalizedEvent.save();
}

export function stakeClaimed(event: StakeClaimed): void {
  let round = createOrLoadRound(getBlockNum());

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

  let stakeClaimedEvent = new StakeClaimedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  stakeClaimedEvent.transaction = event.transaction.hash.toHex();
  stakeClaimedEvent.timestamp = event.block.timestamp.toI32();
  stakeClaimedEvent.round = round.id;
  stakeClaimedEvent.delegator = event.params.delegator.toHex();
  stakeClaimedEvent.delegate = event.params.delegate.toHex();
  stakeClaimedEvent.stake = convertToDecimal(event.params.stake);
  stakeClaimedEvent.fees = convertToDecimal(event.params.fees);
  stakeClaimedEvent.save();
}
