import { HardhatUserConfig } from 'hardhat/types';

import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';

const config: HardhatUserConfig = {
  defaultNetwork: 'hardhat',
  solidity: {
    compilers: [
      {
        version: '0.8.7'
      }
    ]
  },
  networks: {
    hardhat: {
      chainId: 1337
    },
    development: {
      url: "http://localhost:8545",
      forking: {
        url: `https://eth-mainnet.alchemyapi.io/v2/${process.env.ALCHEMY_API_KEY ?? ""}`,
        blockNumber: 14090042
      }
    },
    docker: {
      url: "http://geth:8545"
    }
  }
};

export default config;
