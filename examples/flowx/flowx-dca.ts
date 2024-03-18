import { CoinManagerSingleton, DCAManagerSingleton } from "../../src";
import { FeeManager } from "../../src/managers/FeeManager";
import { buildDcaTxBlock } from "../../src/managers/dca/adapters/flowxAdapter";
import { LONG_SUI_COIN_TYPE } from "../../src/providers/common";
import { FlowxSingleton } from "../../src/providers/flowx/flowx";
import { USDC_COIN_TYPE } from "../coin-types";
import {
  cacheOptions,
  initAndGetRedisStorage,
  provider,
  signAndExecuteTransaction,
  suiProviderUrl,
  user,
} from "../common";
import { delegateeKeypair, delegateeUser } from "../dca/common";

const GAS_PROVISION = DCAManagerSingleton.DCA_MINIMUM_GAS_FUNDS_PER_TRADE;
const DCA_ID = "0x4d0316c3a32221e175ab2bb9abe360ed1d4498806dc50984ab67ce0ba90f2842";

// The transaction flow is the following when selling non-SUI OR SUI token for X:
// 1. Swap(...)

// yarn ts-node examples/flowx/flowx-dca.ts
export const flowx = async ({
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

  const flowx: FlowxSingleton = await FlowxSingleton.getInstance({
    cacheOptions: { storage, ...cacheOptions },
    lazyLoading: false,
  });

  const coinManager = CoinManagerSingleton.getInstance([flowx], suiProviderUrl);
  const tokenFromData = await coinManager.getCoinByType2(tokenFrom);
  const tokenFromDecimals = tokenFromData?.decimals;

  if (!tokenFromDecimals) {
    throw new Error(`No decimals found for ${tokenFrom}`);
  }

  const netAmount = FeeManager.calculateNetAmount({
    feePercentage: DCAManagerSingleton.DCA_TRADE_FEE_PERCENTAGE,
    amount,
    tokenDecimals: tokenFromDecimals,
  });

  const calculatedData = await flowx.getRouteData({
    coinTypeFrom: tokenFrom,
    coinTypeTo: tokenTo,
    inputAmount: netAmount,
    publicKey: signerAddress,
    slippagePercentage,
  });
  console.debug("calc: ", calculatedData);

  // Standard behaviour of `flowx.getSwapTransaction` is that it will fail if
  // the user does not have coins available for the trade. We therefore use a
  // doctored up version of the method that mock the coin objects
  const txBlock = await flowx.getSwapTransactionDoctored({
    publicKey: user, // this MUST be the user address, not the delegatee
    slippagePercentage,
    route: calculatedData.route,
  });

  console.debug("blockData: ", JSON.stringify(txBlock.blockData));
  console.debug("\n\n\n\n\n");

  const txBlockDca = buildDcaTxBlock(txBlock, tokenFrom, tokenTo, DCA_ID, GAS_PROVISION);

  console.debug("\n\n\n\n\n");
  console.debug(`Final TxBlock: ${JSON.stringify(txBlockDca.blockData)}`);

  const res = await provider.devInspectTransactionBlock({
    transactionBlock: txBlockDca,
    sender: delegateeUser,
  });

  // const res = await signAndExecuteTransaction(txBlockDca, delegateeKeypair);
  console.debug("res: ", res);
};

// SUI --> FUD
// flowx({
//   tokenFrom: LONG_SUI_COIN_TYPE,
//   tokenTo: FUD_COIN_TYPE,
//   amount: "0.001",
//   slippagePercentage: 10,
//   signerAddress: user,
// });

// USDC --> SUI
flowx({
  tokenFrom: USDC_COIN_TYPE,
  tokenTo: LONG_SUI_COIN_TYPE,
  amount: "0.333333",
  slippagePercentage: 10,
  signerAddress: user,
});
