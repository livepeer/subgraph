import { HardhatUserConfig } from "hardhat/types";

import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-waffle";

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  mocha: {
    timeout: 100000000
  },
  solidity: {
    compilers: [
      {
        version: "0.8.7",
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: 1337,
      gasPrice: 1000000,
    },
    localhost: {
      url: "http://localhost:8545",
      accounts: "remote",
      gas: 1000000,
    },
    docker: {
      url: "http://geth:8545",
      gasPrice: 1000000,
    },
  },
};

export default config;
