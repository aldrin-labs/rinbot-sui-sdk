/* eslint-disable new-cap */
import { SuiTransactionBlockResponse } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { Aftermath, CoinMetadaWithInfo, Pool, RouterCompleteTradeRoute } from "aftermath-ts-sdk";
import BigNumber from "bignumber.js";
import { EventEmitter } from "../../emitters/EventEmitter";
import { CoinManagerSingleton } from "../../managers/CoinManager";
import { CoinAssetData, CommonCoinData, UpdatedCoinsCache } from "../../managers/types";
import { InMemoryStorageSingleton } from "../../storages/InMemoryStorage";
import { Storage } from "../../storages/types";
import { getCoinsAndPathsCaches } from "../../storages/utils/getCoinsAndPathsCaches";
import { storeCaches } from "../../storages/utils/storeCaches";
import { exitHandlerWrapper } from "../common";
import { CacheOptions, CoinsCache, CommonPoolData, IPoolProvider, PathsCache } from "../types";
import { convertSlippage } from "../utils/convertSlippage";
import { getCoinInfoFromCache } from "../utils/getCoinInfoFromCache";
import { removeDecimalPart } from "../utils/removeDecimalPart";
import { getCreatePoolCapIdAndLpCoinType, getPoolObjectIdFromTransactionResult } from "./create-pool-utils";
import {
  AftermathOptions,
  CreateLpCoinInput,
  CreatePoolInput,
  GetWeightsInput,
  OwnedPoolInfo,
  SmartOutputAmountData,
} from "./types";
import {
  getOwnedPoolInfosFromPools,
  getPathMapAndCoinTypesSet,
  isApiResponseValid,
  isCoinMetadaWithInfoApiResponseValid,
} from "./utils";

/**
 * @class AftermathSingleton
 * @extends EventEmitter
 * @implements {IPoolProvider<AftermathSingleton>}
 * @description Singleton class for Aftermath.
 *
 * Note: If using `lazyLoading: true` with any storage configuration in a serverless/cloud functions environment,
 * be aware that each invocation of your cloud function will start cache population from scratch.
 * This may lead to unexpected behavior when using different SDK methods. To avoid this and minimize the time
 * for cache population, consider using `lazyLoading: false` along with passing a persistent
 * storage adapter (external, e.g., Redis or any kind of DB) to the ProviderSingleton.
 */
export class AftermathSingleton extends EventEmitter implements IPoolProvider<AftermathSingleton> {
  private static _instance: AftermathSingleton | undefined;
  public static AFTERMATH_POOL_URL = "https://aftermath.finance/pools";
  public isSmartRoutingAvailable = true;
  public providerName = "Aftermath";
  public aftermathSdk: Aftermath;
  public poolsCache: Pool[] = [];
  public pathsCache: PathsCache = new Map();
  public coinsCache: CoinsCache = new Map();
  private cacheOptions: CacheOptions;
  private intervalId: NodeJS.Timeout | undefined;
  private storage: Storage;

  /**
   * @constructor
   * @param {Omit<AftermathOptions, "lazyLoading">} options - Options for AftermathSingleton.
   */
  private constructor(options: Omit<AftermathOptions, "lazyLoading">) {
    super();
    this.aftermathSdk = new Aftermath("MAINNET");
    const { updateIntervally = true, ...restCacheOptions } = options.cacheOptions;
    this.cacheOptions = { updateIntervally, ...restCacheOptions };
    this.storage = options.cacheOptions.storage ?? InMemoryStorageSingleton.getInstance();
  }

  /**
   * @static
   * @method getInstance
   * @async
   * @param {AftermathOptions} [options] - Options for AftermathSingleton instance.
   * @return {Promise<AftermathSingleton>}
   * @throws Error if options are not provided.
   */
  public static async getInstance(options?: AftermathOptions): Promise<AftermathSingleton> {
    if (!AftermathSingleton._instance) {
      if (options === undefined) {
        throw new Error("[Aftermath] Options are required in arguments to create instance.");
      }

      const { cacheOptions, lazyLoading = true } = options;

      const instance = new AftermathSingleton({ cacheOptions });
      lazyLoading ? instance.init() : await instance.init();
      AftermathSingleton._instance = instance;
    }

    return AftermathSingleton._instance;
  }

  /**
   * @private
   * @method init
   * @description Initializes the AftermathSingleton instance.
   * @return {Promise<void>}
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

      this.coinsCache = coinsCache;
      this.pathsCache = pathsCache;
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
   * @description Updates caches.
   * @return {Promise<void>}
   */
  private async updateCaches({ force }: { force: boolean } = { force: false }): Promise<void> {
    const isCacheEmpty = this.isStorageCacheEmpty();

    if (isCacheEmpty || force) {
      try {
        await this.updatePoolsCache();
        await this.updatePathsAndCoinsCache();
        this.emit("cachesUpdate", this.getCoins());

        await storeCaches({
          provider: this.providerName,
          storage: this.storage,
          coinsCache: this.getCoins(),
          pathsCache: this.getPaths(),
        });

        console.debug("[Aftermath] Caches are updated and stored.");
      } catch (error) {
        console.error("[Aftermath] Caches update failed:", error);
      }
    }
  }

  /**
   * @private
   * @method updateCachesIntervally
   * @description Updates caches periodically.
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
   * @description Updates pools cache.
   * @return {Promise<void>}
   */
  private async updatePoolsCache(): Promise<void> {
    const poolsInstance = this.aftermathSdk.Pools();
    const pools: Pool[] = await poolsInstance.getAllPools();
    const isValidPoolsResponse = isApiResponseValid(pools);

    if (!isValidPoolsResponse) {
      console.error("[Aftermath] Pools response:", pools);
      throw new Error("Pools response from API is not valid");
    }

    this.poolsCache = pools;
  }

  /**
   * @private
   * @method updatePathsAndCoinsCache
   * @description Updates paths and coins cache.
   * @return {Promise<void>}
   */
  private async updatePathsAndCoinsCache(): Promise<void> {
    const { pathMap, coinTypesSet } = getPathMapAndCoinTypesSet(this.poolsCache);
    this.pathsCache = pathMap;

    await Promise.all(
      Array.from(coinTypesSet.values()).map(async (coinType: string) => {
        try {
          const coin = this.aftermathSdk.Coin();
          const metadata: CoinMetadaWithInfo = await coin.getCoinMetadata(coinType);

          const isValidCoinMetadataResponse = isCoinMetadaWithInfoApiResponseValid(metadata);

          if (isValidCoinMetadataResponse) {
            this.coinsCache.set(coinType, { symbol: metadata.symbol, type: coinType, decimals: metadata.decimals });
          }
        } catch (error) {
          console.error(`[Aftermath] Error while fetching metadata about coin ${coinType}:`, error);
        }
      }),
    );
  }

  /**
   * @public
   * @method getPool
   * @description Gets the pool with the specified coin types.
   * @param {string} coinTypeA - Coin type A.
   * @param {string} coinTypeB - Coin type B.
   * @return {Pool} The pool object.
   */
  public getPool(coinTypeA: string, coinTypeB: string): Pool {
    const pool: Pool | undefined = this.poolsCache.find(
      (pool: Pool) =>
        Object.keys(pool.pool.coins).includes(coinTypeA) && Object.keys(pool.pool.coins).includes(coinTypeB),
    );

    if (!pool) {
      throw new Error(`[Aftermath] Cannot find pool with coinTypeA "${coinTypeA}" and coinTypeB "${coinTypeB}".`);
    }

    return pool;
  }

  /**
   * @public
   * @method getPools
   * @description Gets all pools.
   * @return {Pool[]} Array of pools.
   */
  public getPools(): Pool[] {
    return this.poolsCache;
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
   * @return {Map<string, CommonPoolData>} Paths cache.
   */
  public getPaths(): Map<string, CommonPoolData> {
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
   * @return {Promise<{ outputAmount: bigint, route: RouterCompleteTradeRoute }>} Route data.
   */
  public async getRouteData({
    coinTypeFrom,
    coinTypeTo,
    inputAmount,
  }: {
    coinTypeFrom: string;
    coinTypeTo: string;
    inputAmount: string;
    slippagePercentage: number;
    publicKey: string;
  }) {
    const { outputAmount, route } = await this.getSmartOutputAmountData(coinTypeFrom, coinTypeTo, inputAmount);

    return { outputAmount, route };
  }

  /**
   * @public
   * @method getDirectOutputAmount
   * @description Calculates the direct output amount for a given input amount and coin types.
   * @param {Pool} pool - The pool object.
   * @param {string} inputAmount - The input amount.
   * @param {string} coinTypeFrom - The coin type from.
   * @param {string} coinTypeTo - The coin type to.
   * @return {bigint} The direct output amount.
   */
  public getDirectOutputAmount(pool: Pool, inputAmount: string, coinTypeFrom: string, coinTypeTo: string): bigint {
    const coinFromDecimals: number | undefined = pool.pool.coins[coinTypeFrom].decimals;

    if (coinFromDecimals === undefined) {
      throw new Error(`[Aftermath] Coin with type "${coinTypeFrom}" has no decimals.`);
    }

    const coinInAmountBigNumber = new BigNumber(inputAmount).multipliedBy(10 ** coinFromDecimals);
    const coinInAmount = BigInt(coinInAmountBigNumber.toString());
    const outputAmount: bigint = pool.getTradeAmountOut({
      coinInAmount,
      coinInType: coinTypeFrom,
      coinOutType: coinTypeTo,
    });

    return outputAmount;
  }

  /**
   * @private
   * @method getSmartOutputAmountData
   * @description Retrieves smart output amount data for the given coin types and input amount.
   * @param {string} coinTypeFrom - The coin type from.
   * @param {string} coinTypeTo - The coin type to.
   * @param {string} inputAmount - The input amount.
   * @return {Promise<SmartOutputAmountData>} A Promise that resolves to smart output amount data.
   */
  private async getSmartOutputAmountData(
    coinTypeFrom: string,
    coinTypeTo: string,
    inputAmount: string,
  ): Promise<SmartOutputAmountData> {
    const coinTypeFromInfo: CommonCoinData | undefined = getCoinInfoFromCache(coinTypeFrom, this.coinsCache);

    if (coinTypeFromInfo === undefined) {
      throw new Error(`[Aftermath] Cannot find info about coin "${coinTypeFrom}".`);
    }

    const inputCoinDecimals: number = coinTypeFromInfo.decimals;
    const inputAmountWithDecimalsBigNumber = new BigNumber(inputAmount).multipliedBy(10 ** inputCoinDecimals);
    // We do removing the decimal part in case client send number with more decimal part
    // than this particular token has decimal places allowed (`inputCoinDecimals`)
    // That's prevent situation when casting
    // BigNumber to BigInt fails with error ("Cannot convert 183763562.1 to a BigInt")
    const inputAmountWithoutExceededDecimalPart = removeDecimalPart(inputAmountWithDecimalsBigNumber);
    const inputAmountWithDecimals = BigInt(inputAmountWithoutExceededDecimalPart.toString());

    const routerInstance = this.aftermathSdk.Router();
    const route: RouterCompleteTradeRoute = await routerInstance.getCompleteTradeRouteGivenAmountIn({
      coinInType: coinTypeFrom,
      coinOutType: coinTypeTo,
      coinInAmount: inputAmountWithDecimals,
    });

    const smartOutputAmount: bigint = route.coinOut.amount;

    return { outputAmount: smartOutputAmount, route };
  }

  /**
   * @public
   * @method getSwapTransaction
   * @description Retrieves the swap transaction for the given route and public key.
   * @param {RouterCompleteTradeRoute} route - The complete trade route.
   * @param {string} publicKey - The public key.
   * @param {number} [slippagePercentage=10] - The slippage percentage.
   * @return {Promise<TransactionBlock>} A Promise that resolves to the swap transaction.
   */
  public async getSwapTransaction({
    route,
    publicKey,
    slippagePercentage = 10,
  }: {
    route: RouterCompleteTradeRoute;
    publicKey: string;
    slippagePercentage: number;
  }): Promise<TransactionBlock> {
    const absoluteSlippage: number = convertSlippage(slippagePercentage);

    const routerInstance = this.aftermathSdk.Router();
    const modernTxBlock = await routerInstance.getTransactionForCompleteTradeRoute({
      walletAddress: publicKey,
      completeRoute: route,
      slippage: absoluteSlippage,
    });

    const txBlock = new TransactionBlock(TransactionBlock.from(modernTxBlock.serialize()));

    return txBlock;
  }

  /**
   * Gets a transaction block for swapping tokens based on provided swap data.
   *
   * Note: This method is not implemented yet.
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
    route: RouterCompleteTradeRoute;
    publicKey: string;
    slippagePercentage: number;
  }): Promise<TransactionBlock> {
    throw new Error(`[${this.providerName}] getSwapTransactionDoctored method not implemented`);
  }

  /**
   * Retrieves a transaction block for creating an LP coin.
   *
   * @public
   * @static
   * @param {CreateLpCoinInput} input - The input parameters for creating the LP coin transaction.
   * @param {string} input.publicKey - The public key associated with the wallet.
   * @param {number} input.lpCoinDecimals - The number of decimal places for the LP coin.
   * @return {Promise<TransactionBlock>} A promise that resolves to a transaction block representing the
   * creation of the LP coin.
   */
  public static async getCreateLpCoinTransaction({
    publicKey,
    lpCoinDecimals,
  }: CreateLpCoinInput): Promise<TransactionBlock> {
    const sdk = new Aftermath("MAINNET");
    const pools = sdk.Pools();
    const createLpCoinTransaction = await pools.getPublishLpCoinTransaction({
      walletAddress: publicKey,
      lpCoinDecimals: lpCoinDecimals,
    });

    return new TransactionBlock(TransactionBlock.from(createLpCoinTransaction.serialize()));
  }

  /**
   * Retrieves a transaction block for creating a liquidity pool.
   *
   * LIMITATION: If client created pool and now wants to create one more with the same coins and the same amounts,
   * creation will be FAILED. At least one amount must be different from the amount from the existing pool.
   *
   * @public
   * @static
   * @param {CreatePoolInput} input - The input parameters for creating the pool transaction.
   * @param {string} input.publicKey - The public key associated with the wallet.
   * @param {any} input.createLpCoinTransactionResult - The result of the create LP coin transaction.
   * @param {CoinMetadata} input.lpCoinMetadata - The metadata of the LP coin.
   * @param {Record<string, CoinMetadata>} input.coinsInfo - Information about the coins involved in the pool.
   * @param {string} input.poolName - The name of the pool.
   * @return {Promise<TransactionBlock>} A promise that resolves to a transaction block representing the creation
   * of the liquidity pool.
   */
  public static async getCreatePoolTransaction({
    publicKey,
    createLpCoinTransactionResult,
    lpCoinMetadata,
    coinsInfo,
    poolName,
  }: CreatePoolInput): Promise<TransactionBlock> {
    const sdk = new Aftermath("MAINNET");
    const { lpCoinType, createPoolCapId } = getCreatePoolCapIdAndLpCoinType(createLpCoinTransactionResult);
    const pools = sdk.Pools();
    const createPoolTransaction = await pools.getCreatePoolTransaction({
      coinsInfo: Object.values(coinsInfo),
      createPoolCapId,
      lpCoinType,
      lpCoinMetadata,
      walletAddress: publicKey,
      // TODO: Implement stable pools creation
      poolFlatness: 0,
      poolName,
      respectDecimals: false,
      isSponsoredTx: false,
    });

    return new TransactionBlock(TransactionBlock.from(createPoolTransaction.serialize()));
  }

  /**
   * Generates the URL for accessing a liquidity pool based on the result of a create pool transaction.
   *
   * @public
   * @static
   * @param {SuiTransactionBlockResponse} createPoolTransactionResult - The result of the create pool transaction.
   * @return {string} The URL for accessing the liquidity pool.
   */
  public static getPoolUrl(createPoolTransactionResult: SuiTransactionBlockResponse) {
    const poolObjectId = getPoolObjectIdFromTransactionResult(createPoolTransactionResult);

    return `${this.AFTERMATH_POOL_URL}/${poolObjectId}`;
  }

  /**
   * Retrieves weights for two coins based on their amounts and current prices.
   *
   * @public
   * @static
   * @param {GetWeightsInput} coinsInfo - Information about the coins and their amounts.
   * @return {Promise<{ weightA: number, weightB: number }>} A promise that resolves to an object
   * containing weights for the two coins.
   */
  public static async getWeights(coinsInfo: GetWeightsInput): Promise<{ weightA: number; weightB: number }> {
    const sdk = new Aftermath("MAINNET");

    const { type: coinTypeA, amount: amountA } = coinsInfo.coinA;
    const { type: coinTypeB, amount: amountB } = coinsInfo.coinB;

    const prices = sdk.Prices();
    const priceA: number = await prices.getCoinPrice({ coin: coinTypeA });
    const priceB: number = await prices.getCoinPrice({ coin: coinTypeB });

    // If either of the prices is undefined, further calculations could be unpredictable,
    // hence returning equal weights of 0.5 for both coins.
    if (priceA === -1 || priceB === -1) {
      return { weightA: 0.5, weightB: 0.5 };
    }

    const usdAmountA = new BigNumber(amountA).multipliedBy(priceA);
    const usdAmountB = new BigNumber(amountB).multipliedBy(priceB);
    const usdSum: BigNumber = usdAmountA.plus(usdAmountB);

    let weightA = new BigNumber(usdAmountA.dividedBy(usdSum).toFixed(4));
    let weightB = new BigNumber(usdAmountB.dividedBy(usdSum).toFixed(4));

    // If the sum of weights is not equal to 1, then the remainder needed to reach 1 is added
    // to the smaller weight to ensure their combined value equals 1.
    if (weightA.plus(weightB) !== new BigNumber(1)) {
      const remainder = new BigNumber(new BigNumber(1).minus(weightA).minus(weightB).toFixed(4));

      if (weightA > weightB) {
        weightB = weightB.plus(remainder);
      } else {
        weightA = weightA.plus(remainder);
      }
    }

    return { weightA: weightA.toNumber(), weightB: weightB.toNumber() };
  }

  /**
   * Retrieves the maximum and minimum amount of the second coin based on the amount of the first coin.
   *
   * NOTE: This method will be used only when both coins have a price retrievable from the API. If at least
   * one coin lacks a price, it is pointless to limit the amounts of the coins.
   *
   * @public
   * @static
   * @param {Object} options - The options object.
   * @param {string} options.coinTypeA - The type of the first coin.
   * @param {string} options.amountA - The amount of the first coin.
   * @param {string} options.coinTypeB - The type of the second coin.
   * @param {number} options.decimalsB - The number of decimal places for the second coin.
   * @return {Promise<{ minAmountB: string, maxAmountB: string }>} A promise that resolves to an object containing
   * the minimum and maximum amount of the second coin.
   */
  public static async getMaxAndMinSecondCoinAmount({
    coinTypeA,
    amountA,
    coinTypeB,
    decimalsB,
  }: {
    coinTypeA: string;
    amountA: string;
    coinTypeB: string;
    decimalsB: number;
  }): Promise<{ minAmountB: string; maxAmountB: string }> {
    const sdk = new Aftermath("MAINNET");
    const minWeightB = 0.05;
    const maxWeightB = 0.95;

    const prices = sdk.Prices();
    const priceA: number = await prices.getCoinPrice({ coin: coinTypeA });
    const priceB: number = await prices.getCoinPrice({ coin: coinTypeB });

    const usdAmountA = new BigNumber(amountA).multipliedBy(priceA);
    const minUsdAmountB = new BigNumber(minWeightB)
      .multipliedBy(usdAmountA)
      .dividedBy(new BigNumber(1).minus(minWeightB));
    const maxUsdAmountB = new BigNumber(maxWeightB)
      .multipliedBy(usdAmountA)
      .dividedBy(new BigNumber(1).minus(maxWeightB));

    const minAmountB = minUsdAmountB.dividedBy(priceB).toFixed(decimalsB);
    const maxAmountB = maxUsdAmountB.dividedBy(priceB).toFixed(decimalsB);

    return { minAmountB, maxAmountB };
  }

  /**
   * Checks if a coin has a price retrievable from the API.
   *
   * @public
   * @static
   * @param {string} coinType - The type of the coin to check for price availability.
   * @return {Promise<boolean>} A promise that resolves to true if the coin has a price retrievable from the
   * API, otherwise false.
   */
  public static async coinHasPrice(coinType: string): Promise<boolean> {
    const sdk = new Aftermath("MAINNET");
    const prices = sdk.Prices();
    const price: number = await prices.getCoinPrice({ coin: coinType });

    return price !== -1;
  }

  /**
   * Retrieves information about owned pools.
   *
   * @public
   * @static
   * @param {CoinAssetData[]} allAssets - An array of all available coin asset data.
   * @param {CoinManagerSingleton} coinManager - The coin manager instance.
   * @return {Promise<OwnedPoolInfo[]>} A promise that resolves to an array of information about owned pools.
   */
  public static async getOwnedPoolsInfo(
    allAssets: CoinAssetData[],
    coinManager: CoinManagerSingleton,
  ): Promise<OwnedPoolInfo[]> {
    const lpCoinTypePart = "af_lp::AF_LP";
    const sdk = new Aftermath("MAINNET");
    const poolsSdk = sdk.Pools();

    const lpCoins: CoinAssetData[] = allAssets.filter((asset) => asset.type.includes(lpCoinTypePart));
    const poolObjectIds: string[] = await Promise.all(
      lpCoins.map((lpCoin) => poolsSdk.getPoolObjectIdForLpCoinType({ lpCoinType: lpCoin.type })),
    );
    const pools: Pool[] = await poolsSdk.getPools({ objectIds: poolObjectIds });
    await Promise.all(pools.map((pool) => pool.getStats()));

    const ownedPoolInfos: OwnedPoolInfo[] = await getOwnedPoolInfosFromPools(pools, coinManager);

    return ownedPoolInfos;
  }

  /**
   * Removes the current instance of AftermathSingleton.
   *
   * Disclaimer: While this method in this class is marked as public, it is strongly discouraged
   * to use it directly unless you are certain about the behavior.
   */
  public static removeInstance() {
    AftermathSingleton._instance = undefined;
  }

  public buildDcaTxBlockAdapter = () => {
    throw new Error("Not implemented");
  };
}
