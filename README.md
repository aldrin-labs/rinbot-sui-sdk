# SUI Trading Bot SDK

The SUI Trading Bot SDK is a TypeScript trading SDK designed to facilitate token trading on the Sui blockchain across different AMMs/DEXes. It includes integrations with various liquidity providers. Here's a quick overview of the supported providers:

## Providers

### Turbos Finance

- SDK: (https://github.com/turbos-finance/turbos-clmm-sdk)
- Docs: (https://turbos.gitbook.io/turbos/about-turbos/getting-started)
- How it works: (https://turbos.gitbook.io/turbos/products/concentrated-liquidity-amm)

### Cetus

- SDK: (https://github.com/CetusProtocol/cetus-clmm-sui-sdk)
- Contract Interface: (https://github.com/CetusProtocol/cetus-clmm-interface)
- Docs: (https://cetus-1.gitbook.io/cetus-developer-docs/developer/dev-overview)

### Aftermath Finance

- SDK: (https://github.com/AftermathFinance/aftermath-ts-sdk)
- Docs: (https://docs.aftermath.finance/aftermath-typescript-sdk/router)

### FlowX Finance

- SDK: (https://github.com/FlowX-Finance/ts-sdk)
- Docs: (https://docs.flowx.finance/contract/swap)

## SDK Overview

The SUI Trading Bot SDK is composed of two major parts:

1. **Providers:** Handles integrations with different liquidity providers.
2. **Managers:** Helper classes for building integrations, including CoinManager, RouteManager, and WalletManager.

## Requirements

To run the SUI Trading Bot SDK, ensure the following:

- Create a `.env` file with variables specified in `.env.example`.
- Use Node.js version 20 and higher, as specified in `.nvmrc` (tested with `v20.11.0`).

## Usage

Check the `examples` directory in the root of the SUI Trading Bot SDK for usage examples of each provider and manager.

# Running example with printing logs (including errors) to the log file

`yarn ts-node examples/cetus/cetus-dca.ts > cetus-dca.txt 2>&1`
