FROM node:14

# Clone and install wait-for-it
RUN git clone https://github.com/vishnubob/wait-for-it \
    && cp wait-for-it/wait-for-it.sh /usr/local/bin \
    && chmod +x /usr/local/bin/wait-for-it.sh \
    && rm -rf wait-for-it

WORKDIR /subgraph
COPY abis /subgraph/abis
COPY src /subgraph/src
COPY test /subgraph/test
COPY utils /subgraph/utils
COPY networks.yaml /subgraph/networks.yaml
COPY package.json /subgraph/package.json
COPY yarn.lock /subgraph/yarn.lock
COPY schema.graphql /subgraph/schema.graphql
COPY subgraph.template.yaml /subgraph/subgraph.template.yaml
COPY templatify.js /subgraph/templatify.js
COPY hardhat.config.ts /subgraph/hardhat.config.ts
COPY tsconfig.json /subgraph/tsconfig.json

# Install dependencies
RUN yarn

ENTRYPOINT ["yarn"]