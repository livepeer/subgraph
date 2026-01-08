# Contributing

Thanks for your interest in contributing to our subgraph. We want this to be friendly, clear,
and low-friction for everyone.

## Ways to contribute

- Report a bug or regression.
- Propose a feature or improvement.
- Improve docs or tests.
- Help with reviews.

## Issues first, then assignments

For most work, please open an issue before starting:

1. Create or find the issue.
2. Ask to be assigned in a comment.
3. Wait for a maintainer to assign you before starting work.

This helps us avoid duplicated effort and align on scope.

## Pull request workflow

1. Fork the repo and create your branch from the default branch.
2. Keep changes focused and scoped to the issue.
3. Add tests or update docs where appropriate.
4. Open a PR and link the issue it resolves.

## Deployment workflow

1. CI deploys a Subgraph Studio preview on PRs and posts the link as a PR comment.
2. Reviewers should confirm the Studio deployment fully syncs without errors.
3. After approval, merge to `main` to trigger a testnet deployment (currently disabled).
4. For on-chain releases, update `package.json` version to match the release tag (e.g. `v1.2.3`).
5. Create a `v*` tag to deploy a new version to Subgraph Studio (this does not publish to the network).

## Publishing

Publishing to the decentralized network requires a wallet with publish permissions. A wallet admin should complete this step, either from the Studio UI or via the CLI. See the [Graph docs](https://thegraph.com/docs/en/subgraphs/developing/publishing/publishing-a-subgraph/#publishing-from-the-cli).

## License

By contributing, you agree that your contributions will be licensed under the
license specified in this repository.
