import { CommonCoinData } from "../../managers/types";
import { Storage, StorageProperty, StorageValue } from "../types";
import { isCommonCoinDataArray } from "./typeguards";

/**
 * Returns coins cache from storage. If cache is not up to date, empty map is returned.
 */
export const getCoinsCache = async ({
  storage,
  provider,
  updateCacheInterval,
}: {
  storage: Storage;
  provider: string;
  updateCacheInterval: number;
}): Promise<Map<string, CommonCoinData>> => {
  let coinsCache: Map<string, CommonCoinData> = new Map();

  const coins: StorageValue = await storage.getCache({
    provider,
    property: StorageProperty.Coins,
  });

  if (isCommonCoinDataArray(coins?.value)) {
    const timestamp = parseInt(coins.timestamp);
    const cacheIsUpToDate = timestamp + updateCacheInterval > Date.now();

    if (cacheIsUpToDate) {
      coinsCache = coins.value.reduce((cache: Map<string, CommonCoinData>, coin: CommonCoinData) => {
        cache.set(coin.type, coin);
        return cache;
      }, new Map());
    } else {
      console.warn(`[getCoinsCache] ${provider} coins cache is not up to date.`);
    }
  } else if (coins === null) {
    console.warn(`[getCoinsCache] ${provider} Received empty coins from strorage, coins === null `);
  } else {
    const stringifiedCoins: string = JSON.stringify(coins.value);
    throw new Error(
      `[${provider}] prefillCaches: coins from storage are not (CommonCoinData[] or null). ` +
        `Coins from storage: ${stringifiedCoins}`,
    );
  }

  return coinsCache;
};
