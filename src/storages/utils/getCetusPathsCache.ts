import { PathLink } from "@cetusprotocol/cetus-sui-clmm-sdk";
import { CetusPathForStorage } from "../../providers/cetus/types";
import { Storage, StorageProperty, StorageValue } from "../types";
import { isCetusPathForStorageArray } from "./typeguards";

/**
 * Returns Cetus paths cache from storage. If cache is not up to date, empty map is returned.
 */
export const getCetusPathsCache = async ({
  storage,
  provider,
  updateCacheInterval,
}: {
  storage: Storage;
  provider: string;
  updateCacheInterval: number;
}): Promise<Map<string, PathLink>> => {
  let pathsCache: Map<string, PathLink> = new Map();

  const paths: StorageValue = await storage.getCache({
    provider,
    property: StorageProperty.CetusPaths,
  });

  if (isCetusPathForStorageArray(paths?.value)) {
    const timestamp = parseInt(paths.timestamp);
    const cacheIsUpToDate = timestamp + updateCacheInterval > Date.now();

    if (cacheIsUpToDate) {
      pathsCache = paths.value.reduce((cache: Map<string, PathLink>, path: CetusPathForStorage) => {
        const key = `${path.base}-${path.quote}`;
        const addressMap = new Map(path.addressMap);

        cache.set(key, { ...path, addressMap });

        return cache;
      }, new Map());
    } else {
      console.warn(`[getCetusPathsCache] ${provider} paths cache is not up to date.`);
    }
  } else if (paths === null) {
    console.warn(`[getCetusPathsCache] ${provider} Received empty paths from strorage, paths === null `);
  } else {
    const stringifiedPaths: string = JSON.stringify(paths.value);
    throw new Error(
      `[${provider}] prefillCaches: paths from storage are not (PathLink[] or null). ` +
        `Paths from storage: ${stringifiedPaths}`,
    );
  }

  return pathsCache;
};
