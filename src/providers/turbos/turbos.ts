import { SuiClient } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import BigNumber from "bignumber.js";
import { Network, TurbosSdk } from "turbos-clmm-sdk";
import { EventEmitter } from "../../emitters/EventEmitter";
import { CommonCoinData, UpdatedCoinsCache } from "../../managers/types";
import { InMemoryStorageSingleton } from "../../storages/InMemoryStorage";
import { Storage } from "../../storages/types";
import { LONG_SUI_COIN_TYPE, SHORT_SUI_COIN_TYPE, exitHandlerWrapper } from "../common";
import { CacheOptions, CoinsCache, CommonPoolData, IPoolProvider, PathsCache } from "../types";
import { convertSlippage } from "../utils/convertSlippage";
import { getCoinInfoFromCache } from "../utils/getCoinInfoFromCache";
import { removeDecimalPart } from "../utils/removeDecimalPart";
import { getCoinsAndPathsCaches } from "../../storages/utils/getCoinsAndPathsCaches";
import { getPoolsCache } from "../../storages/utils/getPoolsCache";
import { storeCaches } from "../../storages/utils/storeCaches";
import { CoinData, PoolData, ShortPoolData, SwapRequiredData, TurbosOptions } from "./types";
import { getCoinsMap, getPathsMap, getPoolByCoins, isCoinsApiResponseValid, isPoolsApiResponseValid } from "./utils";
import { swapDoctored } from "../../managers/dca/adapterUtils/turbosUtils";
import { buildDcaTxBlock } from "../../managers/dca/adapters/turbosAdapter";

// TODO: Need a fallback in case when API doesn't work
// sdk.pool.getPools() doesn't work

/**
 * @class TurbosSingleton
 * @extends EventEmitter
 * @implements {IPoolProvider<TurbosSingleton>}
 * @description Represents a singleton instance of TurbosManager managing TurbosSdk functionality.
 *
 * Note: If using `lazyLoading: true` with any storage configuration in a serverless/cloud functions environment,
 * be aware that each invocation of your cloud function will start cache population from scratch.
 * This may lead to unexpected behavior when using different SDK methods. To avoid this and minimize the time
 * for cache population, consider using `lazyLoading: false` along with passing a persistent
 * storage adapter (external, e.g., Redis or any kind of DB) to the ProviderSingleton.
 */
export class TurbosSingleton extends EventEmitter implements IPoolProvider<TurbosSingleton> {
  private static _instance: TurbosSingleton | undefined;
  private static TURBOS_API_URL = "https://api.turbos.finance";
  public turbosSdk: TurbosSdk;
  public isSmartRoutingAvailable = false;
  public providerName = "Turbos";
  public poolsCache: ShortPoolData[] = [];
  public pathsCache: PathsCache = new Map();
  public coinsCache: CoinsCache = new Map();
  private cacheOptions: CacheOptions;
  private intervalId: NodeJS.Timeout | undefined;
  private proxy: string | undefined;
  private storage: Storage;

  /**
   * @constructor
   * @param {Omit<TurbosOptions, "lazyLoading">} options - The options for TurbosSingleton.
   */
  private constructor(options: Omit<TurbosOptions, "lazyLoading">) {
    super();
    const provider = new SuiClient({ url: options.suiProviderUrl });
    this.turbosSdk = new TurbosSdk(Network.mainnet, provider);
    const { updateIntervally = true, ...restCacheOptions } = options.cacheOptions;
    this.cacheOptions = { updateIntervally, ...restCacheOptions };
    this.proxy = options.proxy;
    this.storage = options.cacheOptions.storage ?? InMemoryStorageSingleton.getInstance();
  }

  /**
   * @public
   * @method getInstance
   * @description Gets the singleton instance of TurbosSingleton.
   * @param {TurbosOptions} [options] - Options for TurbosSingleton.
   * @return {Promise<TurbosSingleton>} The singleton instance of TurbosSingleton.
   */
  public static async getInstance(options?: TurbosOptions): Promise<TurbosSingleton> {
    if (!TurbosSingleton._instance) {
      if (options === undefined) {
        throw new Error("[TurbosManager] Options are required in arguments to create instance.");
      }
      const { suiProviderUrl, cacheOptions, lazyLoading = true, proxy } = options;

      const instance = new TurbosSingleton({ suiProviderUrl, cacheOptions, proxy });
      lazyLoading ? instance.init() : await instance.init();
      TurbosSingleton._instance = instance;
    }

    return TurbosSingleton._instance;
  }

  /**
   * @private
   * @method init
   * @description Initializes the TurbosSingleton instance.
   * @return {Promise<void>} A Promise that resolves when initialization is complete.
   */
  private async init() {
    console.debug(`[${this.providerName}] Singleton initiating.`);

    await this.fillCacheFromStorage();
    await this.updateCaches();
    this.cacheOptions.updateIntervally && this.updateCachesIntervally();

    this.bufferEvent("cachesUpdate", this.getCoins());
  }

  /**
   * Fills the cache from storage asynchronously.
   *
   * @private
   * @return {Promise<void>} A promise that resolves when the cache is filled from storage.
   */
  private async fillCacheFromStorage(): Promise<void> {
    try {
      const { coinsCache, pathsCache } = await getCoinsAndPathsCaches({
        storage: this.storage,
        provider: this.providerName,
        updateCacheInterval: this.cacheOptions.updateIntervalInMs,
      });
      const poolsCache = await getPoolsCache({
        storage: this.storage,
        provider: this.providerName,
        updateCacheInterval: this.cacheOptions.updateIntervalInMs,
      });

      this.coinsCache = coinsCache;
      this.pathsCache = pathsCache;
      this.poolsCache = poolsCache;
    } catch (error) {
      console.error(`[${this.providerName}] fillCacheFromStorage failed:`, error);
    }
  }

  /**
   * Checks if the storage cache is empty.
   *
   * @private
   * @return {boolean} True if the storage cache is empty, false otherwise.
   */
  private isStorageCacheEmpty() {
    const isCacheEmpty = this.coinsCache.size === 0 || this.pathsCache.size === 0 || this.poolsCache.length === 0;

    return isCacheEmpty;
  }

  /**
   * @private
   * @method updateCaches
   * @description Updates the caches for pools, paths, and coins.
   * @return {Promise<void>} A Promise that resolves when caches are updated.
   */
  private async updateCaches({ force }: { force: boolean } = { force: false }): Promise<void> {
    const isCacheEmpty = this.isStorageCacheEmpty();

    if (isCacheEmpty || force) {
      try {
        await this.updatePoolsCache();
        this.updatePathsCache();
        await this.updateCoinsCache();
        this.emit("cachesUpdate", this.getCoins());

        await storeCaches({
          provider: this.providerName,
          storage: this.storage,
          coinsCache: this.getCoins(),
          pathsCache: this.getPaths(),
          poolsCache: this.getPools(),
        });

        console.debug("[Turbos] Caches are updated and stored.");
      } catch (error) {
        console.error("[Turbos] Caches update failed:", error);
      }
    }
  }

  /**
   * @private
   * @method updateCachesIntervally
   * @description Updates the caches at regular intervals.
   * @return {void}
   */
  private updateCachesIntervally(): void {
    let isUpdatingCurrently = false;
    this.intervalId = setInterval(async () => {
      try {
        if (isUpdatingCurrently) {
          return;
        }
        isUpdatingCurrently = true;
        await this.updateCaches({ force: true });
      } finally {
        isUpdatingCurrently = false;
      }
    }, this.cacheOptions.updateIntervalInMs);

    exitHandlerWrapper({ intervalId: this.intervalId, providerName: this.providerName });
  }

  /**
   * @private
   * @method updatePoolsCache
   * @description Updates the pools cache.
   * @return {Promise<void>} A Promise that resolves when the pools cache is updated.
   */
  public async updatePoolsCache(): Promise<void> {
    const pools: PoolData[] = await this.fetchPoolsFromApi();

    // TODO: Remove that method to separate one
    this.poolsCache = pools.map((pool: PoolData) => ({
      poolId: pool.pool_id,
      coinTypeA: pool.coin_type_a,
      coinTypeB: pool.coin_type_b,
    }));
  }

  /**
   * @private
   * @method updatePathsCache
   * @description Updates the paths cache.
   * @return {void}
   */
  private updatePathsCache(): void {
    this.pathsCache = getPathsMap(this.poolsCache);
  }

  /**
   * @private
   * @method updateCoinsCache
   * @description Updates the coins cache.
   * @return {Promise<void>} A Promise that resolves when the coins cache is updated.
   */
  private async updateCoinsCache(): Promise<void> {
    const coins: CoinData[] = await this.fetchCoinsFromApi();
    this.coinsCache = getCoinsMap(coins);
  }

  /**
   * Gets pools data from the Turbos API.
   *
   * @public
   * @async
   * @return {Promise<PoolData[]>} A Promise that resolves to an array of PoolData.
   */
  private async fetchPoolsFromApi(): Promise<PoolData[]> {
    const url: string = this.proxy
      ? `${this.proxy}/${TurbosSingleton.TURBOS_API_URL}/pools`
      : `${TurbosSingleton.TURBOS_API_URL}/pools`;

    const response: Response = await fetch(url);
    const responseJson: { code: number; message: string; data: PoolData[] } = await response.json();
    const isValidPoolsResponse = isPoolsApiResponseValid(responseJson);

    if (!isValidPoolsResponse) {
      throw new Error("[Turbos] Pools response from API is not valid.");
    }

    return responseJson.data;
  }

  /**
   * Fetches coin data from the Turbos API.
   *
   * @public
   * @async
   * @return {Promise<CoinData[]>} A Promise that resolves to an array of CoinData.
   */
  private async fetchCoinsFromApi(): Promise<CoinData[]> {
    const response: Response = await fetch(`${TurbosSingleton.TURBOS_API_URL}/coins`);
    const responseJson: { code: number; message: string; data: CoinData[] } = await response.json();
    const isValidResponse = isCoinsApiResponseValid(responseJson);

    if (!isValidResponse) {
      throw new Error("[Turbos] Coins response from API is not valid.");
    }

    return responseJson.data;
  }

  /**
   * @public
   * @method getPools
   * @description Gets the pools cache.
   * @return {ShortPoolData[]} Pools cache.
   */
  public getPools(): ShortPoolData[] {
    return this.poolsCache;
  }

  /**
   * Fetches the pool data and maps them into a map where the key is a combination of
   * `coin_type_a` and `coin_type_b` and the value is a `CommonPoolData` object.
   *
   * @return {Map<string, CommonPoolData>} Map of `CommonPoolData`.
   */
  public getPaths(): Map<string, CommonPoolData> {
    return this.pathsCache;
  }

  /**
   * Transforms coins cache to CommonCoinData format.
   *
   * @public
   * @async
   * @return {CommonCoinData[]} An array of CommonCoinData.
   */
  public getCoins(): UpdatedCoinsCache {
    const allCoins: CommonCoinData[] = Array.from(this.coinsCache.values());
    return { provider: this.providerName, data: allCoins };
  }

  /**
   * @public
   * @method getRouteData
   * @description Gets route data for a given pair of coins.
   * @param {Object} options - Options for getting route data.
   * @param {string} options.coinTypeFrom - The coin type to swap from.
   * @param {string} options.coinTypeTo - The coin type to swap to.
   * @param {string} options.inputAmount - The input amount for the swap.
   * @param {number} options.slippagePercentage - The slippage percentage.
   * @param {string} options.publicKey - The public key for the swap.
   * @return {Promise<{ outputAmount: bigint, route: ExtendedSwapCalculatedOutputDataType }>} Route data.
   */
  public async getRouteData({
    coinTypeFrom,
    coinTypeTo,
    inputAmount,
    publicKey,
  }: {
    coinTypeFrom: string;
    coinTypeTo: string;
    inputAmount: string;
    slippagePercentage: number;
    publicKey: string;
  }) {
    const { outputAmount, ...otherData } = await this.getSwapRequiredData({
      inputAmount,
      tokenFrom: coinTypeFrom,
      tokenTo: coinTypeTo,
      publicKey,
    });

    return { outputAmount, route: { outputAmount, ...otherData } };
  }

  /**
   * Retrieves swap-related data required for swapping tokens.
   *
   * @public
   * @async
   * @param {string} tokenFrom - The token from which the swap is initiated.
   * @param {string} tokenTo - The target token for the swap.
   * @param {number} inputAmount - The amount of the input token for the swap.
   * @param {string} publicKey - The public key of the user initiating the swap.
   * @return {Promise<SwapRequiredData>} A Promise that resolves to the SwapRequiredData for the swap.
   * @throws {Error} Throws an error if there is no pool with the specified coin types.
   */
  private async getSwapRequiredData({
    tokenFrom,
    tokenTo,
    inputAmount,
    publicKey,
  }: {
    tokenFrom: string;
    tokenTo: string;
    inputAmount: string;
    publicKey: string;
  }): Promise<SwapRequiredData> {
    const pool: ShortPoolData | undefined = getPoolByCoins(tokenFrom, tokenTo, this.poolsCache);

    if (!pool) {
      throw new Error(`[TurbosManager] Pool with coin types "${tokenFrom}" and "${tokenTo}" is not found.`);
    }

    const poolId: string = pool.poolId;
    const tokenFromIsSui: boolean = tokenFrom === SHORT_SUI_COIN_TYPE || tokenFrom === LONG_SUI_COIN_TYPE;
    const tokenFromIsTokenA: boolean = tokenFromIsSui
      ? pool.coinTypeA === SHORT_SUI_COIN_TYPE || pool.coinTypeA === LONG_SUI_COIN_TYPE
      : pool.coinTypeA === tokenFrom;
    const inputCoin: CommonCoinData | undefined = getCoinInfoFromCache(tokenFrom, this.coinsCache);

    if (!inputCoin) {
      throw new Error(`[TurbosManager] Cannot find coin with type "${tokenFrom}".`);
    }

    const inputCoinDecimals: number = inputCoin.decimals;
    const inputAmountWithDecimalsBigNumber = new BigNumber(inputAmount).multipliedBy(10 ** inputCoinDecimals);
    // We do removing the decimal part in case client send number with more decimal part
    // than this particular token has decimal places allowed (`inputCoinDecimals`)
    // That's prevent situation when casting
    // BigNumber to BigInt fails with error ("Cannot convert 183763562.1 to a BigInt")
    const inputAmountWithoutExceededDecimalPart = removeDecimalPart(inputAmountWithDecimalsBigNumber);
    const inputAmountWithDecimals = inputAmountWithoutExceededDecimalPart.toString();

    // TODO (possible improvement):
    // executing time could be reduced by patching this method to pass into it config (getConfig() inside)
    const swapResult = (
      await this.turbosSdk.trade.computeSwapResult({
        pools: [{ pool: poolId, a2b: tokenFromIsTokenA }],
        address: publicKey,
        amountSpecified: inputAmountWithDecimals,
        amountSpecifiedIsInput: true,
      })
    )[0];
    const nextTickIndex: number = this.turbosSdk.math.bitsToNumber(swapResult.tick_current_index.bits);
    const outputAmount: string = tokenFromIsTokenA ? swapResult.amount_b : swapResult.amount_a;

    return {
      outputAmount: BigInt(outputAmount),
      nextTickIndex,
      pool,
      inputAmountWithDecimals,
      tokenFromIsTokenA,
    };
  }

  /**
   * Gets a transaction block for swapping tokens based on provided swap data.
   *
   * @public
   * @async
   * @param {SwapRequiredData} swapRequiredData - The required data for the swap.
   * @param {string} publicKey - The public key of the user.
   * @param {number} [slippagePercentage=10] - The slippage percentage.
   * @return {Promise<TransactionBlock>} A Promise that resolves to a TransactionBlock.
   */
  public async getSwapTransaction({
    route,
    publicKey,
    slippagePercentage = 10,
  }: {
    route: SwapRequiredData;
    publicKey: string;
    slippagePercentage: number;
  }): Promise<TransactionBlock> {
    const { pool, outputAmount, nextTickIndex, inputAmountWithDecimals, tokenFromIsTokenA } = route;
    const parsedSlippage: string = convertSlippage(slippagePercentage).toString();

    const transaction: TransactionBlock = await this.turbosSdk.trade.swap({
      routes: [{ pool: pool.poolId, a2b: tokenFromIsTokenA, nextTickIndex }],
      coinTypeA: tokenFromIsTokenA ? pool.coinTypeA : pool.coinTypeB,
      coinTypeB: tokenFromIsTokenA ? pool.coinTypeB : pool.coinTypeA,
      address: publicKey,
      amountA: inputAmountWithDecimals,
      amountB: outputAmount.toString(),
      amountSpecifiedIsInput: true,
      slippage: parsedSlippage,
    });

    return transaction;
  }

  /**
   * Gets a transaction block for swapping tokens based on provided swap data.
   *
   * @public
   * @async
   * @param {SwapRequiredData} swapRequiredData - The required data for the swap.
   * @param {string} publicKey - The public key of the user.
   * @param {number} [slippagePercentage=10] - The slippage percentage.
   * @return {Promise<TransactionBlock>} A Promise that resolves to a TransactionBlock.
   */
  public async getSwapTransactionDoctored({
    route,
    publicKey,
    slippagePercentage = 10,
  }: {
    route: SwapRequiredData;
    publicKey: string;
    slippagePercentage: number;
  }): Promise<TransactionBlock> {
    const { pool, outputAmount, nextTickIndex, inputAmountWithDecimals, tokenFromIsTokenA } = route;
    const parsedSlippage: string = convertSlippage(slippagePercentage).toString();

    const transaction: TransactionBlock = await swapDoctored(this.turbosSdk, {
      routes: [{ pool: pool.poolId, a2b: tokenFromIsTokenA, nextTickIndex }],
      coinTypeA: tokenFromIsTokenA ? pool.coinTypeA : pool.coinTypeB,
      coinTypeB: tokenFromIsTokenA ? pool.coinTypeB : pool.coinTypeA,
      address: publicKey,
      amountA: inputAmountWithDecimals,
      amountB: outputAmount.toString(),
      amountSpecifiedIsInput: true,
      slippage: parsedSlippage,
    });

    return transaction;
  }

  /**
   * Removes the current instance of TurbosSingleton.
   *
   * Disclaimer: While this method in this class is marked as public, it is strongly discouraged
   * to use it directly unless you are certain about the behavior.
   */
  public static removeInstance() {
    TurbosSingleton._instance = undefined;
  }

  public buildDcaTxBlockAdapter = buildDcaTxBlock;
}
