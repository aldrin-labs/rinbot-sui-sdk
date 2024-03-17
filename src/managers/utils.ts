import { CoinStruct } from "@mysten/sui.js/client";
import { normalizeSuiAddress } from "@mysten/sui.js/utils";
import {
  CoinAssetData,
  CommonCoinData,
  CreateCoinExternalApiResType,
  Provider,
  Providers,
  ProvidersToRouteDataMap,
} from "../managers/types";
import { LONG_SUI_COIN_TYPE, SHORT_SUI_COIN_TYPE } from "../providers/common";
import { CommonPoolData } from "../providers/types";
import { hasPath } from "../providers/utils/hasPath";
import { tryCatchWrapper } from "../providers/utils/tryCatchWrapper";
import { CoinManagerSingleton } from "./CoinManager";

export const getFiltredProviders = ({
  poolProviders,
  coinsByProviderMap,
  tokenFrom,
  tokenTo,
  supportedProviders,
}: {
  poolProviders: Providers;
  coinsByProviderMap: Map<string, Map<string, CommonCoinData>>;
  tokenFrom: string;
  tokenTo: string;
  supportedProviders?: Providers;
}) => {
  const tokenFromIsSui: boolean = tokenFrom === SHORT_SUI_COIN_TYPE || tokenFrom === LONG_SUI_COIN_TYPE;
  const tokenToIsSui: boolean = tokenTo === SHORT_SUI_COIN_TYPE || tokenTo === LONG_SUI_COIN_TYPE;

  const filtredProviders = poolProviders.filter((poolProvider: Provider) => {
    const providerCoins = coinsByProviderMap.get(poolProvider.providerName);

    if (!providerCoins) {
      console.warn(`[getFiltredProviders] No coins found for such provider ${poolProvider.providerName}`);
      return false;
    }

    // Check that provider is in supportedProviders
    if (supportedProviders?.length) {
      const isPoolProviderIsInSupportedProviders = supportedProviders.find((supportedProvider) =>
        supportedProvider.providerName.includes(poolProvider.providerName),
      );

      if (!isPoolProviderIsInSupportedProviders) {
        return false;
      }
    }

    // Check that provider has one of the variants of SUI token
    const providerCoinsHaveSui = providerCoins.has(SHORT_SUI_COIN_TYPE) || providerCoins.has(LONG_SUI_COIN_TYPE);
    // Check if input tokenFrom/tokenTo is SUI
    const tokenFromOrTokenToIsSui = tokenFromIsSui || tokenToIsSui;
    // If SUI token is tokenTo, we return tokenFrom, and vice versa
    const notSuiTokenInInputTokens: string = tokenFromIsSui ? tokenTo : tokenFrom;

    if (tokenFromOrTokenToIsSui) {
      // Provider tokens doesn't have SUI and doesn't have the second token in pair (tokenFrom/tokenTo)
      const providerDoesntHaveAnyToken = !providerCoinsHaveSui || !providerCoins.has(notSuiTokenInInputTokens);

      if (providerDoesntHaveAnyToken) {
        return false;
      }
    } else {
      // If no SUI token present in tokenFrom/tokenTo, just check that provider has both tokens
      if (!providerCoins.has(tokenFrom) || !providerCoins.has(tokenTo)) {
        return false;
      }
    }

    // If provider doesn't support smart-routing, than we have to check that provider has direct path with both tokens
    if (!poolProvider.isSmartRoutingAvailable) {
      const paths: Map<string, CommonPoolData> = poolProvider.getPaths();

      if (tokenFromOrTokenToIsSui) {
        const providerHasNoPathWithShortSui = !hasPath(SHORT_SUI_COIN_TYPE, notSuiTokenInInputTokens, paths);
        const providerHasNoPathWithLongSui = !hasPath(LONG_SUI_COIN_TYPE, notSuiTokenInInputTokens, paths);

        if (providerHasNoPathWithShortSui && providerHasNoPathWithLongSui) {
          return false;
        }
      } else {
        const providerHasNoPathWithRegularCoins = !hasPath(tokenFrom, tokenTo, paths);

        if (providerHasNoPathWithRegularCoins) {
          return false;
        }
      }
    }

    return true;
  });

  return filtredProviders;
};

export const getRouterMaps = async ({
  filtredProviders,
  tokenFrom,
  tokenTo,
  amount,
  signerAddress,
  slippagePercentage,
}: {
  filtredProviders: Providers;
  tokenFrom: string;
  tokenTo: string;
  amount: string;
  signerAddress: string;
  slippagePercentage: number;
}) => {
  const routesByProviderMap: ProvidersToRouteDataMap = new Map();
  const providersByOutputAmountsMap: Map<bigint, string> = new Map();

  await Promise.all(
    filtredProviders.map(async (provider: Provider) => {
      console.time("provider: " + provider.providerName);
      const routeData = await tryCatchWrapper(provider.getRouteData.bind(provider), {
        coinTypeFrom: tokenFrom,
        coinTypeTo: tokenTo,
        inputAmount: amount,
        publicKey: signerAddress,
        slippagePercentage,
      });
      const providerName: string = provider.providerName;

      // In case route is not found or provider throw an error
      if (routeData === null) {
        routesByProviderMap.set(providerName, { provider, route: null });
        providersByOutputAmountsMap.set(BigInt(0), providerName);
      } else {
        // In case route is found
        routesByProviderMap.set(providerName, { provider, route: routeData.route });
        providersByOutputAmountsMap.set(routeData.outputAmount, providerName);
      }
      console.timeEnd("provider: " + provider.providerName);
    }),
  );

  return { routesByProviderMap, providersByOutputAmountsMap };
};

export const tokenFromIsTokenTo = (tokenFrom: string, tokenTo: string): boolean => {
  const tokenFromIsSui: boolean = tokenFrom === SHORT_SUI_COIN_TYPE || tokenFrom === LONG_SUI_COIN_TYPE;
  const tokenToIsSui: boolean = tokenTo === SHORT_SUI_COIN_TYPE || tokenTo === LONG_SUI_COIN_TYPE;
  const tokensAreSui: boolean = tokenFromIsSui && tokenToIsSui;

  return tokensAreSui || tokenFrom === tokenTo;
};

export const getCoinsAssetsFromCoinObjects = async (
  coinObjects: CoinStruct[],
  coinManager: CoinManagerSingleton,
): Promise<CoinAssetData[]> => {
  return await coinObjects.reduce(async (allAssetsP: Promise<CoinAssetData[]>, coinData: CoinStruct) => {
    const allAssets: CoinAssetData[] = await allAssetsP;

    if (BigInt(coinData.balance) <= 0) {
      return allAssets;
    }

    const rawCoinType = coinData.coinType;
    const coinTypeAddress = rawCoinType.split("::")[0];
    const normalizedAddress = normalizeSuiAddress(coinTypeAddress);
    const normalizedCoinType = rawCoinType.replace(coinTypeAddress, normalizedAddress);

    const coinInAssets: CoinAssetData | undefined = allAssets.find(
      (asset: CoinAssetData) => asset.type === normalizedCoinType,
    );

    if (coinInAssets) {
      const currentBalance = BigInt(coinInAssets.balance);
      const additionalBalance = BigInt(coinData.balance);
      const newBalance: bigint = currentBalance + additionalBalance;
      coinInAssets.balance = newBalance.toString();
    } else {
      const coin: CommonCoinData | null = await coinManager.getCoinByType2(normalizedCoinType);
      const symbol = coin?.symbol?.trim();
      const decimals = coin?.decimals ?? null;

      if (!symbol) {
        console.warn(`[getCoinsAssetsFromCoinObjects] no symbol found for coin ${normalizedCoinType}`);
      }

      if (!decimals) {
        console.warn(`[getCoinsAssetsFromCoinObjects] no decimals found for coin ${normalizedCoinType}`);
      }

      allAssets.push({
        symbol,
        balance: coinData.balance,
        type: normalizedCoinType,
        decimals,
        noDecimals: !coin,
      });
    }

    return allAssets;
  }, Promise.resolve([]));
};

/**
 * Validates whether the provided response object adheres to the expected structure for creating a coin.
 *
 * @param {unknown} res - The object to validate.
 * @return {CreateCoinExternalApiResType} True if the object has a valid structure for creating a coin, false otherwise.
 */
export function isValidResForCreateCoin(res: unknown): res is CreateCoinExternalApiResType {
  return (
    typeof res === "object" &&
    res !== null &&
    "modules" in res &&
    "dependencies" in res &&
    "digest" in res &&
    Array.isArray(res.modules) &&
    (res.modules.every((m: unknown) => typeof m === "string") ||
      res.modules.every((m: unknown) => Array.isArray(m) && m.every((n: unknown) => typeof n === "number"))) &&
    Array.isArray(res.dependencies) &&
    res.dependencies.every((d: unknown) => typeof d === "string") &&
    Array.isArray(res.digest) &&
    res.digest.every((n: unknown) => typeof n === "number")
  );
}
