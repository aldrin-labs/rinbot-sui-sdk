import { DCAManagerSingleton, TurbosSingleton } from "../../src";
import { CoinManagerSingleton } from "../../src/managers/CoinManager";
import { RouteManager } from "../../src/managers/RouteManager";
import { LONG_SUI_COIN_TYPE } from "../../src/providers/common";
import { USDC_COIN_TYPE } from "../coin-types";
import { initAndGetRedisStorage, initAndGetProviders, provider, suiProviderUrl, user } from "../common";
import { delegateeUser } from "../dca/common";

// yarn ts-node examples/router/router-dca.ts
export const routerDCA = async ({
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

  const DCA_ID = "0x4d0316c3a32221e175ab2bb9abe360ed1d4498806dc50984ab67ce0ba90f2842";

  console.time("All init");
  const providers = await initAndGetProviders(storage);
  const coinManager: CoinManagerSingleton = CoinManagerSingleton.getInstance(providers, suiProviderUrl);
  const routerManager = RouteManager.getInstance(providers, coinManager);
  console.timeEnd("All init");

  console.time("getBestRouteTransactionForDCA");

  // We support only Turbos for now for DCA
  const supportedProviders = providers.filter((provider) => provider.providerName === "Turbos");

  const tx = await routerManager.getBestRouteTransactionForDCA({
    tokenFrom,
    tokenTo,
    amount,
    slippagePercentage,
    signerAddress,
    supportedProviders,
    dcaObjectId: DCA_ID,
    dcaTradeGasCost: DCAManagerSingleton.DCA_MINIMUM_GAS_FUNDS_PER_TRADE,
  });
  console.timeEnd("getBestRouteTransactionForDCA");

  console.debug("tx: ", tx);
  console.debug("tx.blockData: ", tx.blockData);
  console.debug("tx.blockData.transactions: ", tx.blockData.transactions);

  const res = await provider.devInspectTransactionBlock({ sender: delegateeUser, transactionBlock: tx });

  console.debug("res:", res);
};

routerDCA({
  tokenFrom: USDC_COIN_TYPE,
  tokenTo: LONG_SUI_COIN_TYPE,
  amount: "1.333333",
  slippagePercentage: 10,
  signerAddress: user,
});
