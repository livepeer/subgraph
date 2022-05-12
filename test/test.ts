import { ethers } from "hardhat";
import {
  BigNumber,
  BigNumberish,
  BytesLike,
  constants,
  Overrides,
} from "ethers";
import { expect } from "chai";
import {
  RoundsManager__factory as RoundsManagerFactory,
  LivepeerToken__factory as LivepeerTokenFactory,
  BondingManager__factory as BondingManagerFactory,
  PollCreator__factory as PollCreatorFactory,
  Poll__factory as PollFactory,
  Controller__factory as ControllerFactory,
  TicketBroker__factory as TicketBrokerFactory,
  RoundsManager,
  LivepeerToken,
  BondingManager,
  PollCreator,
  TicketBroker,
} from "../typechain-types";
import { createApolloFetch } from "apollo-fetch";
import * as path from "path";
import { execSync } from "child_process";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

const controllerAddress = "0x77A0865438f2EfD65667362D4a8937537CA7a5EF";

const PERC_DIVISOR = 1000000;
const PERC_MULTIPLIER = PERC_DIVISOR / 100;

const ONE_ETHER = ethers.utils.parseEther("1");

const defaults: Overrides = { gasLimit: 1000000 };

const srcDir = path.join(__dirname, "..");

let graphNodeIP = "127.0.0.1";
if (process.env.DOCKER) {
  graphNodeIP = "graph-node";
}

const fetchSubgraph = createApolloFetch({
  uri: `http://${graphNodeIP}:8000/subgraphs/name/livepeer/livepeer`,
});

type Ticket = {
  recipient: string;
  sender: string;
  faceValue: BigNumberish;
  winProb: BigNumberish;
  senderNonce: BigNumberish;
  recipientRandHash: BytesLike;
  auxData: BytesLike;
};

const contractId = (contractName) => {
  return ethers.utils.solidityKeccak256(["string"], [contractName]);
};

const exec = (cmd) => {
  try {
    return execSync(cmd, { cwd: srcDir, stdio: "inherit" });
  } catch (e) {
    throw new Error(`Failed to run command \`${cmd}\``);
  }
};

const waitForSubgraphToBeSynced = async () =>
  new Promise<void>((resolve, reject) => {
    // Wait for up to five minutes
    const deadline = Date.now() + 300 * 1000;
    // Function to check if the subgraph is synced
    const checkSubgraphSynced = async () => {
      try {
        console.log("Checking if subgraph is synced...");

        const result = await fetchSubgraph({
          query: `{
            protocol(id: "0") {
              id
              roundCount
              totalSupply
            }
          }
        `,
        });
        const roundCount = parseInt(result?.data?.protocol?.roundCount ?? 0);
        const totalSupply = parseInt(result?.data?.protocol?.totalSupply ?? 0);
        if (roundCount > 0 && totalSupply > 0) {
          resolve();
        } else {
          throw new Error("reject or retry");
        }
      } catch (e) {
        if (Date.now() > deadline) {
          reject(new Error(`Timed out waiting for the subgraph to sync`));
        } else {
          setTimeout(checkSubgraphSynced, 2000);
        }
      }
    };

    // Periodically check whether the subgraph has synced
    setTimeout(checkSubgraphSynced, 8000);
  });

describe("Token contract", function () {
  let RoundsManager: RoundsManager;
  let BondingManager: BondingManager;
  let Token: LivepeerToken;
  let PollCreator: PollCreator;
  let TicketBroker: TicketBroker;

  let roundsManagerAddress: string;
  let bondingManagerAddress: string;
  let livepeerTokenAddress: string;
  let pollCreatorAddress: string;

  const TOKEN_UNIT = BigNumber.from("10").pow(18);
  const voteMap = ["Yes", "No"];

  let broadcaster: SignerWithAddress;
  let transcoder1: SignerWithAddress;
  let transcoder2: SignerWithAddress;
  let delegator1: SignerWithAddress;
  let delegator2: SignerWithAddress;
  let delegator3: SignerWithAddress;
  let delegator4: SignerWithAddress;
  let delegator5: SignerWithAddress;
  let delegator6: SignerWithAddress;

  let rewardCut: number;
  let feeShare: number;
  let transcoder1StartStake: number;
  let transcoder2StartStake: number;
  let delegator1StartStake: number;
  let delegator2StartStake: number;
  let delegator3StartStake: number;
  let roundLength: BigNumber;
  let pollCreationCost: BigNumber;
  let voters = {};

  beforeEach(async function () {});

  describe("Deployment", function () {
    const mineBlocks = async (blocks: number) => {
      const initialBlock = await ethers.provider.getBlockNumber();

      await new Promise<void>((resolve, reject) => {
        ethers.provider.on("block", (blockNumber) => {
          if (blockNumber >= initialBlock + blocks) {
            resolve();
          }
        });
      });
    };

    const waitUntilBlock = async (blockNumber: number) => {
      const latestBlock = (await ethers.provider.getBlock("latest")).number;

      await mineBlocks(blockNumber - latestBlock);
    };

    const mineAndInitializeRound = async (_roundLength) => {
      await mineBlocks(parseInt(_roundLength));
      await RoundsManager.initializeRound();
    };

    const createWinningTicket = async (
      recipient: SignerWithAddress,
      sender: SignerWithAddress,
      recipientRand: number,
      faceValue: BigNumberish = 0
    ) => {
      const recipientRandHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(["uint256"], [recipientRand])
      );
      const currentRound = await RoundsManager.currentRound();
      const currentRoundBlockHash = await RoundsManager.blockHashForRound(
        currentRound
      );

      const ticket: Ticket = {
        recipient: recipient.address,
        sender: sender.address,
        faceValue,
        winProb: constants.MaxUint256.toString(),
        senderNonce: 0,
        recipientRandHash,
        auxData: ethers.utils.defaultAbiCoder.encode(
          ["uint256", "bytes32"],
          [currentRound.toNumber(), currentRoundBlockHash]
        ),
      };

      return ticket;
    };

    const getStake = async (addr) => {
      const currentRound = await RoundsManager.currentRound();
      return BondingManager.pendingStake(addr, currentRound);
    };

    const tallyPollAndCheckResult = async () => {
      let yesTally = BigNumber.from(0);
      let noTally = BigNumber.from(0);

      for (const voter in voters) {
        let voteStake = await getStake(voter);
        let nonVoteStake = BigNumber.from(0);
        if (voters[voter].registeredTranscoder) {
          const delegatorData = await BondingManager.getDelegator(voter);
          voteStake = delegatorData.delegatedAmount;
          if (voters[voter].overrides.length) {
            for (const override of voters[voter].overrides) {
              const overrideVoteStake = await getStake(override);
              nonVoteStake = nonVoteStake.add(
                BigNumber.from(overrideVoteStake)
              );
            }
          }
        }

        if (voters[voter].choiceID === 0) {
          yesTally = BigNumber.from(yesTally).add(
            BigNumber.from(voteStake).sub(nonVoteStake)
          );
        }
        if (voters[voter].choiceID === 1) {
          noTally = BigNumber.from(noTally).add(
            BigNumber.from(voteStake).sub(nonVoteStake)
          );
        }
      }

      const subgraphPollData = await fetchSubgraph({
        query: `{
        polls {
          tally {
            yes
            no
          }
        }
      }`,
      });

      expect(
        subgraphPollData.data.polls[0].tally
          ? subgraphPollData.data.polls[0].tally.yes
          : "0"
      ).to.equal(yesTally.toString());

      expect(
        subgraphPollData.data.polls[0].tally
          ? subgraphPollData.data.polls[0].tally.no
          : "0"
      ).to.equal(noTally.toString());
    };

    before(async () => {
      [broadcaster, transcoder1, transcoder2, delegator1] =
        await ethers.getSigners();

      // delegator2 = accounts[3];
      // delegator3 = accounts[4];
      // delegator4 = accounts[5];
      // delegator5 = accounts[6];
      // delegator6 = accounts[7];

      const Controller = await ControllerFactory.connect(
        controllerAddress,
        broadcaster
      );

      const getContractAddress = async (contractName: string) =>
        Controller.getContract(contractId(contractName));

      roundsManagerAddress = await getContractAddress("RoundsManager");
      bondingManagerAddress = await getContractAddress("BondingManager");
      livepeerTokenAddress = await getContractAddress("LivepeerToken");
      const ticketBrokerAddress = await getContractAddress("TicketBroker");
      // TODO add poll creator address

      // for (const contractName of [
      //   "BondingManager",
      //   "RoundsManager",
      //   "LivepeerToken",
      //   "MinterV1",
      //   "Minter",
      //   "TicketBroker",
      //   "PollCreator",
      //   "ServiceRegistry",
      //   "L2Migrator",
      // ]) {
      //   console.log(
      //     `${contractName}: ${await getContractAddress(contractName)}`
      //   );
      // }

      RoundsManager = await RoundsManagerFactory.connect(
        roundsManagerAddress,
        broadcaster
      );
      BondingManager = await BondingManagerFactory.connect(
        bondingManagerAddress,
        broadcaster
      );
      Token = await LivepeerTokenFactory.connect(
        livepeerTokenAddress,
        broadcaster
      );
      TicketBroker = await TicketBrokerFactory.connect(
        ticketBrokerAddress,
        broadcaster
      );

      await RoundsManager.setRoundLength(20);

      // pollCreationCost = await PollCreator.POLL_CREATION_COST();
      roundLength = await RoundsManager.roundLength();

      const transferAmount = BigNumber.from("10").mul(TOKEN_UNIT).toString();
      await Token.transfer(transcoder1.address, transferAmount);

      await Token.transfer(transcoder2.address, transferAmount);
      await Token.transfer(delegator1.address, transferAmount);
      // await Token.transfer(delegator2.address, transferAmount);
      // await Token.transfer(delegator3.address, transferAmount);
      // await Token.transfer(delegator4.address, transferAmount);
      // await Token.transfer(delegator5.address, transferAmount);
      // await Token.transfer(delegator6.address, transferAmount);

      // fund the broadcaster reserve and deposit
      await TicketBroker.connect(broadcaster).fundDepositAndReserve(
        ONE_ETHER,
        ONE_ETHER,
        { ...defaults, value: ONE_ETHER.mul(2) }
      );

      await mineAndInitializeRound(roundLength);

      rewardCut = 50; // 50%
      feeShare = 5; // 5%
      transcoder1StartStake = 1000;
      transcoder2StartStake = 1000;
      delegator1StartStake = 3000;
      // delegator2StartStake = 3000;
      // delegator3StartStake = 3000;

      // Register transcoder 1
      await Token.connect(transcoder1).approve(
        bondingManagerAddress,
        transcoder1StartStake
      );

      await expect(
        BondingManager.connect(transcoder1).bond(
          transcoder1StartStake,
          transcoder1.address,
          defaults
        )
      ).to.emit(BondingManager, "Bond");
      await BondingManager.connect(transcoder1).transcoder(
        rewardCut * PERC_MULTIPLIER,
        feeShare * PERC_MULTIPLIER,
        defaults
      );

      // Register transcoder 2
      await Token.connect(transcoder2).approve(
        bondingManagerAddress,
        transcoder2StartStake
      );
      await BondingManager.connect(transcoder2).bond(
        transcoder2StartStake,
        transcoder2.address,
        defaults
      );
      await BondingManager.connect(transcoder2).transcoder(
        rewardCut * PERC_MULTIPLIER,
        feeShare * PERC_MULTIPLIER,
        defaults
      );

      // Delegator 1 delegates to transcoder 1
      await Token.connect(delegator1).approve(
        bondingManagerAddress,
        delegator1StartStake
      );
      await BondingManager.connect(delegator1).bond(
        delegator1StartStake,
        transcoder1.address,
        defaults
      );

      // Delegator 2 delegates to transcoder 1
      // await Token.connect(delegator2).approve(
      //   bondingManagerAddress,
      //   delegator2StartStake
      // );
      // await BondingManager.connect(delegator2).bond(
      //   delegator2StartStake,
      //   transcoder1.address
      // );

      // Delegator 3 delegates to transcoder 1
      // await Token.connect(delegator3).approve(
      //   bondingManagerAddress,
      //   delegator3StartStake
      // );
      // await BondingManager.connect(delegator3).bond(
      //   delegator3StartStake,
      //   transcoder1.address
      // );

      await mineAndInitializeRound(roundLength);

      // Create and deploy the subgraph
      exec("yarn prepare:development");
      exec("yarn codegen");

      if (process.env.DOCKER) {
        exec(`yarn create:docker`);
        exec(`yarn deploy:docker`);
      } else {
        exec(`yarn create:local`);
        exec(`yarn deploy:local`);
      }
    });

    it("subgraph does not fail", async () => {
      // Wait for the subgraph to be indexed, and not fail
      await waitForSubgraphToBeSynced();
    });

    it("correctly updates the broadcaster deposit when ticket value is less than deposit", async () => {
      const faceValue = ethers.utils.parseEther(".2");

      const ticket = await createWinningTicket(
        transcoder1,
        broadcaster,
        1,
        faceValue
      );
      const ticketHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          [
            "address",
            "address",
            "uint256",
            "uint256",
            "uint256",
            "string",
            "uint256",
          ],
          [
            ticket.recipient,
            ticket.sender,
            ticket.faceValue,
            ticket.winProb,
            ticket.senderNonce,
            ticket.recipientRandHash,
            ticket.auxData,
          ]
        )
      );

      const signedTicketHash = await broadcaster.signMessage(ticketHash);

      await expect(
        TicketBroker.connect(transcoder1).redeemWinningTicket(
          ticket,
          signedTicketHash,
          1,
          defaults
        )
      ).to.emit(TicketBroker, "WinningTicketRedeemed");

      const winningTicketRedeemedEvents = await fetchSubgraph({
        query: `{
          winningTicketRedeemedEvents {
             sender {
              id
            }
            id
            faceValue
          }
        }`,
      });

      console.log({ winningTicketRedeemedEvents });
    });

    it.skip("creates a poll", async () => {
      const createPollAndCheckResult = async () => {
        const hash = ethers.utils.formatBytes32String(
          "QmWBPdeDCi8uxQrUyTV38xwaeYxgmjQmx1Zkiw4vgQhj7x"
        );
        await Token.connect(transcoder1).approve(
          pollCreatorAddress,
          pollCreationCost
        );
        await PollCreator.connect(transcoder1).createPoll(hash);
        await waitForSubgraphToBeSynced();

        const pollData = await fetchSubgraph({
          query: `{ polls { id } }`,
        });
        expect(pollData.data.polls.length).to.equal(1);
      };
      await createPollAndCheckResult();
    });

    it.skip("correctly indexes vote choices", async () => {
      let subgraphPollData = await fetchSubgraph({
        query: `{ polls { id } }`,
      });
      const pollAddress = subgraphPollData.data.polls[0].id;

      const Poll = await PollFactory.connect(pollAddress, broadcaster);

      voters = {
        [transcoder1.address]: {
          choiceID: 0,
          registeredTranscoder: true,
          overrides: [delegator1, delegator2, delegator3],
        },
        [delegator1.address]: {
          choiceID: 1,
          registeredTranscoder: false,
          overrides: [],
        },
        [delegator2.address]: {
          choiceID: 0,
          registeredTranscoder: false,
          overrides: [],
        },
        [delegator3.address]: {
          choiceID: 1,
          registeredTranscoder: false,
          overrides: [],
        },
      };

      for (const voter in voters) {
        await Poll.connect(voter).vote(voters[voter].choiceID);
      }

      await waitForSubgraphToBeSynced();

      subgraphPollData = await fetchSubgraph({
        query: `{
        vote: votes(where: {voter: "${transcoder1.address.toLowerCase()}" }) {
          choiceID
          voter
        }
        vote: votes(where: {voter: "${delegator1.address.toLowerCase()}" }) {
          choiceID
          voter
        }
        vote: votes(where: {voter: "${delegator2.address.toLowerCase()}" }) {
          choiceID
          voter
        }
        vote: votes(where: {voter: "${delegator3.address.toLowerCase()}" }) {
          choiceID
          voter
        }
      }`,
      });

      for (const voteValue of subgraphPollData.data) {
        expect(voteValue[0].choiceID).to.equal(
          voteMap[voters[voteValue.voter]]
        ); // todo
      }
    });

    it.skip("correctly tallies poll after transcoder 1 calls reward", async () => {
      await mineAndInitializeRound(roundLength);
      await BondingManager.connect(transcoder1).reward();
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after transcoder 2 calls reward", async () => {
      await BondingManager.connect(transcoder2).reward();
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after transcoder bonds", async () => {
      const bondAmount = 1000;
      await Token.connect(transcoder1).approve(
        bondingManagerAddress,
        bondAmount
      );
      await BondingManager.connect(transcoder1).bond(
        bondAmount,
        transcoder1.address
      );
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after transcoder unbonds", async () => {
      const unbondAmount = 1000;
      await BondingManager.connect(transcoder1).unbond(unbondAmount);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after transcoder rebonds", async () => {
      await BondingManager.connect(transcoder2).rebond(0);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator bonds", async () => {
      const bondAmount = 1000;
      await Token.connect(delegator1).approve(
        bondingManagerAddress,
        bondAmount
      );
      await BondingManager.connect(delegator1).bond(
        bondAmount,
        transcoder1.address
      );
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator unbonds", async () => {
      const unbondAmount = 1000;
      await BondingManager.connect(delegator1).unbond(unbondAmount);

      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator rebonds", async () => {
      await BondingManager.connect(delegator1).rebond(0);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator claims earnings", async () => {
      await mineAndInitializeRound(roundLength);
      await BondingManager.connect(transcoder1).reward();

      const currentRound = await RoundsManager.currentRound();

      await BondingManager.connect(delegator1).claimEarnings(currentRound);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator that has not voted bonds to a transcoder that has", async () => {
      const bondAmount = 1000;
      await Token.connect(delegator4).approve(
        bondingManagerAddress,
        bondAmount
      );
      await BondingManager.connect(delegator4).bond(
        bondAmount,
        transcoder1.address
      );

      await mineAndInitializeRound(roundLength);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator that has not voted unbonds from a transcoder that has", async () => {
      const unbondAmount = 500;
      await BondingManager.connect(delegator4).unbond(unbondAmount);

      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator that has not voted rebonds to a transcoder that has", async () => {
      await BondingManager.connect(delegator4).rebond(0);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator 1 switches from transcoder 1 to transcoder 2", async () => {
      const bondAmount = 1000;
      await Token.connect(delegator1).approve(
        bondingManagerAddress,
        bondAmount
      );
      await BondingManager.connect(delegator1).bond(
        bondAmount,
        transcoder2.address
      );

      voters[transcoder1.address].overrides = voters[
        transcoder1.address
      ].overrides.filter((t) => t !== delegator1);

      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator 5 bonds with unregistered transcoder (delegate 2)", async () => {
      const bondAmount = 1000;
      await Token.connect(delegator5).approve(
        bondingManagerAddress,
        bondAmount
      );
      await BondingManager.connect(delegator5).bond(
        bondAmount,
        delegator2.address
      );

      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator 2 registers as transcoder and inherits the voting power of delegator 5", async () => {
      const bondAmount = 1000;
      await Token.connect(delegator2).approve(
        bondingManagerAddress,
        bondAmount
      );
      await BondingManager.connect(delegator2).bond(
        bondAmount,
        delegator2.address
      );

      voters[transcoder1.address].overrides = voters[
        transcoder1.address
      ].overrides.filter((t) => t !== delegator2);
      voters[delegator2.address].registeredTranscoder = true;
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator 5 votes and overrides its delegate vote", async () => {
      const subgraphPollData = await fetchSubgraph({
        query: `{ polls { id } }`,
      });
      const pollAddress = subgraphPollData.data.polls[0].id;
      const Poll = await PollFactory.connect(pollAddress, broadcaster);

      await Poll.connect(delegator5).vote(1);
      voters[delegator5.address] = {
        choiceID: 1,
        registeredTranscoder: false,
        overrides: [],
      };
      voters[delegator2.address].overrides.push(delegator5.address);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator 5 claims earnings", async () => {
      await mineAndInitializeRound(roundLength);
      await BondingManager.connect(transcoder1).reward();
      await BondingManager.connect(delegator2).reward();
      const currentRound = await RoundsManager.currentRound();

      await BondingManager.connect(delegator5).claimEarnings(currentRound);

      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator moves stake to a transcoder that voted", async () => {
      const bondAmount = 1000;
      await Token.connect(delegator1).approve(
        bondingManagerAddress,
        bondAmount
      );
      await BondingManager.connect(delegator1).bond(
        bondAmount,
        transcoder1.address
      );

      voters[transcoder1.address].overrides.push(delegator1.address);

      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after transcoder 1 resigns", async () => {
      const unbondAmount = await getStake(transcoder1);
      await BondingManager.connect(transcoder1).unbond(unbondAmount);

      voters[transcoder1.address].registeredTranscoder = false;
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after delegator with zero voting power votes", async () => {
      const subgraphPollData = await fetchSubgraph({
        query: `{ polls { id } }`,
      });
      const pollAddress = subgraphPollData.data.polls[0].id;
      const Poll = await PollFactory.connect(pollAddress, broadcaster);

      await Poll.connect(delegator6).vote(1);
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });

    it.skip("correctly tallies poll after polling period is over", async () => {
      const subgraphPollData = await fetchSubgraph({
        query: `{ polls { id, endBlock } }`,
      });

      // Fast forward to end block
      await waitUntilBlock(parseInt(subgraphPollData.data.polls[0].endBlock));
      await waitForSubgraphToBeSynced();
      await tallyPollAndCheckResult();
    });
  });
});
