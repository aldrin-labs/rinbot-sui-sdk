import { CoinStruct } from "@mysten/sui.js/client";
import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { normalizeSuiAddress } from "@mysten/sui.js/utils";
import BigNumber from "bignumber.js";
import {
  CoinAssetData,
  CommonCoinData,
  CreateCoinExternalApiResType,
  MergedCoinsStructure,
  NonEmptyArray,
  Provider,
  Providers,
  ProvidersToRouteDataMap,
  SwapFee,
} from "../managers/types";
import { LONG_SUI_COIN_TYPE, SHORT_SUI_COIN_TYPE } from "../providers/common";
import { CommonPoolData } from "../providers/types";
import { hasPath } from "../providers/utils/hasPath";
import { tryCatchWrapper } from "../providers/utils/tryCatchWrapper";
import { TransactionResult } from "../transactions/types";
import { WalletManagerSingleton } from "./WalletManager";
import { CoinManagerSingleton } from "./coin/CoinManager";

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

/**
 * @param {string} mnemonic Seed phrase of the wallet.
 * @return {string} Normilized mnemonic (trimmed & etc.).
 */
export function normalizeMnemonic(mnemonic: string): string {
  return mnemonic
    .trim()
    .split(/\s+/)
    .map((part) => part.toLowerCase())
    .join(" ");
}

export const isValidPrivateKey = (string: string): boolean => {
  try {
    const keypair = WalletManagerSingleton.getKeyPairFromPrivateKey(string);

    return keypair instanceof Ed25519Keypair;
  } catch (error) {
    return false;
  }
};

export const isValidSeedPhrase = (string: string): boolean => {
  try {
    const normalized = normalizeMnemonic(string);
    const keypair = Ed25519Keypair.deriveKeypair(normalized);

    return keypair instanceof Ed25519Keypair;
  } catch (error) {
    return false;
  }
};

/**
 * Note: `MergeCoins` transaction has a `destination` coin — the coin into which `sources` are merged; and `sources` —
 * the coins which are merged into the `destination` coin.
 *
 * @description
 * Finds all the `MergeCoins` transactions in a given `tx` transaction block, filters them by merging any coins from
 * a given `coinObjects`, and builds a structure, which contains these `MergeCoins` transactions destinations, sources
 * and unused sources — `coinObjects`, which didn't participate in the `MergeCoins` transactions.
 *
 * Note: `destination.value` and `source.value` can be represented as a string — the coin object id, like:
 *
 * "destination": {
 *   "kind": "Input",
 *   "value": "0x344c3b95f4ef0860392fa8f8f490279dd4ae0467d66dc0ff6c854a3e1aab3eb6",
 *   "index": 0,
 *   "type": "object"
 * },
 *
 * and as an object — `Object.ImmOrOwned`, which contains `objectId` as a field, like:
 *
 * "destination": {
 *   "kind": "Input",
 *   "value": {
 *     "Object": {
 *       "ImmOrOwned": {
 *         "digest": "C4U1Br4LadPxiSWHRbRGN2xk9iMVC1kmNakTaZ4uLFS4",
 *         "version": "96847425",
 *         "objectId": "0x012ff7334aee7c7627f746ee3653792f33e12c4af1d287cdf4e9de9376ea5d98"
 *       }
 *     }
 *   }
 *   "index": 0,
 *   "type": "object"
 * }
 *
 * The method handles both cases.
 *
 * @param {TransactionBlock} options.tx — The transaction block to find `MergeCoins` transactions in.
 * @param {CoinStruct[]} options.coinObjects — The objects of the coin to find `MergeCoins` transactions with.
 * @return {MergedCoinsStructure} — An object containing `destination`, `sources` and `unusedSources` fields. These
 * fields contain the coin object ids, participating in the found and filtered `MergeCoins` transactions.
 */
export const getMergedCoinsStructure = ({
  tx,
  coinObjects,
}: {
  tx: TransactionBlock;
  coinObjects: CoinStruct[];
}): MergedCoinsStructure | { noMerges: true } => {
  const transactions = tx.blockData.transactions;
  const coinObjectIds = coinObjects.map((object) => object.coinObjectId);

  // Getting all the `MergeCoins` transactions
  const mergeCoinsTransactions = transactions.filter((tx) => tx.kind === "MergeCoins");

  // Filtering the `MergeCoins` transactions such way, that are kept only those transactions,
  // in which participate `coinObjects`
  const requiredCoinMerges = mergeCoinsTransactions.filter((tx) => {
    if (tx.kind !== "MergeCoins" || tx.destination.kind !== "Input") {
      return false;
    }

    const destinationValue = tx.destination.value;

    // `destinationValue` can be represented as the string — the coin object id (e.g. in Cetus case)
    if (typeof destinationValue === "string") {
      return coinObjectIds.includes(tx.destination.value);
    }

    // And the `destinationValue` can be represented as the object `Object.ImmOrOwned`, that contains
    // the `objectId` (e.g. in Aftermath case)
    if (typeof destinationValue?.Object?.ImmOrOwned?.objectId === "string") {
      return coinObjectIds.includes(tx.destination.value?.Object?.ImmOrOwned?.objectId);
    }

    return false;
  });

  if (requiredCoinMerges.length === 0) {
    return { noMerges: true };
  }

  const structure = requiredCoinMerges.reduce(
    (struct: { destinations: Set<string>; sources: Set<string>; unusedSources: Set<string> }, tx) => {
      // This should never happen because of the `requiredCoinMerges` filtering. However, TypeScript needs this
      if (tx.kind !== "MergeCoins" || tx.destination.kind !== "Input") {
        return struct;
      }

      let destinationValue;

      if (typeof tx.destination.value === "string") {
        // Handling case when `destination.value` is the string — coin object id
        destinationValue = tx.destination.value;
      } else if (typeof tx.destination.value?.Object?.ImmOrOwned?.objectId === "string") {
        // Handling case when `destination.value` is the object `Object.ImmOrOwned`, that contains the `objectId`
        destinationValue = tx.destination.value?.Object?.ImmOrOwned?.objectId;
      } else {
        return struct;
      }

      // Add the destination object id to the `destinations` Set
      struct.destinations.add(destinationValue);

      // Delete the destination object id from the `unusedSources` Set
      struct.unusedSources.delete(destinationValue);

      tx.sources.forEach((source) => {
        if (source.kind === "Input") {
          let sourceValue;

          if (typeof source.value === "string") {
            // Handling case when `source.value` is the string — coin object id
            sourceValue = source.value;
          } else if (typeof source.value?.Object?.ImmOrOwned?.objectId === "string") {
            // Handling case when `source.value` is the object `Object.ImmOrOwned`, that contains the `objectId`
            sourceValue = source.value?.Object?.ImmOrOwned?.objectId;
          } else {
            return;
          }

          // Add the source object id to the `sources` Set
          struct.sources.add(sourceValue);

          // Delete the source object id from the `destinations` Set (it makes sense when one destination object
          // is merged into another)
          struct.destinations.delete(sourceValue);

          // Delete the source object id from the `unusedSources` Set
          struct.unusedSources.delete(sourceValue);
        }
      });

      return struct;
    },
    { destinations: new Set<string>(), sources: new Set<string>(), unusedSources: new Set<string>(coinObjectIds) },
  );

  return {
    destinations: Array.from(structure.destinations) as NonEmptyArray<string>,
    sources: Array.from(structure.sources) as NonEmptyArray<string>,
    unusedSources: Array.from(structure.unusedSources),
  };
};

/**
 * @description
 * This method is used to merge all the objects of a coin, which are contained in a given `structure`, accounting
 * already existing in a given `transaction` transaction block `MergeCoins` transactions.
 *
 * Splits given `structure.destinations` into a `firstDestinationObject` and `restDestinationObjects`.
 * Merges all `coinsToMerge` into the `firstDestinationObject`, where `coinsToMerge` consists of the
 * `restDestinationObjects` and `structure.unusedSources`.
 *
 * In case there is no coins to merge (e.g. when all coins are already merged), it returns the given transaction
 * block and the `firstDestinationObject` as a `destinationObject`.
 *
 * @param {TransactionBlock} options.transaction — The transaction to add `MergeCoins` transaction to.
 * @param {MergedCoinsStructure} options.structure — The result of the `getMergedCoinsStructure` method, containing
 * a required data about the `MergeCoins` transactions of the required coin, which already exists in the given
 * transaction block.
 * @return {object} — An object containing the result transaction, a result of the final merge (only when this merge
 * was made), and the `destinationObject`, all the coins were merged into.
 */
export const mergeAllCoinsByStructure = ({
  transaction,
  structure,
}: {
  transaction: TransactionBlock;
  structure: MergedCoinsStructure;
}): { tx: TransactionBlock; txRes?: TransactionResult; destinationObject: string } => {
  const tx = transaction ?? new TransactionBlock();

  const [firstDestinationObject, ...restDestinationObjects] = structure.destinations;

  const coinsToMerge = [...restDestinationObjects, ...structure.unusedSources].map((coinObject) =>
    tx.object(coinObject),
  );

  if (coinsToMerge.length === 0) {
    return { tx, destinationObject: firstDestinationObject };
  }

  const txRes = tx.mergeCoins(tx.object(firstDestinationObject), coinsToMerge);

  return { tx, txRes, destinationObject: firstDestinationObject };
};

export const getResultFeesAmountInMist = (fee: SwapFee) => {
  return fee.fees
    .reduce((feesSum: BigNumber, feeObject) => (feesSum = feesSum.plus(feeObject.feeAmount)), new BigNumber(0))
    .toString();
};

export const getAmountIncludingFees = ({
  fullAmount,
  fee,
}: {
  fullAmount: string;
  fee: SwapFee | undefined;
}): string => {
  if (fee === undefined) {
    return fullAmount;
  }

  const resultFeeAmountInMist = getResultFeesAmountInMist(fee);

  return new BigNumber(fullAmount)
    .minus(new BigNumber(resultFeeAmountInMist).dividedBy(10 ** fee.tokenFromDecimals))
    .toString();
};
