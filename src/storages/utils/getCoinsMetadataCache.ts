import { ExtractedCoinMetadataType } from "../../providers/flowx/types";
import { Storage, StorageProperty, StorageValue } from "../types";
import { isShortCoinMetadataArray } from "./typeguards";

/**
 * Returns coins metadata cache from storage. If cache is not up to date, empty array is returned.
 */
export async function getCoinsMetadataCache({
  storage,
  provider,
  updateCacheInterval,
}: {
  storage: Storage;
  provider: string;
  updateCacheInterval: number;
}): Promise<ExtractedCoinMetadataType[]> {
  let coinsMetadataCache: ExtractedCoinMetadataType[] = [];

  const coinsMetadata: StorageValue = await storage.getCache({
    provider: provider,
    property: StorageProperty.CoinsMetadata,
  });

  if (isShortCoinMetadataArray(coinsMetadata?.value)) {
    const timestamp = parseInt(coinsMetadata.timestamp);
    const cacheIsUpToDate = timestamp + updateCacheInterval > Date.now();

    if (cacheIsUpToDate) {
      coinsMetadataCache = coinsMetadata.value;
    } else {
      console.warn(`[getCoinsMetadataCache] ${provider} coins metadata cache is not up to date.`);
    }
  } else if (coinsMetadata === null) {
    console.warn(
      `[getCoinsMetadataCache] ${provider} Received empty coinsMetadataCache from strorage,
      coinsMetadataCache === null `,
    );
  } else {
    const stringifiedCoinMetadata: string = JSON.stringify(coinsMetadata.value);
    throw new Error(
      `[${provider}] getCoinsMetadataCache: coins metadata from storage is not ` +
        `(ExtractedCoinMetadataType[] or null). Coin metadata from storage: ${stringifiedCoinMetadata}`,
    );
  }

  return coinsMetadataCache;
}
