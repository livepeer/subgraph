# Livepeer Subgraph

[![Discord](https://img.shields.io/discord/423160867534929930.svg?style=flat-square)](https://discord.gg/livepeer)
[![GitHub issues](https://img.shields.io/github/issues/livepeer/livepeerjs/subgraph.svg?style=flat-square)](https://github.com/livepeer/livepeerjs/labels/subgraph)

This package contains the source code for the Livepeer Subgraph, a project for
indexing and querying Livepeer data from the Ethereum blockchain using
[The Graph](https://thegraph.com).

## Quickstart

```bash
$ yarn
$ yarn prepare:arbitrum-one
```

The first command installs all external dependencies, while the latter generates
the `subgraph.yaml` file, which is required by The Graph.

We use [Handlebars](https://github.com/wycats/handlebars.js/) to compile a
[template subgraph](./subgraph.template.yaml) and add the parameters specific to
each network (arbitrum-one and arbitrum-goerli). The network can be changed via the
`NETWORK_NAME` environment variable or directly by choosing a different
"prepare" script. See [package.json](./package.json) for all options.

### Deploy the Livepeer Subgraph with Subgraph Studio

Deploy to Subgraph Studio first, then publish to the decentralized Graph Network
from the Studio UI. For more information, see the [Subgraph Studio
documentation](https://thegraph.com/docs/en/subgraphs/developing/deploying/using-subgraph-studio/).

Example deploy:

```bash
yarn deploy:arbitrum-one -- --version-label <version-label> --deploy-key <deploy-key>
```

You can also override the subgraph name for the generic deploy script:

```bash
SUBGRAPH=livepeer/arbitrum-one yarn deploy -- --version-label <version-label> --deploy-key <deploy-key>
```

### Deploy the Livepeer Subgraph locally

1. Install [Docker](https://docs.docker.com) and
   [Docker Compose](https://docs.docker.com/compose/install/)
2. In the root of this project run `docker-compose up`. This command will look
   for the `docker-compose.yml` file and automatically provision a server with
   rust, postgres, and ipfs, and spin up a graph node with a GraphiQL interface
   at `http://127.0.0.1:8000/`.
3. Run `yarn create:local` to create the subgraph
4. Run `yarn deploy:local` to deploy it

After downloading the latest blocks from Ethereum, you should begin to see
Livepeer smart contract events flying in. Open a GraphiQL browser at
localhost:8000 to query the Graph Node.

## Testing

We rely on Docker Compose to test the subgraph against our contracts. To run the tests, use one of the following methods.

### Multi Command

This will use the dependencies in Docker and run the tests locally in Hardhat. This is the recommended flow for developing tests.

```bash
yarn start # in first terminal
```

In another terminal window, create the subgraph and deploy it, then run tests against it:

```bash
yarn create:local
yarn deploy:local
yarn test:development
```

### Single Command

This will build the latest tests into a Dockerfile and run them against the subgraph in Docker.

```bash
yarn test
```

## Mainnet

To deploy the Livepeer subgraph on mainnet, make changes to `l1-mainnet`.
Changes to this branch will automatically deploy to the L1 subgraph.
