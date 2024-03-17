import { CoinAsset, CoinNode, PathLink } from "@cetusprotocol/cetus-sui-clmm-sdk";
import { CoinsCache, PathsCache } from "../types";
import {
  APIResponse,
  CetusCreatePoolEventParsedJson,
  CoinInfo,
  CoinMap,
  CoinNodeWithSymbol,
  LPList,
  PathMap,
} from "./types";

/* eslint-disable require-jsdoc */
export function isApiResponseValid(
  response: APIResponse,
): response is { code: 200; msg: "OK"; data: { lp_list: LPList[] } } {
  return (
    response.code === 200 &&
    response.msg === "OK" &&
    response.data !== undefined &&
    Array.isArray(response.data.lp_list) &&
    response.data.lp_list.length > 0 &&
    response.data.lp_list.every(isLPListValid)
  );
}

export function isLPListValid(lpList: LPList): boolean {
  return (
    typeof lpList.symbol === "string" &&
    typeof lpList.name === "string" &&
    typeof lpList.decimals === "number" &&
    typeof lpList.fee === "string" &&
    typeof lpList.tick_spacing === "string" &&
    typeof lpList.pool_type === "string" &&
    typeof lpList.address === "string" &&
    typeof lpList.coin_a_address === "string" &&
    typeof lpList.coin_b_address === "string" &&
    typeof lpList.is_closed === "boolean" &&
    typeof lpList.price === "string" &&
    isCoinInfoValid(lpList.coin_a) &&
    isCoinInfoValid(lpList.coin_b) &&
    isObjectValid(lpList.object)
  );
}

export function isCoinInfoValid(coinInfo: CoinInfo): boolean {
  return (
    typeof coinInfo.name === "string" &&
    typeof coinInfo.symbol === "string" &&
    typeof coinInfo.decimals === "number" &&
    typeof coinInfo.address === "string" &&
    typeof coinInfo.balance === "string"
  );
}

export function isObjectValid(obj: unknown): boolean {
  return !!(obj && typeof obj === "object" && !Array.isArray(obj));
}

export function coinExists(coin: string, coinMap: CoinMap): boolean {
  return coinMap.has(coin);
}

export function getCoinNode(coin: string, coinMap: CoinMap): CoinNode | undefined {
  return coinMap.get(coin);
}

export function hasPath(coinA: string, coinB: string, pathMap: PathMap): boolean {
  const keyAB = `${coinA}-${coinB}`;
  const keyBA = `${coinB}-${coinA}`;
  return pathMap.has(keyAB) || pathMap.has(keyBA);
}

export function getPoolsDataFromApiData({ poolsInfo }: { poolsInfo: LPList[] }) {
  const coinMap: CoinMap = new Map();
  const poolMap: PathMap = new Map();

  for (const pool of poolsInfo) {
    if (pool.is_closed) {
      continue;
    }

    const coinA = pool.coin_a.address;
    const coinB = pool.coin_b.address;

    coinMap.set(coinA, {
      symbol: pool.coin_a.symbol,
      address: pool.coin_a.address,
      type: pool.coin_a.address,
      decimals: pool.coin_a.decimals,
    });
    coinMap.set(coinB, {
      symbol: pool.coin_b.symbol,
      address: pool.coin_b.address,
      type: pool.coin_b.address,
      decimals: pool.coin_b.decimals,
    });

    const pair = `${coinA}-${coinB}`;
    const pathProvider = poolMap.get(pair);
    if (pathProvider) {
      pathProvider.addressMap.set(Number(pool.fee) * 100, pool.address);
    } else {
      poolMap.set(pair, {
        base: coinA,
        quote: coinB,
        addressMap: new Map([[Number(pool.fee) * 100, pool.address]]),
      });
    }
  }

  const coins: CoinNodeWithSymbol[] = Array.from(coinMap.values());
  const paths: PathLink[] = Array.from(poolMap.values());

  return { coins, paths, coinMap, poolMap };
}

export function getCoinsAndPathsCachesFromMaps({ paths, coins }: { paths: PathMap; coins: CoinMap }): {
  coinsCache: CoinsCache;
  pathsCache: PathsCache;
} {
  const coinsCache: CoinsCache = new Map();
  const pathsCache: PathsCache = new Map();

  paths.forEach((path: PathLink, pathKey: string) => {
    pathsCache.set(pathKey, { base: path.base, quote: path.quote });
  });

  coins.forEach((coin: CoinNodeWithSymbol, coinType: string) => {
    coinsCache.set(coinType, { symbol: coin.symbol, type: coin.type, decimals: coin.decimals });
  });

  return { coinsCache, pathsCache };
}

export function isCetusCreatePoolEventParsedJson(data: unknown): data is CetusCreatePoolEventParsedJson {
  return (
    typeof data === "object" &&
    data !== null &&
    "coin_type_a" in data &&
    typeof data.coin_type_a === "string" &&
    "coin_type_b" in data &&
    typeof data.coin_type_b === "string" &&
    "pool_id" in data &&
    typeof data.pool_id === "string" &&
    "tick_spacing" in data &&
    typeof data.tick_spacing === "number"
  );
}

export function getCoinMapFromCoinsCache(coinsCache: CoinsCache): CoinMap {
  const coins: CoinMap = new Map();
  coinsCache.forEach((coinData, coinType) => coins.set(coinType, { ...coinData, address: coinType }));

  return coins;
}

export const getMockedAssets = (tokenFrom: string, tokenTo: string): CoinAsset[] => [
  {
    coinAddress: tokenFrom,
    coinObjectId: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    balance: BigInt("9999999999999999999"),
  },
  {
    coinAddress: tokenTo,
    coinObjectId: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    balance: BigInt("9999999999999999999"),
  },
];
