/* eslint-disable require-jsdoc */

import { SuiObjectResponse, SuiParsedData } from "@mysten/sui.js/client";
import BigNumber from "bignumber.js";
import { TOKEN_ADDRESS_BASE_REGEX } from "../../providers/common";
import { DCAContent, DCAContentFields, DCAResponse, DCATimescaleToMillisecondsMap } from "./types";
import { Argument } from "./txBlock";
import { DCA_CONFIG } from "./config";

// eslint-disable-next-line
export function feeAmount(amount: number): number {
  const scaledFee = Math.floor((amount * 1_000_000 * DCA_CONFIG.DCA_TRADE_FEE_BPS) / 10_000);

  return scaledFee / 1_000_000;
}

export function isValidDCAFields(fields: unknown): fields is DCAContentFields {
  return (
    typeof fields === "object" &&
    fields !== null &&
    "active" in fields &&
    typeof fields.active === "boolean" &&
    "input_balance" in fields &&
    typeof fields.input_balance === "string" &&
    "delegatee" in fields &&
    typeof fields.delegatee === "string" &&
    "every" in fields &&
    typeof fields.every === "string" &&
    "gas_budget" in fields &&
    typeof fields.gas_budget === "string" &&
    "id" in fields &&
    typeof fields.id === "object" &&
    "last_time_ms" in fields &&
    typeof fields.last_time_ms === "string" &&
    "owner" in fields &&
    typeof fields.owner === "string" &&
    "remaining_orders" in fields &&
    typeof fields.remaining_orders === "string" &&
    "split_allocation" in fields &&
    typeof fields.split_allocation === "string" &&
    "start_time_ms" in fields &&
    typeof fields.start_time_ms === "string" &&
    "time_scale" in fields &&
    typeof fields.time_scale === "number" &&
    "trade_params" in fields &&
    typeof fields.trade_params === "object" &&
    fields.trade_params !== null &&
    "type" in fields.trade_params &&
    "fields" in fields.trade_params &&
    typeof fields.trade_params.fields === "object" &&
    fields.trade_params.fields !== null &&
    "max_price" in fields.trade_params.fields &&
    "min_price" in fields.trade_params.fields &&
    typeof fields.trade_params.type === "string" &&
    typeof fields.trade_params.fields === "object" &&
    (typeof fields.trade_params.fields.max_price === "string" || fields.trade_params.fields.max_price === null) &&
    (typeof fields.trade_params.fields.min_price === "string" || fields.trade_params.fields.min_price === null)
  );
}

export function isDCAContent(data: SuiParsedData | null): data is DCAContent {
  return (
    !!data &&
    data.dataType === "moveObject" &&
    typeof data.type === "string" &&
    typeof data.hasPublicTransfer === "boolean" &&
    isValidDCAFields(data.fields)
  );
}

export function isValidDCAObjectResponse(obj: SuiObjectResponse): obj is DCAResponse {
  return !!obj.data?.content && isDCAContent(obj.data.content);
}

export function filterValidDCAObjects(dcaList: SuiObjectResponse[]): DCAResponse[] {
  return dcaList.filter(isValidDCAObjectResponse);
}

// TODO: Add test for the util function, since it does use regex
/**
 * Extracts base and quote coin types from the input DCA type string.
 *
 * @param {string} dcaTypeString - The input DCA type string.
 * @return {{ baseCoinType: string, quoteCoinType: string }} An object containing the base and quote coin types.
 * @throws {Error} Throws an error if the input string does not match the expected format.
 */
export function getBaseQuoteCoinTypesFromDCAType(dcaTypeString: string): {
  baseCoinType: string;
  quoteCoinType: string;
} {
  const regex = new RegExp(`DCA<(${TOKEN_ADDRESS_BASE_REGEX.source}).*(${TOKEN_ADDRESS_BASE_REGEX.source})>`);
  const match = dcaTypeString.match(regex);

  if (!match) {
    throw new Error("Invalid DCA type string format");
  }

  const [baseCoinType, quoteCoinType] = match.slice(1, 3);

  return {
    baseCoinType,
    quoteCoinType,
  };
}

export function hasMinMaxPriceParams(params: {
  minPrice?: string;
  maxPrice?: string;
}): params is { minPrice: string; maxPrice: string } {
  return params.minPrice !== undefined && params.maxPrice !== undefined;
}

export function getMillisecondsByDcaEveryParams(every: string, timeScale: number): number {
  const milliseconds = DCATimescaleToMillisecondsMap.get(timeScale);

  if (milliseconds === undefined) {
    throw new Error();
  }

  return new BigNumber(every).multipliedBy(milliseconds).toNumber();
}

export const fromArgument = (arg: Argument, idx: number) => {
  // console.log(`Processing argument at index ${idx}:`, arg);

  return {
    kind: arg.kind,
    value: arg.value,
    type: arg.type,
    index: idx,
  };
};
