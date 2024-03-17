/* eslint-disable require-jsdoc */
import { EventId, PaginatedEvents, SuiClient, SuiEvent } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui.js/utils";
import BigNumber from "bignumber.js";
import { MAX_BATCH_EVENTS_PER_QUERY_EVENTS_REQUEST } from "../../providers/common";
import { getAllObjects } from "../../providers/utils/getAllObjects";
import { GetTransactionType } from "../../transactions/types";
import { obj } from "../../transactions/utils";
import {
  CreateDCAAddGasBudgetTransaction,
  CreateDCADepositBaseTransactionArgs,
  CreateDCAInitTransactionArgs,
  DCACreateEventParsedJson,
  DCAObject,
  DCAObjectFields,
  GetDCAAddGasBudgetTransactionArgs,
  GetDCADepositBaseTransactionArgs,
  GetDCAIncreaseOrdersRemainingTransactionArgs,
  GetDCAInitTradeTransactionArgs,
  GetDCAInitTransactionArgs,
  GetDCAInitWithPriceParamsTransactionArgs,
  GetDCARedeemFundsAndCloseTransactionArgs,
  GetDCAResolveTradeTransactionArgs,
  GetDCASetInactiveTransactionArgs,
  GetDCASetReactivateAsOwnerTransactionArgs,
  GetDCAWithdrawBaseTransactionArgs,
  SuiEventDCACreate,
} from "./types";
import { filterValidDCAObjects, getBaseQuoteCoinTypesFromDCAType, hasMinMaxPriceParams } from "./utils";

/**
 * @class DCAManagerSingleton
 * @description
 * This class encapsulates the business logic for a Dollar Cost Averaging (DCA) smart contract.
 * Dollar Cost Averaging is a strategy for mitigating market volatility by regularly investing a fixed
 * amount of funds over time, regardless of the asset's current price.
 */
export class DCAManagerSingleton {
  // TODO: Change DCA_PACKAGE_ADDRESS & maybe move all that params to args for singleton
  public static DCA_PACKAGE_ADDRESS = "0x89b1372fa44ac2312a3876d83612d1dc9d298af332a42a153913558332a564d0";
  public static DCA_EVENT_TYPE = `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::DCACreatedEvent`;
  public static DCA_GAS_BUGET = 50_000_000;
  // TODO: Rename DCA_MINIMUM_GAS_FUNDS to DCA_MINIMUM_GAS_FUNDS_PER_TRADE
  public static DCA_MINIMUM_GAS_FUNDS = 25_000_000;
  public static DCA_DELEGETEE_ACCOUNT_ADDRESS = "0x42dbd0fea6fefd7689d566287581724151b5327c08b76bdb9df108ca3b48d1d5";
  private static _instance: DCAManagerSingleton;
  private provider: SuiClient;

  /**
   * Constructs a new instance of the SuiProvider class with the provided SUI provider URL.
   *
   * @private
   * @constructor
   * @param {string} suiProviderUrl - The URL of the SUI provider.
   */
  private constructor(suiProviderUrl: string) {
    this.provider = new SuiClient({ url: suiProviderUrl });
  }

  /**
   * @public
   * @method getInstance
   * @description Gets the singleton instance of DCAManagerSingleton.
   * @param {string} [suiProviderUrl] - Url of SUI provider.
   * @return {DCAManagerSingleton} The singleton instance of DCAManagerSingleton.
   */
  public static getInstance(suiProviderUrl?: string): DCAManagerSingleton {
    if (!DCAManagerSingleton._instance) {
      if (suiProviderUrl === undefined) {
        throw new Error("[DCAManager] SUI provider url is required in arguments to create DCAManager instance.");
      }

      const instance = new DCAManagerSingleton(suiProviderUrl);
      DCAManagerSingleton._instance = instance;
    }

    return DCAManagerSingleton._instance;
  }

  public async getDCAEventsByPackage() {
    // TODO: Move that logic into separate util (e.g. `fetchEventsByPackage`)
    // TODO: Unify that method with `getDCAEventsByUser`
    const allEvents: SuiEvent[] = [];
    let nextCursor: EventId | undefined | null = null;
    let events: PaginatedEvents = await this.provider.queryEvents({
      query: { MoveEventType: DCAManagerSingleton.DCA_EVENT_TYPE },
      limit: MAX_BATCH_EVENTS_PER_QUERY_EVENTS_REQUEST,
      cursor: nextCursor,
    });

    // Fetching and combining part
    while (events.hasNextPage) {
      const userEvents: SuiEvent[] = events.data;
      allEvents.push(...userEvents);

      nextCursor = events.nextCursor;
      events = await this.provider.queryEvents({
        query: { MoveEventType: DCAManagerSingleton.DCA_EVENT_TYPE },
        limit: MAX_BATCH_EVENTS_PER_QUERY_EVENTS_REQUEST,
        cursor: nextCursor,
      });
    }

    const userEvents: SuiEvent[] = events.data;
    allEvents.push(...userEvents);

    const createDCAEvents = allEvents.filter((event): event is SuiEventDCACreate =>
      DCAManagerSingleton.isDCACreateEventParsedJson(event.parsedJson),
    );

    return createDCAEvents;
  }

  public async getDCAsByPackage(): Promise<DCAObject[]> {
    const createDCAEventsByPackage = await this.getDCAEventsByPackage();
    const DCAObjectIds = createDCAEventsByPackage.map((el) => el.parsedJson.id);

    const DCAObjectsResponseData = await getAllObjects({
      objectIds: DCAObjectIds,
      provider: this.provider,
      options: { showContent: true },
    });

    const DCAResponseDataFiltred = filterValidDCAObjects(DCAObjectsResponseData);
    const dcaList = DCAResponseDataFiltred.map((el) => {
      const { baseCoinType, quoteCoinType } = getBaseQuoteCoinTypesFromDCAType(el.data.content.type);

      return {
        ...el.data.content,
        fields: {
          ...el.data.content.fields,
          base_coin_type: baseCoinType,
          quote_coin_type: quoteCoinType,
        },
      };
    });

    return dcaList;
  }

  public async getActiveDCAsFieldsByPackage(): Promise<DCAObjectFields[]> {
    const dcasByPackage = await this.getDCAsByPackage();

    return dcasByPackage.filter((dca) => dca.fields.active === true).map((dca) => dca.fields);
  }

  public async getDCAEventsByUser({ publicKey }: { publicKey: string }): Promise<SuiEventDCACreate[]> {
    // TODO: Move that logic into separate util (e.g. `fetchEventsByUser`)
    // TODO: Unify that method with `getDCAEventsByPackage`
    const allEvents: SuiEvent[] = [];
    let nextCursor: EventId | undefined | null = null;
    let events: PaginatedEvents = await this.provider.queryEvents({
      query: { Sender: publicKey },
      limit: MAX_BATCH_EVENTS_PER_QUERY_EVENTS_REQUEST,
      cursor: nextCursor,
    });

    // Fetching and combining part
    while (events.hasNextPage) {
      const userEvents: SuiEvent[] = events.data;
      allEvents.push(...userEvents);

      nextCursor = events.nextCursor;
      events = await this.provider.queryEvents({
        query: { Sender: publicKey },
        limit: MAX_BATCH_EVENTS_PER_QUERY_EVENTS_REQUEST,
        cursor: nextCursor,
      });
    }

    const userEvents: SuiEvent[] = events.data;
    allEvents.push(...userEvents);

    const createDCAEvents = DCAManagerSingleton.getCreateDCAEventsFromUserEvents(allEvents).filter(
      (event): event is SuiEventDCACreate => DCAManagerSingleton.isDCACreateEventParsedJson(event.parsedJson),
    );

    return createDCAEvents;
  }

  public async getDCAsByUserByStatus({
    publicKey,
  }: {
    publicKey: string;
  }): Promise<{ activeDCAs: DCAObject[]; deactivatedDCAs: DCAObject[] }> {
    const dcaList = await this.getDCAsByUser({ publicKey });

    const dcas = dcaList.reduce(
      (acc: { activeDCAs: DCAObject[]; deactivatedDCAs: DCAObject[] }, el) => {
        if (el.fields.active) {
          acc.activeDCAs.push(el);
        } else {
          acc.deactivatedDCAs.push(el);
        }

        return acc;
      },
      {
        activeDCAs: [],
        deactivatedDCAs: [],
      },
    );

    return dcas;
  }

  public async getDCAsByUser({ publicKey }: { publicKey: string }): Promise<DCAObject[]> {
    const createDCAEventsByUser = await this.getDCAEventsByUser({ publicKey });
    const DCAObjectIds = createDCAEventsByUser.map((el) => el.parsedJson.id);

    const DCAObjectsResponseData = await getAllObjects({
      objectIds: DCAObjectIds,
      provider: this.provider,
      options: { showContent: true },
    });

    const DCAResponseDataFiltred = filterValidDCAObjects(DCAObjectsResponseData);
    const dcaList = DCAResponseDataFiltred.map((el) => {
      const { baseCoinType, quoteCoinType } = getBaseQuoteCoinTypesFromDCAType(el.data.content.type);

      return {
        ...el.data.content,
        fields: {
          ...el.data.content.fields,
          base_coin_type: baseCoinType,
          quote_coin_type: quoteCoinType,
        },
      };
    });

    return dcaList;
  }

  public static isDCACreateEventParsedJson(obj: unknown): obj is DCACreateEventParsedJson {
    return (
      typeof obj === "object" &&
      obj !== null &&
      "delegatee" in obj &&
      "id" in obj &&
      "owner" in obj &&
      typeof obj.delegatee === "string" &&
      typeof obj.id === "string" &&
      typeof obj.owner === "string"
    );
  }

  public static getCreateDCAEventsFromUserEvents(userEvents: SuiEvent[]) {
    return userEvents.filter((event) => event.type.includes(DCAManagerSingleton.DCA_EVENT_TYPE));
  }

  public static async createDCAInitTransaction({
    allCoinObjectsList,
    publicKey,

    ...dcaParams
  }: CreateDCAInitTransactionArgs) {
    const tx = dcaParams.transaction ?? new TransactionBlock();

    const DCA_ALL_SWAPS_GAS_BUGET_BN = new BigNumber(dcaParams.totalOrders).multipliedBy(
      new BigNumber(DCAManagerSingleton.DCA_MINIMUM_GAS_FUNDS),
    );

    // Note: We relay that there is enough SUI funds on user's wallets for covering DCA_ALL_SWAPS_GAS_BUGET_BN
    const [coin] = tx.splitCoins(tx.gas, [tx.pure(DCA_ALL_SWAPS_GAS_BUGET_BN)]);

    // TODO: Unify the merge & split coins with all the rest of the methods
    if (allCoinObjectsList.length === 0) {
      throw new Error("No coin objects found for specific coin type");
    }

    const sourceCoinObjectId = allCoinObjectsList[0].coinObjectId;
    const isMergeCoinsRequired = allCoinObjectsList.length > 1;

    if (isMergeCoinsRequired) {
      console.warn(`[isMergeCoinsRequired] for ${dcaParams.baseCoinType}`);
      const coinObjectIdsToMerge = allCoinObjectsList.slice(1).map((el) => el.coinObjectId);

      tx.mergeCoins(
        tx.object(sourceCoinObjectId),
        coinObjectIdsToMerge.map((el) => tx.object(el)),
      );
    }

    const coinSplitTxResult = tx.splitCoins(tx.object(sourceCoinObjectId), [
      tx.pure(dcaParams.baseCoinAmountToDepositIntoDCA),
    ]);

    const result = hasMinMaxPriceParams(dcaParams)
      ? DCAManagerSingleton.getDCAInitWithParamsTransaction({
          ...dcaParams,
          baseCoinAccount: coinSplitTxResult,
          gasCoinAccount: coin,
          transaction: tx,
        })
      : DCAManagerSingleton.getDCAInitTransaction({
          ...dcaParams,
          baseCoinAccount: coinSplitTxResult,
          gasCoinAccount: coin,
          transaction: tx,
        });

    const { tx: dcaTransaction, txRes: dcaTransactionRes } = await result;

    dcaTransaction.transferObjects([coin], dcaTransaction.pure(publicKey));

    return { tx: dcaTransaction, txRes: dcaTransactionRes };
  }

  public static async getDCAInitTransaction({
    baseCoinType, // USDC
    quoteCoinType, // SUI

    baseCoinAccount, // 100 USDC
    every, // each 10
    timeScale, // minute
    totalOrders, // 15 orders

    gasCoinAccount,

    transaction,
  }: GetDCAInitTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::init_account`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [
        obj(tx, SUI_CLOCK_OBJECT_ID),
        tx.pure(DCAManagerSingleton.DCA_DELEGETEE_ACCOUNT_ADDRESS, "address"),
        obj(tx, baseCoinAccount),
        tx.pure(every, "u64"),
        tx.pure(totalOrders, "u64"),
        tx.pure(timeScale, "u8"),
        obj(tx, gasCoinAccount),
      ],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  public static async getDCAInitWithParamsTransaction({
    baseCoinType, // USDC
    quoteCoinType, // SUI

    minPrice, // 1.3
    maxPrice, // 1.6
    baseCoinAccount, // 100 USDC
    every, // each 10
    timeScale, // minute
    totalOrders, // 15 orders

    gasCoinAccount,

    transaction,
  }: GetDCAInitWithPriceParamsTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::init_account_with_params`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [
        obj(tx, SUI_CLOCK_OBJECT_ID),
        tx.pure(DCAManagerSingleton.DCA_DELEGETEE_ACCOUNT_ADDRESS, "address"),
        obj(tx, baseCoinAccount),
        tx.pure(every, "u64"),
        tx.pure(totalOrders, "u64"),
        tx.pure(timeScale, "u8"),
        obj(tx, gasCoinAccount),
        tx.pure(minPrice, "u64"),
        tx.pure(maxPrice, "u64"),
      ],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  public static async createDCADepositBaseTransaction({
    publicKey,
    allCoinObjectsList,
    ...dcaParams
  }: CreateDCADepositBaseTransactionArgs) {
    const tx = dcaParams.transaction ?? new TransactionBlock();

    const DCA_ALL_SWAPS_GAS_BUGET_BN = new BigNumber(dcaParams.addOrdersCount).multipliedBy(
      new BigNumber(DCAManagerSingleton.DCA_MINIMUM_GAS_FUNDS),
    );

    // Note: We relay that there is enough SUI funds on user's wallets for covering DCA_ALL_SWAPS_GAS_BUGET_BN
    const [coin] = tx.splitCoins(tx.gas, [tx.pure(DCA_ALL_SWAPS_GAS_BUGET_BN)]);

    // TODO: Unify the merge & split coins with all the rest of the methods
    if (allCoinObjectsList.length === 0) {
      throw new Error("No coin objects found for specific coin type");
    }

    const sourceCoinObjectId = allCoinObjectsList[0].coinObjectId;
    const isMergeCoinsRequired = allCoinObjectsList.length > 1;

    if (isMergeCoinsRequired) {
      console.warn(`[isMergeCoinsRequired] for ${dcaParams.baseCoinType}`);
      const coinObjectIdsToMerge = allCoinObjectsList.slice(1).map((el) => el.coinObjectId);

      tx.mergeCoins(
        tx.object(sourceCoinObjectId),
        coinObjectIdsToMerge.map((el) => tx.object(el)),
      );
    }

    const coinSplitTxResult = tx.splitCoins(tx.object(sourceCoinObjectId), [
      tx.pure(dcaParams.baseCoinAmountToDepositIntoDCA),
    ]);

    const { tx: dcaTransaction, txRes: dcaTransactionRes } = await DCAManagerSingleton.getDCADepositBaseTransaction({
      ...dcaParams,
      baseCoinAccount: coinSplitTxResult,
      gasCoinAccount: coin,
      transaction: tx,
    });

    dcaTransaction.transferObjects([coin], dcaTransaction.pure(publicKey));

    return { tx: dcaTransaction, txRes: dcaTransactionRes };
  }

  public static async getDCADepositBaseTransaction({
    dca,

    baseCoinType,
    quoteCoinType,

    baseCoinAccount,
    addOrdersCount = 0,

    gasCoinAccount,

    transaction,
  }: GetDCADepositBaseTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::deposit_input`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca), obj(tx, baseCoinAccount), tx.pure(addOrdersCount), obj(tx, gasCoinAccount)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  public static async getDCAWithdrawBaseTransaction({
    dca,

    baseCoinType,
    quoteCoinType,

    baseCoinAmountToWithdrawFromDCA,
    removeOrdersCount = 0,

    transaction,
  }: GetDCAWithdrawBaseTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::withdraw_input`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca), tx.pure(baseCoinAmountToWithdrawFromDCA), tx.pure(removeOrdersCount)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  public static async getDCAInitTradeTransaction({
    dca,

    baseCoinType,
    quoteCoinType,

    transaction,
  }: GetDCAInitTradeTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::init_trade`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca), obj(tx, SUI_CLOCK_OBJECT_ID)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  public static async getDCAResolveTradeTransaction({
    dca,

    baseCoinType,
    quoteCoinType,

    transaction,

    quoteAmount,
    initTradePromise,
  }: GetDCAResolveTradeTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::resolve_trade`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca), obj(tx, quoteAmount), obj(tx, initTradePromise)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  public static async getDCAIncreaseOrdersRemainingTransaction({
    dca,
    publicKey,
    baseCoinType,
    quoteCoinType,
    transaction,
    addOrdersCount,
  }: GetDCAIncreaseOrdersRemainingTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const DCA_ALL_SWAPS_GAS_BUGET_BN = new BigNumber(addOrdersCount).multipliedBy(
      new BigNumber(DCAManagerSingleton.DCA_MINIMUM_GAS_FUNDS),
    );

    // Note: We relay that there is enough SUI funds on user's wallets for covering DCA_ALL_SWAPS_GAS_BUGET_BN
    const [coin] = tx.splitCoins(tx.gas, [tx.pure(DCA_ALL_SWAPS_GAS_BUGET_BN)]);

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::increase_remaining_orders`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca), obj(tx, coin), tx.pure(addOrdersCount)],
    });

    tx.transferObjects([coin], tx.pure(publicKey));

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  /**
   * Set DCA to inactive state, should be signed from either `delegatee` or an `owner` of DCA.
   */
  public static async getDCASetInactiveTransaction({
    dca,
    baseCoinType,
    quoteCoinType,
    transaction,
  }: GetDCASetInactiveTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::set_inactive`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  /**
   * Set DCA to inactive state, should be signed only from an `owner` of DCA.
   */
  public static async getDCAReactivateAsOwnerTransaction({
    dca,
    baseCoinType,
    quoteCoinType,
    transaction,
  }: GetDCASetReactivateAsOwnerTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::reactivate_as_owner`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  /**
   * Retrieves DCA transaction which would redeem funds in DCA and close DCA.
   * @comment This method is a work in progress and is not functioning correctly at the moment
   * (because SUI doesn't support deletion of shared or immutable objects at the moment).
   * It suppose to work from 1.20 version of SUI mainnet
   */
  public static async getDCARedeemFundsAndCloseTransaction({
    dca,
    baseCoinType,
    quoteCoinType,
    transaction,
  }: GetDCARedeemFundsAndCloseTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::redeem_funds_and_close`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }

  public static async createDCAAddGasBudgetTransaction({ ...dcaParams }: CreateDCAAddGasBudgetTransaction) {
    const tx = dcaParams.transaction ?? new TransactionBlock();

    // Note: We relay that there is enough SUI funds on user's wallets for covering DCA_ALL_SWAPS_GAS_BUGET_BN
    const [coin] = tx.splitCoins(tx.gas, [tx.pure(dcaParams.gasAmountToAdd)]);

    const { tx: dcaTransaction, txRes: dcaTransactionRes } = await DCAManagerSingleton.getDCAAddGasBudgetTransaction({
      ...dcaParams,
      gasCoinAccount: coin,
      transaction: tx,
    });

    return { tx: dcaTransaction, txRes: dcaTransactionRes };
  }

  public static async getDCAAddGasBudgetTransaction({
    dca,
    baseCoinType,
    quoteCoinType,

    transaction,

    gasCoinAccount,
  }: GetDCAAddGasBudgetTransactionArgs): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${DCAManagerSingleton.DCA_PACKAGE_ADDRESS}::dca::add_gas_budget`,
      typeArguments: [baseCoinType, quoteCoinType],
      arguments: [obj(tx, dca), obj(tx, gasCoinAccount)],
    });

    tx.setGasBudget(DCAManagerSingleton.DCA_GAS_BUGET);

    return { tx, txRes };
  }
}
