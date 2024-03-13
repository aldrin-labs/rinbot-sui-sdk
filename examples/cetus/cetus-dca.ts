import { CoinAsset } from "@cetusprotocol/cetus-sui-clmm-sdk";
import { buildDcaTxBlock } from "../../src/managers/dca/adapters/cetusAdapter";
import { CetusSingleton } from "../../src/providers/cetus/cetus";
import { clmmMainnet } from "../../src/providers/cetus/config";
import { LONG_SUI_COIN_TYPE } from "../../src/providers/common";
import { CETUS_COIN_TYPE } from "../coin-types";
import { cacheOptions, initAndGetRedisStorage, suiProviderUrl, user } from "../common";
import { TransactionBlock } from "@mysten/sui.js/transactions";

// The transaction flow is the following when selling non-SUI OR SUI token for X:
// 1. SplitCoins(input Coin)
// 2. CoinZero (for output coin)
// 3. Swap (...)
// 4. CheckCoinThreshold(...)
// 5. MergeCoins(Input coins)
// 6. MergeCoins(Output coins)

// TODO: These are dummy values
const GAS_PROVISION = 505050505;
const DCA_ID = "0x99999";

// yarn ts-node examples/cetus/cetus-dca.ts
export const cetusDca = async ({
  tokenFrom,
  tokenTo,
  amount,
  slippagePercentage,
  signerAddress,
}: {
  tokenFrom: string;
  tokenTo: string;
  amount: string;
  slippagePercentage: number;
  signerAddress: string;
}) => {
  const storage = await initAndGetRedisStorage();

  const cetus: CetusSingleton = await CetusSingleton.getInstance({
    sdkOptions: clmmMainnet,
    cacheOptions: { storage, ...cacheOptions },
    lazyLoading: false,
    suiProviderUrl,
  });

  const calculatedData = await cetus.getRouteData({
    coinTypeFrom: tokenFrom,
    coinTypeTo: tokenTo,
    inputAmount: amount,
    slippagePercentage,
    publicKey: signerAddress,
  });

  console.log(tokenFrom);
  console.log(tokenTo);

  const mockedAssets = getMockedAssets(tokenFrom, tokenTo);

  // Standard behaviour of `cetus.getSwapTransaction` is that it will fail if
  // the user does not have coins available for the trade. We therefore use a
  // doctored up version of the method that mock the coin objects
  const txBlock: TransactionBlock = await cetus.getSwapTransactionDoctored({
    route: calculatedData.route,
    publicKey: signerAddress, // this MUST be the user address, not the delegatee
    slippagePercentage,
    coinAssets: mockedAssets,
  });

  console.debug(`Original TxBlock: ${JSON.stringify(txBlock.blockData)}`);
  console.debug("\n\n\n\n\n");

  const txBlockDca = buildDcaTxBlock(txBlock, tokenFrom, tokenTo, DCA_ID, GAS_PROVISION);

  console.debug("\n\n\n\n\n");
  console.debug(`Doctored TxBlock: ${JSON.stringify(txBlockDca.blockData)}`);

  // const res = await provider.devInspectTransactionBlock({
  //   transactionBlock: txBlock,
  //   sender: user,
  // });
  // console.debug("res: ", res);
};

// Sui --> Cetus
cetusDca({
  tokenFrom: LONG_SUI_COIN_TYPE,
  tokenTo: CETUS_COIN_TYPE,
  amount: "0.0001",
  slippagePercentage: 10,
  signerAddress: user,
});

// BUCK --> USDC
// cetusDca({
//   tokenFrom: "0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK",
//   tokenTo: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
//   amount: "0.0001",
//   slippagePercentage: 10,
//   signerAddress: user,
// });

const getMockedAssets = (tokenFrom: string, tokenTo: string): CoinAsset[] => [
  {
    coinAddress: tokenFrom,
    coinObjectId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    balance: BigInt("9999999999999999999"),
  },
  {
    coinAddress: tokenTo,
    coinObjectId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    balance: BigInt("9999999999999999999"),
  },
];
