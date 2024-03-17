import { CommonPoolData } from "../../providers/types";
import { Storage, StorageProperty, StorageValue } from "../types";
import { isCommonPoolDataArray } from "./typeguards";

/**
 * Returns paths cache from storage. If cache is not up to date, empty map is returned.
 */
export const getPathsCache = async ({
  storage,
  provider,
  updateCacheInterval,
}: {
  storage: Storage;
  provider: string;
  updateCacheInterval: number;
}): Promise<Map<string, CommonPoolData>> => {
  let pathsCache: Map<string, CommonPoolData> = new Map();

  const paths: StorageValue = await storage.getCache({
    provider,
    property: StorageProperty.Paths,
  });

  if (isCommonPoolDataArray(paths?.value)) {
    const timestamp = parseInt(paths.timestamp);
    const cacheIsUpToDate = timestamp + updateCacheInterval > Date.now();

    if (cacheIsUpToDate) {
      pathsCache = paths.value.reduce((cache: Map<string, CommonPoolData>, path: CommonPoolData) => {
        const key = `${path.base}-${path.quote}`;
        cache.set(key, path);
        return cache;
      }, new Map());
    } else {
      console.warn(`[getPathsCache] ${provider} paths cache is not up to date.`);
    }
  } else if (paths === null) {
    console.warn(`[getPathsCache] ${provider} Received empty paths from strorage, paths === null `);
  } else {
    const stringifiedPaths: string = JSON.stringify(paths.value);
    throw new Error(
      `[${provider}] prefillCaches: paths from storage are not (CommonPoolData[] or null). ` +
        `Paths from storage: ${stringifiedPaths}`,
    );
  }

  return pathsCache;
};
