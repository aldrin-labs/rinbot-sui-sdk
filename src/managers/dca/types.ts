import { CoinStruct, SuiEvent, SuiObjectData, SuiObjectResponse } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { ObjectArg, TransactionResult } from "../../transactions/types";

export enum DCATimescale {
  Seconds = 0,
  Minutes = 1,
  Hours = 2,
  Days = 3,
  Weeks = 4,
  Months = 5,
}

export const SECOND_IN_MS = 1_000;
export const MINUTE_IN_MS = 60 * SECOND_IN_MS;
export const HOUR_IN_MS = 60 * MINUTE_IN_MS;
export const DAY_IN_MS = 24 * HOUR_IN_MS;
export const WEEK_IN_MS = 7 * DAY_IN_MS;
export const MONTH_IN_MS = 30 * DAY_IN_MS;

export const DCATimescaleToMillisecondsMap = new Map([
  [DCATimescale.Seconds, SECOND_IN_MS],
  [DCATimescale.Minutes, MINUTE_IN_MS],
  [DCATimescale.Hours, HOUR_IN_MS],
  [DCATimescale.Days, DAY_IN_MS],
  [DCATimescale.Weeks, WEEK_IN_MS],
  [DCATimescale.Months, MONTH_IN_MS],
]);

export type GetDCAInitTransactionArgs = {
  baseCoinType: string;
  quoteCoinType: string;

  timeScale: DCATimescale;
  every: number;
  baseCoinAccount: ObjectArg;
  totalOrders: number;

  gasCoinAccount: ObjectArg;

  transaction?: TransactionBlock;
};

export type GetDCAInitWithPriceParamsTransactionArgs = {
  minPrice: string;
  maxPrice: string;
} & GetDCAInitTransactionArgs;

export type CreateDCAInitTransactionArgs = Omit<
  Omit<GetDCAInitTransactionArgs, "baseCoinAccount">,
  "gasCoinAccount"
> & {
  publicKey: string;
  baseCoinAmountToDepositIntoDCA: string;
  allCoinObjectsList: CoinStruct[];
  minPrice?: string;
  maxPrice?: string;
};

export interface GetDCADepositBaseTransactionArgs {
  dca: ObjectArg;
  baseCoinType: string;
  quoteCoinType: string;
  baseCoinAccount: ObjectArg;
  addOrdersCount: number;

  gasCoinAccount: ObjectArg;

  transaction?: TransactionBlock;
}

export type CreateDCADepositBaseTransactionArgs = Omit<
  Omit<GetDCADepositBaseTransactionArgs, "baseCoinAccount">,
  "gasCoinAccount"
> & {
  publicKey: string;
  baseCoinAmountToDepositIntoDCA: string;
  allCoinObjectsList: CoinStruct[];
};

export interface GetDCAWithdrawBaseTransactionArgs {
  dca: ObjectArg;

  baseCoinType: string;
  quoteCoinType: string;

  baseCoinAmountToWithdrawFromDCA: string;
  removeOrdersCount?: number;

  transaction?: TransactionBlock;
}

export interface GetDCAInitTradeTransactionArgs {
  dca: ObjectArg;
  baseCoinType: string;
  quoteCoinType: string;

  transaction?: TransactionBlock;
}

export interface GetDCAResolveTradeTransactionArgs {
  dca: ObjectArg;

  baseCoinType: string;
  quoteCoinType: string;

  transaction?: TransactionBlock;

  quoteAmount: string;
  initTradePromise: TransactionResult;
}

export interface GetDCAIncreaseOrdersRemainingTransactionArgs {
  publicKey: string;
  dca: ObjectArg;

  baseCoinType: string;
  quoteCoinType: string;

  transaction?: TransactionBlock;
  addOrdersCount: number;
}

export interface GetDCASetInactiveTransactionArgs {
  dca: ObjectArg;

  baseCoinType: string;
  quoteCoinType: string;

  transaction?: TransactionBlock;
}

export type GetDCASetReactivateAsOwnerTransactionArgs = GetDCASetInactiveTransactionArgs;
export type GetDCARedeemFundsAndCloseTransactionArgs = GetDCASetInactiveTransactionArgs;

export type GetDCAAddGasBudgetTransactionArgs = { gasCoinAccount: ObjectArg } & GetDCASetInactiveTransactionArgs;
export type CreateDCAAddGasBudgetTransaction = {
  gasAmountToAdd: string;
} & Omit<GetDCAAddGasBudgetTransactionArgs, "gasCoinAccount">;

export type DCACreateEventParsedJson = {
  delegatee: string;
  id: string;
  owner: string;
};

// Extend SuiEvent to include your specific parsedJson type
export interface SuiEventDCACreate extends SuiEvent {
  parsedJson: DCACreateEventParsedJson;
}

export interface DCAContent {
  dataType: "moveObject";
  type: string;
  hasPublicTransfer: boolean;
  fields: DCAContentFields;
}

export type DCAContentFields = {
  active: boolean;
  input_balance: string;
  delegatee: string;
  every: string;
  gas_budget: string;
  id: { id: string };
  last_time_ms: string;
  owner: string;
  remaining_orders: string;
  split_allocation: string;
  start_time_ms: string;
  time_scale: number;
  trade_params: {
    type: string;
    fields: {
      max_price: string | null;
      min_price: string | null;
    };
  };
};

export interface DCAObject extends DCAContent {
  fields: DCAContentFields & {
    base_coin_type: string;
    quote_coin_type: string;
  };
}

export interface DCAResponseData extends SuiObjectData {
  content: DCAContent;
}

export interface DCAResponse extends SuiObjectResponse {
  data: DCAResponseData;
}
