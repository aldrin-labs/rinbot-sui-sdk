import { SuiClient, SuiEvent } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import BigNumber from "bignumber.js";
import { Contract, Network, TurbosSdk } from "turbos-clmm-sdk";
import { EventEmitter } from "../../emitters/EventEmitter";
import { CoinManagerSingleton } from "../../managers/coin/CoinManager";
import { swapDoctored } from "../../managers/dca/adapterUtils/turbosUtils";
import { buildDcaTxBlock } from "../../managers/dca/adapters/turbosAdapter";
import { CommonCoinData, UpdatedCoinsCache } from "../../managers/types";
import { InMemoryStorageSingleton } from "../../storages/InMemoryStorage";
import { Storage } from "../../storages/types";
import { getCoinsAndPathsCaches } from "../../storages/utils/getCoinsAndPathsCaches";
import { getPoolsCache } from "../../storages/utils/getPoolsCache";
import { storeCaches } from "../../storages/utils/storeCaches";
import { LONG_SUI_COIN_TYPE, SHORT_SUI_COIN_TYPE, exitHandlerWrapper, getAllUserEvents } from "../common";
import { CacheOptions, CoinsCache, CommonPoolData, IPoolProvider, PathsCache } from "../types";
import { convertSlippage } from "../utils/convertSlippage";
import { getCoinInfoFromCache } from "../utils/getCoinInfoFromCache";
import { removeDecimalPart } from "../utils/removeDecimalPart";
import {
  CoinData,
  DetailedTurbosOwnedPoolInfo,
  PoolData,
  ShortPoolData,
  SwapRequiredData,
  TurbosOptions,
  TurbosOwnedPool,
} from "./types";
import {
  getCoinsDataForPool,
  getCoinsMap,
  getPathsMap,
  getPoolByCoins,
  isCoinsApiResponseValid,
  isPoolsApiResponseValid,
  isTurbosCreatePoolEventParsedJson,
} from "./utils";

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

  public static CREATE_POOL_GAS_BUDGET = 100_000_000;
  public static FEE_DIVIDER = 10_000;

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
    // By default Turbos API returns not all the pools, so we need to explicitly set count of pools we want to fetch.
    const fetchPoolsCount = 1_000_000;

    const url: string = this.proxy
      ? `${this.proxy}/${TurbosSingleton.TURBOS_API_URL}/pools?pageSize=${fetchPoolsCount}`
      : `${TurbosSingleton.TURBOS_API_URL}/pools?pageSize=${fetchPoolsCount}`;

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
   * @param {SwapRequiredData} route - The required data for the swap.
   * @param {string} publicKey - The public key of the user.
   * @param {number} [slippagePercentage=10] - The slippage percentage.
   * @param {string[]} inputCoinIds — The input coin object ids.
   * @return {Promise<TransactionBlock>} A Promise that resolves to a TransactionBlock.
   */
  public async getSwapTransactionDoctored({
    route,
    publicKey,
    slippagePercentage = 10,
    inputCoinIds,
    txb,
  }: {
    route: SwapRequiredData;
    publicKey: string;
    slippagePercentage: number;
    inputCoinIds?: string[];
    txb?: TransactionBlock;
  }): Promise<TransactionBlock> {
    const { pool, outputAmount, nextTickIndex, inputAmountWithDecimals, tokenFromIsTokenA } = route;
    const parsedSlippage: string = convertSlippage(slippagePercentage).toString();

    const transaction: TransactionBlock = await swapDoctored(
      this.turbosSdk,
      {
        routes: [{ pool: pool.poolId, a2b: tokenFromIsTokenA, nextTickIndex }],
        coinTypeA: tokenFromIsTokenA ? pool.coinTypeA : pool.coinTypeB,
        coinTypeB: tokenFromIsTokenA ? pool.coinTypeB : pool.coinTypeA,
        address: publicKey,
        amountA: inputAmountWithDecimals,
        amountB: outputAmount.toString(),
        amountSpecifiedIsInput: true,
        slippage: parsedSlippage,
        txb,
      },
      inputCoinIds,
    );

    return transaction;
  }

  /**
   * Generates a transaction for creating a new liquidity pool.
   *
   * @param {Object} params - Parameters for creating the pool transaction.
   * @param {number} params.tickSpacing - The tick spacing of the pool.
   * @param {string} params.coinTypeA - The type of the first coin in the pool.
   * @param {string} params.coinTypeB - The type of the second coin in the pool.
   * @param {number} params.coinDecimalsA - The number of decimals for the first coin.
   * @param {number} params.coinDecimalsB - The number of decimals for the second coin.
   * @param {string} params.amountA - The amount of the first coin to deposit into the pool. Example: 10000.1286 RINCEL
   * @param {string} params.amountB - The amount of the second coin to deposit into the pool. Example: 12.472 SUI
   * @param {number} params.slippage - The acceptable slippage percentage for the transaction. Example: 10 (means 10%)
   * @param {string} params.publicKey - The public key of the transaction sender.
   * @return {Promise<TransactionBlock>} A promise that resolves to the transaction block for creating the pool.
   */
  public async getCreatePoolTransaction({
    tickSpacing,
    coinDecimalsA,
    coinDecimalsB,
    coinTypeA,
    coinTypeB,
    amountA,
    amountB,
    slippage,
    publicKey,
  }: {
    tickSpacing: number;
    coinTypeA: string;
    coinTypeB: string;
    coinDecimalsA: number;
    coinDecimalsB: number;
    amountA: string;
    amountB: string;
    slippage: number;
    publicKey: string;
  }): Promise<TransactionBlock> {
    const fee = await this.getFeeObject(tickSpacing);

    const rawAmountA = new BigNumber(amountA).multipliedBy(10 ** coinDecimalsA).toFixed();
    const rawAmountB = new BigNumber(amountB).multipliedBy(10 ** coinDecimalsB).toFixed();

    const price = new BigNumber(rawAmountB).div(rawAmountA).toString();
    const sqrtPrice = this.turbosSdk.math.priceToSqrtPriceX64(price, coinDecimalsA, coinDecimalsB).toString();
    const { tickLower, tickUpper } = this.getGlobalLiquidityTicks(tickSpacing);

    const createPoolTransaction = await this.turbosSdk.pool.createPool({
      address: publicKey,
      coinTypeA,
      coinTypeB,
      fee,
      amountA: rawAmountA,
      amountB: rawAmountB,
      slippage,
      sqrtPrice,
      tickLower,
      tickUpper,
    });

    createPoolTransaction.setGasBudget(TurbosSingleton.CREATE_POOL_GAS_BUDGET);

    return createPoolTransaction;
  }

  /**
   * Retrieves the fee object for the specified tick spacing.
   *
   * @param {number} tickSpacing - The tick spacing value.
   * @return {Promise<Contract.Fee>} A promise that resolves to the fee object.
   * @throws {Error} If the fee for the specified tick spacing is undefined.
   */
  public async getFeeObject(tickSpacing: number): Promise<Contract.Fee> {
    const fees = await this.getFees();
    const fee = fees.find((feeObject) => feeObject.tickSpacing === tickSpacing);

    if (fee === undefined) {
      throw new Error(`[TurbosSingleton.getFeeObject] Fee for tick spacing ${tickSpacing} is undefined.`);
    }

    return fee;
  }

  /**
   * Retrieves the fees associated with the contract.
   *
   * @return {Promise<Contract.Fee[]>} A promise that resolves to an array of fee objects.
   */
  public async getFees(): Promise<Contract.Fee[]> {
    return await this.turbosSdk.contract.getFees();
  }

  /**
   * Retrieves the global liquidity tick range for the specified tick spacing.
   *
   * @param {number} tickSpacing - The tick spacing value.
   * @return {{ tickLower: number, tickUpper: number }} An object containing the lower and upper bounds
   * of the tick range.
   */
  public getGlobalLiquidityTicks(tickSpacing: number): { tickLower: number; tickUpper: number } {
    /**
     * This is a constant, derived from the maximum range representable by the Q32.62 fixed-point number format.
     * It is used to set the global liquidity on all the price range.
     * Ref: https://cetus-1.gitbook.io/cetus-developer-docs/developer/via-sdk/features-available/add-liquidity
     */
    const maxTickIndex = 443636;

    const tickLower = -maxTickIndex + (maxTickIndex % tickSpacing);
    const tickUpper = maxTickIndex - (maxTickIndex % tickSpacing);

    return { tickLower, tickUpper };
  }

  /**
   * Retrieves all the pools and finds specified one by its parameters.
   *
   * @param {Object} params - Parameters for finding the pool.
   * @param {string} params.coinTypeA - The type of the first coin in the pool.
   * @param {string} params.coinTypeB - The type of the second coin in the pool.
   * @param {string} params.tickSpacing - The tick spacing of the pool.
   * @return {Promise<PoolData | undefined>} A promise that resolves to the pool data matching
   * the specified parameters, or `undefined` if no matching pool is found.
   */
  public async getPoolByParams({
    coinTypeA,
    coinTypeB,
    tickSpacing,
  }: {
    coinTypeA: string;
    coinTypeB: string;
    tickSpacing: string;
  }): Promise<PoolData | undefined> {
    const fetchedPools = await this.fetchPoolsFromApi();

    const foundPool = fetchedPools.find(
      (pool) =>
        pool.tick_spacing === tickSpacing &&
        ((pool.coin_type_a === coinTypeA && pool.coin_type_b === coinTypeB) ||
          (pool.coin_type_a === coinTypeB && pool.coin_type_b === coinTypeA)),
    );

    return foundPool;
  }

  /**
   * Retrieves the create pool events from the provided user events.
   *
   * @param {SuiEvent[]} userEvents - An array of user events.
   * @return {Promise<SuiEvent[]>} A promise that resolves to an array of create pool events.
   */
  public async getCreatePoolEventsFromUserEvents(userEvents: SuiEvent[]): Promise<SuiEvent[]> {
    const contract = await this.turbosSdk.contract.getConfig();
    const cetusCreatePoolEvent = `${contract.PackageIdOriginal}::pool_factory::PoolCreatedEvent`;

    return userEvents.filter((event) => event.type === cetusCreatePoolEvent);
  }

  /**
   * Retrieves the pools owned by a specific user.
   *
   * @description
   * This method returns information about pools owned by a user, including the amounts of two
   * different coins (`amountA` and `amountB`).
   * The decimal precision of these amounts may vary depending on the availability of coin information.
   * - If `getCoinByType2` returns valid decimal information for both coins, the amounts are adjusted accordingly.
   * - If `getCoinByType2` returns null for either coin, the amounts are provided without decimal adjustment.
   *
   * To handle the potential discrepancy in decimal precision from the client-side,
   * two additional parameters are introduced:
   * - `amountAIsRaw`: A boolean indicating whether the returned `amountA` respects decimals (false) or is raw (true).
   * - `amountBIsRaw`: A boolean indicating whether the returned `amountB` respects decimals (false) or is raw (true).
   *
   * It is recommended for the client to check these flags and adjust their processing logic accordingly.
   *
   * If either `amountAIsRaw` or `amountBIsRaw` is true, the corresponding
   * amount should be used as-is without further decimal adjustments.
   * If both flags are false, the amounts can be safely used after decimal adjustments.
   *
   * @public
   * @param {SuiClient} options.provider - The provider for accessing the SUI client.
   * @param {string} options.publicKey - The public key of the user whose pools are to be retrieved.
   * @param {CoinManagerSingleton} options.coinManager - The CoinManagerSingleton instance for managing
   * coin-related operations.
   * @return {Promise<CetusOwnedPool[]>} A promise that resolves to an array of owned pools.
   */
  public async getOwnedPools({
    provider,
    publicKey,
    coinManager,
  }: {
    provider: SuiClient;
    publicKey: string;
    coinManager: CoinManagerSingleton;
  }): Promise<TurbosOwnedPool[]> {
    const poolIds = await this.getUserPoolIds(publicKey, provider);

    if (poolIds.length === 0) {
      return [];
    }

    const userPools = await Promise.all(poolIds.map((poolId) => this.turbosSdk.pool.getPool(poolId)));

    // We need `Promise.all` here to fetch coin metadata to calculate `amountA` and `amountB` respecting decimals
    // in `getCoinsDataForPool()`
    return await Promise.all(
      userPools.map(async (poolData) => {
        // `poolData.types` is an array with 3 elements: first 2 — coin types, 3rd — fee type.
        const [coinTypeA, coinTypeB] = poolData.types;
        const { coin_a: rawCoinAmountA, coin_b: rawCoinAmountB, fee, tick_spacing: tickSpacing } = poolData;

        const { amountA, amountAIsRaw, amountB, amountBIsRaw, coinSymbolA, coinSymbolB, poolName, feePercentage } =
          await getCoinsDataForPool({ coinManager, coinTypeA, coinTypeB, rawCoinAmountA, rawCoinAmountB, fee });

        return {
          poolName,
          poolId: poolData.id.id,
          coinTypeA,
          coinTypeB,
          coinSymbolA,
          coinSymbolB,
          amountA,
          amountB,
          tickSpacing,
          feePercentage,
          amountAIsRaw,
          amountBIsRaw,
        };
      }),
    );
  }

  /**
   * Retrieves detailed information about pools based on their IDs.
   *
   * @param {string[]} poolIds - An array of pool IDs.
   * @return {Promise<DetailedTurbosOwnedPoolInfo[]>} A promise that resolves to an array of detailed pool information.
   */
  public async getDetailedPoolsInfo({
    provider,
    publicKey,
    coinManager,
  }: {
    provider: SuiClient;
    publicKey: string;
    coinManager: CoinManagerSingleton;
  }): Promise<DetailedTurbosOwnedPoolInfo[]> {
    const poolIds = await this.getUserPoolIds(publicKey, provider);

    if (poolIds.length === 0) {
      return [];
    }

    const allPools = await this.fetchPoolsFromApi();
    const userPools = allPools.filter((pool) => poolIds.includes(pool.pool_id));

    // We need `Promise.all` here to fetch coin metadata to calculate `amountA` and `amountB` respecting decimals
    // in `getCoinsDataForPool()`
    return await Promise.all(
      userPools.map(async (poolData) => {
        const {
          coin_type_a: coinTypeA,
          coin_type_b: coinTypeB,
          coin_symbol_a: coinSymbolA,
          coin_symbol_b: coinSymbolB,
          coin_a: rawCoinAmountA,
          coin_b: rawCoinAmountB,
          fee,
          tick_spacing: tickSpacing,
        } = poolData;

        const { amountA, amountAIsRaw, amountB, amountBIsRaw, poolName, feePercentage } = await getCoinsDataForPool({
          coinManager,
          coinTypeA,
          coinTypeB,
          rawCoinAmountA,
          rawCoinAmountB,
          fee: +fee,
        });

        return {
          poolName,
          poolId: poolData.pool_id,
          coinTypeA,
          coinTypeB,
          coinSymbolA,
          coinSymbolB,
          amountA,
          amountB,
          tickSpacing: +tickSpacing,
          feePercentage,
          amountAIsRaw,
          amountBIsRaw,
          apr: poolData.apr,
          aprPercent: poolData.apr_percent,
          feeApr: poolData.fee_apr,
          rewardApr: poolData.reward_apr,
          volumeFor24hUsd: poolData.volume_24h_usd,
          liquidityUsd: poolData.liquidity_usd,
          coinLiquidityUsdA: poolData.coin_a_liquidity_usd,
          coinLiquidityUsdB: poolData.coin_b_liquidity_usd,
          feeFor24hUsd: poolData.fee_24h_usd,
        };
      }),
    );
  }

  /**
   * Retrieves pool IDs associated with a specific user.
   *
   * @param {string} publicKey - The public key of the user.
   * @param {SuiClient} provider - The SuiClient provider.
   * @return {Promise<string[]>} A promise that resolves to an array of pool IDs.
   */
  public async getUserPoolIds(publicKey: string, provider: SuiClient): Promise<string[]> {
    const allEvents = await getAllUserEvents(provider, publicKey);

    const createTurbosPoolEvents = await this.getCreatePoolEventsFromUserEvents(allEvents);
    const poolIds: string[] = createTurbosPoolEvents
      .filter((event) => isTurbosCreatePoolEventParsedJson(event.parsedJson))
      // The false case must not occur since events not meeting the criteria have been filtered out above.
      // This conditional statement primarily serves TypeScript type-checking purposes.
      .map((event) => (isTurbosCreatePoolEventParsedJson(event.parsedJson) ? event.parsedJson.pool : ""));

    return poolIds;
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
