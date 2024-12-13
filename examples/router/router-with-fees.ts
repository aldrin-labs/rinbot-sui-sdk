import BigNumber from "bignumber.js";
import { FeeManager, NonEmptyArray, WalletManagerSingleton } from "../../src";
import { RouteManager } from "../../src/managers/RouteManager";
import { CoinManagerSingleton } from "../../src/managers/coin/CoinManager";
import { SHORT_SUI_COIN_TYPE } from "../../src/providers/common";
import { USDC_COIN_TYPE } from "../coin-types";
import { initAndGetProviders, initAndGetRedisStorage, keypair, provider, suiProviderUrl, user } from "../common";

// yarn ts-node examples/router/router-with-fees.ts
export const router = async ({
  tokenFrom,
  tokenTo,
  amount,
  slippagePercentage,
  signerAddress,
  generalFeePercentage,
  fees,
}: {
  tokenFrom: string;
  tokenTo: string;
  amount: string;
  slippagePercentage: number;
  signerAddress: string;
  generalFeePercentage: number;
  fees: NonEmptyArray<{ feeCollectorAddress: string; feeSharePercentage: number }>;
}) => {
  const storage = await initAndGetRedisStorage();

  console.time("All init");
  const providers = await initAndGetProviders(storage);
  const coinManager: CoinManagerSingleton = CoinManagerSingleton.getInstance(providers, suiProviderUrl);
  const routerManager = RouteManager.getInstance(providers, coinManager);
  const walletManager = WalletManagerSingleton.getInstance(provider, coinManager);
  console.timeEnd("All init");

  const tokenFromDecimals = (await coinManager.getCoinByType2(tokenFrom))?.decimals;
  console.debug("\ntokenFromDecimals:", tokenFromDecimals);

  if (tokenFromDecimals === undefined) {
    throw new Error("Cannot get token from decimals");
  }

  const generalFeeAmount = FeeManager.calculateFeeAmountIn({
    feePercentage: generalFeePercentage.toString(),
    amount,
    tokenDecimals: tokenFromDecimals,
  });
  console.debug("\ngeneralFeeAmount:", generalFeeAmount);

  const resultFees = fees.map(({ feeCollectorAddress, feeSharePercentage }) => {
    const feeAmount = new BigNumber(generalFeeAmount).multipliedBy(feeSharePercentage).dividedBy(100).toFixed(0);

    return { feeAmount, feeCollectorAddress };
  }) as NonEmptyArray<{ feeAmount: string; feeCollectorAddress: string }>;
  console.debug("\nresultFees:", resultFees);

  const allCoinObjects = await walletManager.getAllCoinObjects({ publicKey: user, coinType: tokenFrom });
  console.debug("\nallCoinObjects:", allCoinObjects);

  console.time("getBestRouteTransaction");
  const { tx } = await routerManager.getBestRouteTransaction({
    tokenFrom,
    tokenTo,
    amount,
    slippagePercentage,
    signerAddress,
    fee: { tokenFromDecimals, fees: resultFees, tokenFromCoinObjects: allCoinObjects },
  });
  console.timeEnd("getBestRouteTransaction");

  // const res = await provider.devInspectTransactionBlock({ sender: user, transactionBlock: tx });
  const res = await provider.signAndExecuteTransactionBlock({
    signer: keypair,
    transactionBlock: tx,
    options: { showEffects: true },
  });

  console.debug("\nres:", res);
};

router({
  tokenFrom: USDC_COIN_TYPE,
  tokenTo: SHORT_SUI_COIN_TYPE,
  amount: "0.3",
  slippagePercentage: 10,
  signerAddress: user,
  generalFeePercentage: 1,
  fees: [
    {
      feeCollectorAddress: "0xc2f45aa0ee89058023c1bbfd64a710d43ec5f6b16e52590bbad92d6a09a235e6",
      feeSharePercentage: 50,
    },
    {
      feeCollectorAddress: "0xcd41e4ced7020eaf6bf0f239114138c97178dc76f73dec64bd0b3f3875bd03b6",
      feeSharePercentage: 50,
    },
  ],
});
