import CetusClmmSDK, {
  AddLiquidityFixTokenParams,
  AggregatorResult,
  ClmmPoolUtil,
  PathLink,
  Pool,
  SdkOptions,
  TickMath,
  TransactionUtil,
  d,
  isSortedSymbols,
} from "@cetusprotocol/cetus-sui-clmm-sdk";
import { EventId, PaginatedEvents, SuiClient, SuiEvent } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { normalizeSuiAddress } from "@mysten/sui.js/utils";
import BigNumber from "bignumber.js";
import BN from "bn.js";
import { EventEmitter } from "../../emitters/EventEmitter";
import { NoRoutesError } from "../../errors/NoRoutesError";
import { CoinManagerSingleton } from "../../managers/CoinManager";
import { CommonCoinData, ProvidersToRouteDataMap, UpdatedCoinsCache } from "../../managers/types";
import { InMemoryStorageSingleton } from "../../storages/InMemoryStorage";
import { Storage } from "../../storages/types";
import { getCetusPathsCache } from "../../storages/utils/getCetusPathsCache";
import { getCoinsCache } from "../../storages/utils/getCoinsCache";
import { storeCaches } from "../../storages/utils/storeCaches";
import { storeCetusPathsCache } from "../../storages/utils/storeCetusPathsCache";
import { LONG_SUI_COIN_TYPE, MAX_BATCH_EVENTS_PER_QUERY_EVENTS_REQUEST, exitHandlerWrapper } from "../common";
import { CacheOptions, CoinsCache, IPoolProvider } from "../types";
import { convertSlippage } from "../utils/convertSlippage";
import { getCoinInfoFromCache } from "../utils/getCoinInfoFromCache";
import { isSuiCoinType } from "../utils/isSuiCoinType";
import { removeDecimalPart } from "../utils/removeDecimalPart";
import { CENTRALIZED_POOLS_INFO_ENDPOINT } from "./config";
import { CetusOptions, CetusOwnedPool, CoinMap, CoinNodeWithSymbol, LPList } from "./types";
import {
  getCoinMapFromCoinsCache,
  getCoinsAndPathsCachesFromMaps,
  getMockedAssets,
  getPoolsDataFromApiData,
  isApiResponseValid,
  isCetusCreatePoolEventParsedJson,
} from "./utils";
import { buildDcaTxBlock } from "../../managers/dca/adapters/cetusAdapter";
import { fetchBestRoute } from "./forked";

/**
 * @class CetusSingleton
 * @extends EventEmitter
 * @implements {IPoolProvider<CetusSingleton>}
 * @description Singleton class for Cetus.
 *
 * Note: If using `lazyLoading: true` with any storage configuration in a serverless/cloud functions environment,
 * be aware that each invocation of your cloud function will start cache population from scratch.
 * This may lead to unexpected behavior when using different SDK methods. To avoid this and minimize the time
 * for cache population, consider using `lazyLoading: false` along with passing a persistent
 * storage adapter (external, e.g., Redis or any kind of DB) to the ProviderSingleton.
 */
export class CetusSingleton extends EventEmitter implements IPoolProvider<CetusSingleton> {
  private static _instance: CetusSingleton | undefined;
  public providerName = "Cetus";
  public isSmartRoutingAvailable = true;
  public cetusSdk: CetusClmmSDK;

  public poolsCache: LPList[] = [];
  public pathsCache: Map<string, PathLink> = new Map();
  public coinsCache: CoinsCache = new Map();
  // The `cetusCoinsCache` is workaround property to make it compatible with the Cetus SDK interface
  private cetusCoinsCache: CoinMap = new Map();
  private cacheOptions: CacheOptions;
  private useOnChainFallback = false;
  private intervalId: NodeJS.Timeout | undefined;
  private proxy: string | undefined;
  private storage: Storage;
  private cetusSDKConfig: SdkOptions;

  /**
   * @constructor
   * @param {Omit<CetusOptions, "lazyLoading">} options - The options for CetusSingleton.
   */
  private constructor(options: Omit<CetusOptions, "lazyLoading">) {
    super();
    this.cetusSDKConfig = {
      fullRpcUrl: options.suiProviderUrl,
      simulationAccount: { address: options.simulationAccount || "" },
      ...options.sdkOptions,
    };
    this.cetusSdk = new CetusClmmSDK(this.cetusSDKConfig);

    const { updateIntervally = true, ...restCacheOptions } = options.cacheOptions;
    this.cacheOptions = { updateIntervally, ...restCacheOptions };
    this.proxy = options.proxy;
    this.storage = options.cacheOptions.storage ?? InMemoryStorageSingleton.getInstance();
  }

  /**
   * @public
   * @method getInstance
   * @description Gets the singleton instance of CetusSingleton.
   * @param {CetusOptions} [options] - Options for CetusSingleton.
   * @return {Promise<CetusSingleton>} The singleton instance of CetusSingleton.
   */
  public static async getInstance(options?: CetusOptions): Promise<CetusSingleton> {
    if (!CetusSingleton._instance) {
      if (options === undefined) {
        throw new Error("[Cetus] Options are required in arguments to create instance.");
      }

      const { sdkOptions, cacheOptions, lazyLoading = true, suiProviderUrl, proxy, simulationAccount } = options;

      const instance = new CetusSingleton({ sdkOptions, cacheOptions, suiProviderUrl, proxy, simulationAccount });
      lazyLoading ? instance.init() : await instance.init();
      CetusSingleton._instance = instance;
    }

    return CetusSingleton._instance;
  }

  /**
   * @private
   * @method init
   * @description Initializes the CetusSingleton instance.
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
      const coinsCache = await getCoinsCache({
        storage: this.storage,
        provider: this.providerName,
        updateCacheInterval: this.cacheOptions.updateIntervalInMs,
      });
      const pathsCache = await getCetusPathsCache({
        storage: this.storage,
        provider: this.providerName,
        updateCacheInterval: this.cacheOptions.updateIntervalInMs,
      });

      this.coinsCache = coinsCache;
      this.pathsCache = pathsCache;

      const coinMap = getCoinMapFromCoinsCache(this.coinsCache);
      this.cetusCoinsCache = coinMap;
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
    const isCacheEmpty = this.coinsCache.size === 0 || this.pathsCache.size === 0;

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
        this.updatePathsAndCoinsCache();
        this.useOnChainFallback && this.updateGraph();
        this.emit("cachesUpdate", this.getCoins());

        await storeCaches({
          provider: this.providerName,
          storage: this.storage,
          coinsCache: this.getCoins(),
        });

        await storeCetusPathsCache({ provider: this.providerName, pathsCache: this.getPaths(), storage: this.storage });

        console.debug("[Cetus] Caches are updated and stored.");
      } catch (error) {
        console.error("[Cetus] Caches update failed:", error);
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
  private async updatePoolsCache(): Promise<void> {
    this.poolsCache = await this.retrieveAllPoolsFromApi();
  }

  /**
   * @private
   * @method updatePathsAndCoinsCache
   * @description Updates the paths and coins cache.
   * @return {void}
   */
  private updatePathsAndCoinsCache(): void {
    const { poolMap, coinMap } = getPoolsDataFromApiData({ poolsInfo: this.poolsCache });
    this.pathsCache = poolMap;
    this.cetusCoinsCache = coinMap;

    const { coinsCache } = getCoinsAndPathsCachesFromMaps({ coins: coinMap, paths: poolMap });
    this.coinsCache = coinsCache;
  }

  /**
   * Updates the graph used by Cetus for routing.
   * If no SDK is provided, it defaults to the current Cetus SDK instance.
   * @param {CetusClmmSDK} [cetusSdk=this.cetusSdk] - The Cetus SDK instance used to update the graph.
   * @return {void}
   */
  public updateGraph(cetusSdk: CetusClmmSDK = this.cetusSdk): void {
    const coins: CoinNodeWithSymbol[] = Array.from(this.cetusCoinsCache.values());
    const paths: PathLink[] = Array.from(this.pathsCache.values());

    const coinsProvider = { coins };
    const pathsProvider = { paths };
    cetusSdk.Router.loadGraph(coinsProvider, pathsProvider);
  }

  /**
   * @private
   * @method retrievelAllPools
   * @description Retrieves all pools.
   * @return {Promise<any>} A Promise that resolves to the retrieved pools.
   */
  private async retrievelAllPools() {
    const pools = await this.cetusSdk.Pool.getPoolsWithPage([]);
    console.log(`[retrievelAllPools] pool length: ${pools.length}`);

    return pools;
  }

  /**
   * @private
   * @method retrieveAllPoolsFromApi
   * @description Retrieves all pools from the API.
   * @return {Promise<any>} A Promise that resolves to the retrieved pools.
   */
  private async retrieveAllPoolsFromApi() {
    const url: string = this.proxy
      ? `${this.proxy}/${CENTRALIZED_POOLS_INFO_ENDPOINT}`
      : CENTRALIZED_POOLS_INFO_ENDPOINT;

    const poolsResponse = await (await fetch(url)).json();
    const isValidPoolsResponse = isApiResponseValid(poolsResponse);

    if (!isValidPoolsResponse) {
      console.error("[Cetus] Pools response:", poolsResponse);
      throw new Error("Pools response from API is not valid");
    }

    return poolsResponse.data.lp_list;
  }

  /**
   * @public
   * @method getCoins
   * @description Gets the updated coins cache.
   * @return {UpdatedCoinsCache} Updated coins cache.
   */
  public getCoins(): UpdatedCoinsCache {
    const allCoins: CommonCoinData[] = Array.from(this.coinsCache.values());
    return { provider: this.providerName, data: allCoins };
  }

  /**
   * @public
   * @method getPaths
   * @description Gets the paths cache.
   * @return {Map<string, PathLink>} Paths cache.
   */
  public getPaths(): Map<string, PathLink> {
    return this.pathsCache;
  }

  /**
   * @public
   * @method getRouteData
   * @description Gets route data.
   * @param {Object} params - Parameters for route data.
   * @param {string} params.coinTypeFrom - Coin type from.
   * @param {string} params.coinTypeTo - Coin type to.
   * @param {string} params.inputAmount - Input amount.
   * @param {number} params.slippagePercentage - Slippage percentage.
   * @param {string} params.publicKey - Public key.
   * @return {Promise<{ outputAmount: bigint, route: RouterCompleteTradeRoute }>} Route data.
   */
  public async getRouteData({
    coinTypeFrom,
    coinTypeTo,
    inputAmount,
    slippagePercentage = 10,
  }: {
    coinTypeFrom: string;
    coinTypeTo: string;
    inputAmount: string;
    slippagePercentage: number;
    publicKey: string;
  }) {
    const coinFrom: CommonCoinData | undefined = getCoinInfoFromCache(coinTypeFrom, this.coinsCache);
    const coinTo: CommonCoinData | undefined = getCoinInfoFromCache(coinTypeTo, this.coinsCache);

    if (coinFrom === undefined) {
      throw new Error(`[Cetus] Cannot find coin with address "${coinTypeFrom}".`);
    } else if (coinTo === undefined) {
      throw new Error(`[Cetus] Cannot find coin with address "${coinTypeTo}".`);
    }

    const { outputAmount, route } = await this.getSmartOutputAmountData({
      amountIn: inputAmount,
      tokenFrom: coinFrom,
      tokenTo: coinTo,
      slippagePercentage,
    });

    return { outputAmount, route };
  }

  /**
   * @private
   * @method getSmartOutputAmountData
   * @description Retrieves smart output amount data for the given coin types and input amount.
   * @param {Object} params - Parameters for smart output amount data.
   * @param {string} params.amountIn - The input amount.
   * @param {CoinNode} params.tokenFrom - The token from object.
   * @param {CoinNode} params.tokenTo - The token to object.
   * @param {number} params.slippagePercentage - The slippage percentage.
   * @param {CetusClmmSDK} [params.cetusSdk=this.cetusSdk] - The Cetus SDK instance (optional,
   * defaults to the current Cetus SDK instance).
   * @return {Promise<SmartOutputAmountData>} A Promise that resolves to smart output amount data.
   */
  private async getSmartOutputAmountData({
    amountIn,
    tokenFrom,
    tokenTo,
    slippagePercentage,
    cetusSdk = this.cetusSdk,
    useOnChainFallback = false,
  }: {
    amountIn: string;
    tokenFrom: CommonCoinData;
    tokenTo: CommonCoinData;
    slippagePercentage: number;
    cetusSdk?: CetusClmmSDK;
    useOnChainFallback?: boolean;
  }) {
    const absoluteSlippage = convertSlippage(slippagePercentage);

    const amountInWithDecimalsBigNumber = new BigNumber(amountIn).multipliedBy(10 ** tokenFrom.decimals);
    // We do removing the decimal part in case client send number with more decimal part
    // than this particular token has decimal places allowed (`inputCoinDecimals`)
    // That's prevent situation when casting
    // BigNumber to BigInt fails with error ("Cannot convert 183763562.1 to a BigInt")
    const inputAmountWithoutExceededDecimalPart = removeDecimalPart(amountInWithDecimalsBigNumber);
    const amountInt = inputAmountWithoutExceededDecimalPart.toNumber();
    const byAmountIn = true;

    let routerResult;
    if (useOnChainFallback) {
      const rawRouterResult = await cetusSdk.RouterV2.getBestRouter(
        tokenFrom.type,
        tokenTo.type,
        amountInt,
        byAmountIn,
        absoluteSlippage,
        "",
      );

      routerResult = rawRouterResult.result;
    } else {
      routerResult = await fetchBestRoute({
        amount: amountInt.toString(),
        byAmountIn,
        coinTypeFrom: tokenFrom.type,
        coinTypeTo: tokenTo.type,
        config: { apiUrl: this.cetusSDKConfig.aggregatorUrl },
      });
    }

    return { outputAmount: BigInt(routerResult.outputAmount), route: routerResult };
  }

  /**
   * @public
   * @method getSwapTransaction
   * @description Retrieves the swap transaction for the given route and public key.
   * @param {Object} params - Parameters for the swap transaction.
   * @param {AggregatorResult} params.route - The route object.
   * @param {string} params.publicKey - The public key.
   * @param {number} params.slippagePercentage - The slippage percentage.
   * @return {Promise<any>} A Promise that resolves to the swap transaction payload.
   */
  public async getSwapTransaction({
    route,
    publicKey,
    slippagePercentage,
  }: {
    route: AggregatorResult;
    publicKey: string;
    slippagePercentage: number;
  }) {
    const absoluteSlippage = convertSlippage(slippagePercentage);
    // If find the best swap router, then send transaction.
    const allCoinAsset = await this.cetusSdk.getOwnerCoinAssets(publicKey);
    // If recipient not set, transfer objects move call will use ctx sender.
    const payload = await TransactionUtil.buildAggregatorSwapTransaction(
      this.cetusSdk,
      route,
      allCoinAsset,
      "",
      absoluteSlippage,
      publicKey,
    );

    return payload;
  }

  /**
   * @public
   * @method getSwapTransaction
   * @description Retrieves the swap transaction for the given route and public key.
   * @param {Object} params - Parameters for the swap transaction.
   * @param {AggregatorResult} params.route - The route object.
   * @param {string} params.publicKey - The public key.
   * @param {number} params.slippagePercentage - The slippage percentage.
   * @return {Promise<any>} A Promise that resolves to the swap transaction payload.
   */
  public async getSwapTransactionDoctored({
    route,
    publicKey,
    slippagePercentage,
  }: {
    route: AggregatorResult;
    publicKey: string;
    slippagePercentage: number;
  }) {
    // TODO: Check that `route.fromCoin` and `route.toCoin` remains always the same as in initial inputs provided
    // In case if not, extend `route` prop to include initial params of coins to that type
    const mockedAssets = getMockedAssets(route.fromCoin, route.toCoin);

    const absoluteSlippage = convertSlippage(slippagePercentage);
    // If find the best swap router, then send transaction.
    console.debug("txSignerPubkey: ", publicKey);
    // If recipient not set, transfer objects move call will use ctx sender.
    const payload = await TransactionUtil.buildAggregatorSwapTransaction(
      this.cetusSdk,
      route,
      mockedAssets,
      "",
      absoluteSlippage,
      publicKey,
    );

    return payload;
  }

  /**
   * Generates a transaction for creating a new liquidity pool.
   *
   * @public
   * @param {Object} params - Parameters for creating the pool transaction.
   * @param {string} params.coinTypeA - The type of the first coin in the pool.
   * @param {string} params.coinTypeB - The type of the second coin in the pool.
   * @param {number} params.decimalsA - The number of decimals for the first coin.
   * @param {number} params.decimalsB - The number of decimals for the second coin.
   * @param {string} params.price - The price of coinB in terms of coinA (how much coinB is needed to buy 1 coinA).
   * @param {number} params.tickSpacing - The tick spacing of the pool.
   * @param {string} params.uri - The URI of the pool icon.
   * @return {Promise<TransactionBlock>} A promise that resolves to the transaction block for creating the pool.
   */
  public async getCreatePoolTransaction({
    coinTypeA,
    coinTypeB,
    decimalsA,
    decimalsB,
    price,
    tickSpacing,
    uri = "",
  }: {
    coinTypeA: string;
    coinTypeB: string;
    decimalsA: number;
    decimalsB: number;
    price: string;
    tickSpacing: number;
    uri?: string;
  }): Promise<TransactionBlock> {
    const swapParams: boolean = isSortedSymbols(normalizeSuiAddress(coinTypeA), normalizeSuiAddress(coinTypeB));
    const resultCoinTypeA = swapParams ? coinTypeB : coinTypeA;
    const resultCoinTypeB = swapParams ? coinTypeA : coinTypeB;
    const resultDecimalsA = swapParams ? decimalsB : decimalsA;
    const resultDecimalsB = swapParams ? decimalsA : decimalsB;
    const resultPrice = swapParams ? new BigNumber(1).dividedBy(price).toString() : price;

    const initializeSqrtPrice = TickMath.priceToSqrtPriceX64(
      d(resultPrice),
      resultDecimalsA,
      resultDecimalsB,
    ).toString();

    const createPoolTransaction = await this.cetusSdk.Pool.creatPoolTransactionPayload({
      coinTypeA: resultCoinTypeA,
      coinTypeB: resultCoinTypeB,
      tick_spacing: tickSpacing,
      initialize_sqrt_price: initializeSqrtPrice,
      uri,
    });

    return createPoolTransaction;
  }

  /**
   * Retrieves the payload for adding liquidity to a pool along with additional information.
   *
   * @description
   * The current implementation opens a position near the current price of the pool, potentially resulting
   * in a larger `amountB` than expected. This behavior may lead to an extended liquidity range.
   * Clients are advised to consider the following:
   * - Allowing users to specify a price range for providing liquidity.
   * - Exploring the option of implementing global liquidity adjustments.
   * For more details, please refer to the Cetus development documentation.
   *
   * @public
   * @param {Object} options - Parameters for generating the add liquidity payload.
   * @param {Pool} options.pool - The pool to which liquidity will be added.
   * @param {string} options.coinAmountA - The amount of coinA to add to the liquidity pool.
   * @param {number} options.decimalsA - The number of decimals for coinA.
   * @param {number} options.decimalsB - The number of decimals for coinB.
   * @param {number} options.slippage - The acceptable slippage percentage for the transaction.
   * @return {Object} An object containing the add liquidity payload, amount of coinB, and current square root price.
   */
  public getAddLiquidityPayload({
    pool,
    coinAmountA,
    decimalsA,
    decimalsB,
    slippage,
  }: {
    pool: Pool;
    coinAmountA: string;
    decimalsA: number;
    decimalsB: number;
    slippage: number;
  }): { addLiquidityPayload: AddLiquidityFixTokenParams; amountB: string; curSqrtPrice: BN } {
    // TODO: The current implementation opens a position near the current price of the pool,
    // resulting in a potentially large `amountB`. This behavior may lead to unexpected liquidity range.
    // Possible solutions:
    // 1. Allow users to specify a price range for providing liquidity.
    // 2. Consider implementing global liquidity adjustments.
    // For more details, refer to the Cetus development documentation.
    const lowerTick = TickMath.getPrevInitializableTickIndex(
      new BN(pool.current_tick_index).toNumber(),
      new BN(pool.tickSpacing).toNumber(),
    );
    const upperTick = TickMath.getNextInitializableTickIndex(
      new BN(pool.current_tick_index).toNumber(),
      new BN(pool.tickSpacing).toNumber(),
    );
    const rawAmount = new BigNumber(coinAmountA).multipliedBy(10 ** decimalsA).toString();
    const rawAmountBN = new BN(rawAmount);
    const fixAmountA = true;
    const curSqrtPrice = new BN(pool.current_sqrt_price);
    const liquidityInput = ClmmPoolUtil.estLiquidityAndcoinAmountFromOneAmounts(
      lowerTick,
      upperTick,
      rawAmountBN,
      fixAmountA,
      true,
      slippage,
      curSqrtPrice,
    );

    const amountA = fixAmountA ? rawAmountBN.toNumber() : liquidityInput.tokenMaxA.toNumber();
    const amountB = fixAmountA ? liquidityInput.tokenMaxB.toNumber() : rawAmountBN.toNumber();
    const normalizedAmountB = new BigNumber(amountB).dividedBy(10 ** decimalsB).toString();

    const addLiquidityPayloadParams: AddLiquidityFixTokenParams = {
      coinTypeA: pool.coinTypeA,
      coinTypeB: pool.coinTypeB,
      pool_id: pool.poolAddress,
      tick_lower: lowerTick.toString(),
      tick_upper: upperTick.toString(),
      fix_amount_a: fixAmountA,
      amount_a: amountA,
      amount_b: amountB,
      slippage,
      // true means that it's the first liquidity add, so need to open one position
      is_open: true,
      // If these not empty, it will collect rewarder in this position, if client already open the position
      rewarder_coin_types: [],
      // If client already has one position, he can collect fees while adding liquidity
      collect_fee: false,
      // The position object id
      pos_id: "",
    };

    return { addLiquidityPayload: addLiquidityPayloadParams, amountB: normalizedAmountB, curSqrtPrice };
  }

  /**
   * Generates a transaction for adding liquidity to a pool.
   *
   * @public
   * @param {Object} params - Parameters for adding liquidity to the pool transaction.
   * @param {Pool} params.pool - The liquidity pool to which liquidity will be added.
   * @param {string} params.coinAmountA - The amount of coinA to add to the liquidity pool.
   * @param {number} params.decimalsA - The number of decimals for coinA.
   * @param {number} params.decimalsB - The number of decimals for coinB.
   * @param {number} params.slippage - The acceptable slippage percentage for the transaction.
   * @param {string} params.publicKey - The public key of the transaction sender.
   * @return {Promise<{ transaction: TransactionBlock, amountB: string }>} A promise that resolves to an object
   * containing the transaction block for adding liquidity and the amount of coinB.
   */
  public async getAddLiquidityTransaction({
    pool,
    coinAmountA,
    decimalsA,
    decimalsB,
    slippage,
    publicKey,
  }: {
    pool: Pool;
    coinAmountA: string;
    decimalsA: number;
    decimalsB: number;
    slippage: number;
    publicKey: string;
  }): Promise<TransactionBlock> {
    this.cetusSdk.senderAddress = publicKey;

    const { addLiquidityPayload, curSqrtPrice } = this.getAddLiquidityPayload({
      pool,
      coinAmountA,
      decimalsA,
      decimalsB,
      slippage,
    });

    const addLiquidityTransaction = await this.cetusSdk.Position.createAddLiquidityFixTokenPayload(
      addLiquidityPayload,
      {
        slippage,
        curSqrtPrice,
      },
    );

    return addLiquidityTransaction;
  }

  /**
   * Retrieves pool data for the specified pool ID.
   *
   * @public
   * @param {string} poolId - The ID of the pool to retrieve.
   * @return {Promise<Pool | null>} A promise that resolves to the pool data or null if no data is found.
   */
  public async getPool(poolId: string): Promise<Pool | null> {
    try {
      return await this.cetusSdk.Pool.getPool(poolId);
    } catch (error) {
      console.error("[Cetus.getPool] error occured:", error);
      return null;
    }
  }

  /**
   * Retrieves pools data for the specified pool IDs.
   *
   * @public
   * @param {string[]} poolIds - The IDs of the pools to retrieve.
   * @return {Promise<Pool | null>} A promise that resolves to the pools data or null if no data is found
   * or error occured.
   */
  public async getPools(poolIds: string[]): Promise<Pool[] | null> {
    try {
      return await this.cetusSdk.Pool.getPools(poolIds);
    } catch (error) {
      console.error("[Cetus.getPools] error occured:", error);
      return null;
    }
  }

  /**
   * Retrieves a liquidity pool by coin types and tick spacing.
   *
   * @public
   * @param {string} coinTypeA - The type of the first coin in the pool.
   * @param {string} coinTypeB - The type of the second coin in the pool.
   * @param {string} tickSpacing - The tick spacing of the pool.
   * @return {Promise<LPList | undefined>} A promise that resolves to the liquidity pool with the specified
   * coin types and tick spacing, or undefined if no pool is found.
   */
  public async getPoolByCoinTypesAndTickSpacing(
    coinTypeA: string,
    coinTypeB: string,
    tickSpacing: string,
  ): Promise<LPList | undefined> {
    const cachedPools = this.poolsCache;
    const foundPool = cachedPools.find((pool) => {
      const processedCoinTypeA = isSuiCoinType(coinTypeA) ? LONG_SUI_COIN_TYPE : coinTypeA;
      const processedCoinTypeB = isSuiCoinType(coinTypeB) ? LONG_SUI_COIN_TYPE : coinTypeB;
      const processedPoolCoinA = isSuiCoinType(pool.coin_a_address) ? LONG_SUI_COIN_TYPE : pool.coin_a_address;
      const processedPoolCoinB = isSuiCoinType(pool.coin_b_address) ? LONG_SUI_COIN_TYPE : pool.coin_b_address;

      const tickSpacingMatch = pool.tick_spacing === tickSpacing;
      const directMatch = processedPoolCoinA === processedCoinTypeA && processedPoolCoinB === processedCoinTypeB;
      const reverseMatch = processedPoolCoinA === processedCoinTypeB && processedPoolCoinB === processedCoinTypeA;

      return tickSpacingMatch && (directMatch || reverseMatch);
    });

    if (foundPool !== undefined) {
      return foundPool;
    }

    const pools = await this.retrieveAllPoolsFromApi();
    return pools.find(
      (pool) =>
        (pool.coin_a_address === coinTypeA || pool.coin_b_address === coinTypeA) &&
        (pool.coin_a_address === coinTypeB || pool.coin_b_address === coinTypeB) &&
        pool.tick_spacing === tickSpacing,
    );
  }

  /**
   * Retrieves CreatePoolEvents from an array of user events.
   *
   * @param {SuiEvent[]} userEvents - Array of user events.
   * @return {SuiEvent[]} Array of CreatePoolEvents filtered from user events.
   */
  public getCreatePoolEventsFromUserEvents(userEvents: SuiEvent[]): SuiEvent[] {
    const cetusCreatePoolEvent = `${this.cetusSDKConfig.clmm_pool.package_id}::factory::CreatePoolEvent`;

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
   * @param {SuiClient} provider - The provider for accessing the SUI client.
   * @param {string} publicKey - The public key of the user whose pools are to be retrieved.
   * @param {CoinManagerSingleton} coinManager - The CoinManagerSingleton instance for managing coin-related operations.
   * @return {Promise<CetusOwnedPool[]>} A promise that resolves to an array of owned pools.
   */
  public async getOwnedPools(
    provider: SuiClient,
    publicKey: string,
    coinManager: CoinManagerSingleton,
  ): Promise<CetusOwnedPool[]> {
    // TODO: Move all common events fetching (`queryEvents`) to a separate util function.
    const pageCapacity = MAX_BATCH_EVENTS_PER_QUERY_EVENTS_REQUEST;
    const allEvents: SuiEvent[] = [];
    let nextCursor: EventId | undefined | null = null;
    let events: PaginatedEvents = await provider.queryEvents({
      query: { Sender: publicKey },
      limit: pageCapacity,
      cursor: nextCursor,
    });

    // Fetching and combining part
    while (events.hasNextPage) {
      const userEvents: SuiEvent[] = events.data;
      allEvents.push(...userEvents);

      nextCursor = events.nextCursor;
      events = await provider.queryEvents({
        query: { Sender: publicKey },
        limit: pageCapacity,
        cursor: nextCursor,
      });
    }

    const userEvents: SuiEvent[] = events.data;
    allEvents.push(...userEvents);

    // Reducing part
    const createPoolEvents: SuiEvent[] = this.getCreatePoolEventsFromUserEvents(allEvents);
    const poolIds: string[] = createPoolEvents
      .filter((event) => isCetusCreatePoolEventParsedJson(event.parsedJson))
      // The false case must not occur since events not meeting the criteria have been filtered out above.
      // This conditional statement primarily serves TypeScript type-checking purposes.
      .map((event) => (isCetusCreatePoolEventParsedJson(event.parsedJson) ? event.parsedJson.pool_id : ""));

    if (poolIds.length === 0) {
      return [];
    }

    const pools: Pool[] | null = await this.getPools(poolIds);

    if (pools === null) {
      return [];
    }

    // We need `Promise.all` here to fetch coin metada to calculate `amountA` and `amountB` respecting decimals
    return await Promise.all(
      pools.map(async (pool) => {
        // eslint-disable-next-line camelcase
        const { name, poolAddress, coinTypeA, coinTypeB, coinAmountA, coinAmountB, fee_rate } = pool;
        // Div by 10_000 because `fee_rate` is 100 in case it's 0.01% at UI, so 0.01 = 100 / 10_000.
        const feeRate = new BigNumber(fee_rate).dividedBy(10_000).toString();

        const poolInCache = this.poolsCache.find((pool) => pool.address === poolAddress);
        let coinADecimals: number;
        let coinBDecimals: number;

        let coinSymbolA: string | undefined = undefined;
        let coinSymbolB: string | undefined = undefined;

        let amountAIsRaw: boolean;
        let amountBIsRaw: boolean;

        if (poolInCache !== undefined) {
          coinADecimals = poolInCache.coin_a.decimals;
          coinBDecimals = poolInCache.coin_b.decimals;

          coinSymbolA = poolInCache.coin_a.symbol;
          coinSymbolB = poolInCache.coin_b.symbol;

          amountAIsRaw = false;
          amountBIsRaw = false;
        } else {
          const coinAInfo = await coinManager.getCoinByType2(coinTypeA);
          const coinBInfo = await coinManager.getCoinByType2(coinTypeB);

          amountAIsRaw = !coinAInfo;
          amountBIsRaw = !coinBInfo;

          coinADecimals = coinAInfo?.decimals ?? 0;
          coinBDecimals = coinBInfo?.decimals ?? 0;

          coinSymbolA = coinAInfo?.symbol;
          coinSymbolB = coinBInfo?.symbol;
        }

        const amountA = new BigNumber(coinAmountA).dividedBy(10 ** coinADecimals).toString();
        const amountB = new BigNumber(coinAmountB).dividedBy(10 ** coinBDecimals).toString();

        return {
          name,
          poolAddress,
          coinTypeA,
          coinTypeB,
          coinSymbolA,
          coinSymbolB,
          amountA,
          amountB,
          feeRate,
          amountAIsRaw,
          amountBIsRaw,
        };
      }),
    );
  }

  /**
   * Creates a new instance of the Cetus SDK with the provided options.
   * If `simulationAccountAddress` is not provided, it will use the simulation account from `this.cetusSDKConfig`.
   * @param {string} [simulationAccountAddress] - The address for simulation account (optional).
   * @return {CetusClmmSDK} A new instance of the Cetus SDK.
   */
  public getNewCetusSdk(simulationAccountAddress?: string) {
    // TODO: We might not need to specify signerAddress here, depends on internal Cetus smart-contract structure
    return new CetusClmmSDK({
      ...this.cetusSDKConfig,
      simulationAccount:
        simulationAccountAddress !== undefined
          ? { address: simulationAccountAddress }
          : this.cetusSDKConfig.simulationAccount,
    });
  }

  /**
   * Checks whether paths exist in the graph between the specified coin types using the provided Cetus SDK instance.
   * If no Cetus SDK instance is provided, the method uses the current Cetus SDK instance of the class.
   * @param {string} coinTypeFrom - The coin type from which the path starts.
   * @param {string} coinTypeTo - The coin type to which the path leads.
   * @param {CetusClmmSDK} [cetusSdk=this.cetusSdk] - The Cetus SDK instance (optional, defaults to the current
   * Cetus SDK instance).
   * @return {boolean} True if paths exist in the graph between the specified coin types, otherwise false.
   */
  public checkPathsExistInGraph(coinTypeFrom: string, coinTypeTo: string, cetusSdk: CetusClmmSDK = this.cetusSdk) {
    const graph = cetusSdk.Router.graph;

    coinTypeFrom = isSuiCoinType(coinTypeFrom) ? LONG_SUI_COIN_TYPE : coinTypeFrom;
    coinTypeTo = isSuiCoinType(coinTypeTo) ? LONG_SUI_COIN_TYPE : coinTypeTo;

    const fromVertex = graph.getVertexByKey(coinTypeFrom);
    const toVertex = graph.getVertexByKey(coinTypeTo);

    const pathIters = graph.findAllPath(fromVertex, toVertex);
    const allPaths = Array.from(pathIters);

    return allPaths.length !== 0;
  }

  /**
   * Retrieves route data using the graph for the specified coin types, input amount, and slippage percentage.
   * @param {Object} params - Parameters for retrieving route data.
   * @param {string} params.coinTypeFrom - The coin type from which the route starts.
   * @param {string} params.coinTypeTo - The coin type to which the route leads.
   * @param {string} params.inputAmount - The input amount for the route.
   * @param {number} [params.slippagePercentage=10] - The slippage percentage for the route (optional, defaults to 10).
   * @return {Promise<void>} A Promise that resolves when the route data is retrieved.
   */
  public async getRouteDataWithGraph({
    coinTypeFrom,
    coinTypeTo,
    inputAmount,
    slippagePercentage = 10,
    publicKey,
  }: {
    coinTypeFrom: string;
    coinTypeTo: string;
    inputAmount: string;
    slippagePercentage: number;
    publicKey: string;
  }) {
    console.debug("Finding Cetus route separately, because all the providers have no route...");

    const routesByProviderMap: ProvidersToRouteDataMap = new Map();
    const providersByOutputAmountsMap: Map<bigint, string> = new Map();

    const sdk = this.getNewCetusSdk(publicKey); // We re-create Cetus sdk to avoid race-conditions
    this.updateGraph(sdk);

    const pathExist = this.checkPathsExistInGraph(coinTypeFrom, coinTypeTo, sdk);

    if (!pathExist) {
      throw new NoRoutesError("[CetusSingleton] There is no paths in Cetus graph.");
    }

    const coinFrom: CommonCoinData | undefined = getCoinInfoFromCache(coinTypeFrom, this.coinsCache);
    const coinTo: CommonCoinData | undefined = getCoinInfoFromCache(coinTypeTo, this.coinsCache);

    if (coinFrom === undefined) {
      throw new Error(`[CetusSingleton.getRouteDataWithGraph] Cannot find coin with address "${coinTypeFrom}".`);
    } else if (coinTo === undefined) {
      throw new Error(`[CetusSingleton.getRouteDataWithGraph] Cannot find coin with address "${coinTypeTo}".`);
    }

    let smartOutputAmountData: Awaited<ReturnType<typeof this.getSmartOutputAmountData>> | null;

    try {
      smartOutputAmountData = await this.getSmartOutputAmountData({
        amountIn: inputAmount,
        tokenFrom: coinFrom,
        tokenTo: coinTo,
        slippagePercentage,
        cetusSdk: sdk,
        useOnChainFallback: true,
      });
    } catch (error) {
      if (error instanceof Error) {
        console.error(
          "[CetusSingleton.getRouteDataWithGraph] Error occured while getSmartOutputAmountData:",
          error.message,
        );
      } else {
        console.error("[CetusSingleton.getRouteDataWithGraph] Error occured while getSmartOutputAmountData:", error);
      }

      smartOutputAmountData = null;
    }

    // In case route is not found or provider throw an error
    if (smartOutputAmountData === null) {
      routesByProviderMap.set(this.providerName, { provider: this, route: null });
      providersByOutputAmountsMap.set(BigInt(0), this.providerName);
    } else {
      // In case route is found
      routesByProviderMap.set(this.providerName, { provider: this, route: smartOutputAmountData.route });
      providersByOutputAmountsMap.set(smartOutputAmountData.outputAmount, this.providerName);
    }

    const cetusOutputAmount: bigint = smartOutputAmountData?.outputAmount ?? BigInt(0);

    if (cetusOutputAmount === BigInt(0)) {
      throw new NoRoutesError("[CetusSingleton.getRouteDataWithGraph] Cetus output amount is 0 too.");
    }

    return { routesByProviderMap, providersByOutputAmountsMap, cetusOutputAmount };
  }

  /**
   * Removes the current instance of CetusSingleton.
   *
   * Disclaimer: While this method in this class is marked as public, it is strongly discouraged
   * to use it directly unless you are certain about the behavior.
   */
  public static removeInstance() {
    CetusSingleton._instance = undefined;
  }

  public buildDcaTxBlockAdapter = buildDcaTxBlock;
}
