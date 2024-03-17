import { ShortPoolData } from "../../providers/turbos/types";
import { Storage, StorageProperty, StorageValue } from "../types";
import { isShortPoolDataArray } from "./typeguards";

/**
 * Returns pools cache from storage. If cache is not up to date, empty array is returned.
 */
export const getPoolsCache = async ({
  storage,
  provider,
  updateCacheInterval,
}: {
  storage: Storage;
  provider: string;
  updateCacheInterval: number;
}): Promise<ShortPoolData[]> => {
  let poolsCache: ShortPoolData[] = [];

  const pools: StorageValue = await storage.getCache({
    provider,
    property: StorageProperty.Pools,
  });

  if (isShortPoolDataArray(pools?.value)) {
    const timestamp = parseInt(pools.timestamp);
    const cacheIsUpToDate = timestamp + updateCacheInterval > Date.now();

    if (cacheIsUpToDate) {
      poolsCache = pools.value;
    } else {
      console.warn(`[getPoolsCache] ${provider} pools cache is not up to date.`);
    }
  } else if (pools === null) {
    console.warn(`[getPoolsCache] ${provider} Received empty pools from strorage, pools === null `);
  } else {
    const stringifiedPools: string = JSON.stringify(pools.value);
    throw new Error(
      `[${provider}] getPoolsCache: pools from storage are not ` +
        `(ShortPoolData[] or null). Pools from storage: ${stringifiedPools}`,
    );
  }

  return poolsCache;
};
