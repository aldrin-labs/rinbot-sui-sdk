/* eslint-disable require-jsdoc */

import { DCAObjectFields } from "../../managers/dca/types";
import { CommonCoinData } from "../../managers/types";
import { CetusPathForStorage } from "../../providers/cetus/types";
import { ShortCoinMetadata } from "../../providers/flowx/types";
import { ShortPoolData } from "../../providers/turbos/types";
import { CommonPoolData } from "../../providers/types";
import { StorageValue } from "../types";

export function isStorageValue(data: unknown): data is StorageValue {
  return (
    typeof data === "object" &&
    data !== null &&
    "timestamp" in data &&
    "value" in data &&
    (isCommonCoinDataArray(data.value) ||
      isCommonPoolDataArray(data.value) ||
      isShortCoinMetadataArray(data.value) ||
      isShortPoolDataArray(data.value) ||
      isCetusPathForStorageArray(data.value) ||
      isDCAObjectFieldsArray(data.value))
  );
}

export function isCommonCoinDataArray(data: unknown): data is CommonCoinData[] {
  return Array.isArray(data) && data.every((item) => isCommonCoinData(item));
}

export function isCommonCoinData(data: unknown): data is CommonCoinData {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as CommonCoinData).type === "string" &&
    "decimals" in data &&
    typeof (data as CommonCoinData).decimals === "number" &&
    ((data as CommonCoinData).symbol === undefined || typeof (data as CommonCoinData).symbol === "string")
  );
}

export function isCommonPoolDataArray(data: unknown): data is CommonPoolData[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "base" in item &&
        typeof (item as CommonPoolData).base === "string" &&
        "quote" in item &&
        typeof (item as CommonPoolData).quote === "string",
    )
  );
}

export function isShortCoinMetadataArray(data: unknown): data is ShortCoinMetadata[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "decimals" in item &&
        typeof (item as ShortCoinMetadata).decimals === "number" &&
        "type" in item &&
        typeof (item as ShortCoinMetadata).type === "string",
    )
  );
}

export function isShortPoolDataArray(data: unknown): data is ShortPoolData[] {
  return (
    Array.isArray(data) &&
    data.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "poolId" in item &&
        typeof (item as ShortPoolData).poolId === "string" &&
        "coinTypeA" in item &&
        typeof (item as ShortPoolData).coinTypeA === "string" &&
        "coinTypeB" in item &&
        typeof (item as ShortPoolData).coinTypeB === "string",
    )
  );
}

export function isCetusPathForStorageArray(data: unknown): data is CetusPathForStorage[] {
  if (!Array.isArray(data)) return false;

  return data.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "base" in item &&
      typeof (item as CetusPathForStorage).base === "string" &&
      "quote" in item &&
      typeof (item as CetusPathForStorage).quote === "string" &&
      "addressMap" in item &&
      Array.isArray((item as CetusPathForStorage).addressMap) &&
      (item as CetusPathForStorage).addressMap.every(
        (pair) =>
          Array.isArray(pair) && pair.length === 2 && typeof pair[0] === "number" && typeof pair[1] === "string",
      ),
  );
}

export function isDCAObjectFieldsArray(data: unknown): data is DCAObjectFields[] {
  if (!Array.isArray(data)) return false;

  return data.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "active" in item &&
      typeof (item as DCAObjectFields).active === "boolean" &&
      "input_balance" in item &&
      typeof (item as DCAObjectFields).input_balance === "string" &&
      "delegatee" in item &&
      typeof (item as DCAObjectFields).delegatee === "string" &&
      "every" in item &&
      typeof (item as DCAObjectFields).every === "string" &&
      "gas_budget" in item &&
      typeof (item as DCAObjectFields).gas_budget === "string" &&
      "id" in item &&
      typeof (item as DCAObjectFields).id === "object" &&
      "id" in (item as DCAObjectFields).id &&
      typeof (item as DCAObjectFields).id.id === "string" &&
      "last_time_ms" in item &&
      typeof (item as DCAObjectFields).last_time_ms === "string" &&
      "owner" in item &&
      typeof (item as DCAObjectFields).owner === "string" &&
      "remaining_orders" in item &&
      typeof (item as DCAObjectFields).remaining_orders === "string" &&
      "split_allocation" in item &&
      typeof (item as DCAObjectFields).split_allocation === "string" &&
      "start_time_ms" in item &&
      typeof (item as DCAObjectFields).start_time_ms === "string" &&
      "time_scale" in item &&
      typeof (item as DCAObjectFields).time_scale === "number" &&
      "trade_params" in item &&
      typeof (item as DCAObjectFields).trade_params === "object" &&
      "type" in (item as DCAObjectFields).trade_params &&
      typeof (item as DCAObjectFields).trade_params.type === "string" &&
      "fields" in (item as DCAObjectFields).trade_params &&
      typeof (item as DCAObjectFields).trade_params.fields === "object" &&
      "max_price" in (item as DCAObjectFields).trade_params.fields &&
      (typeof (item as DCAObjectFields).trade_params.fields.max_price === "string" ||
        (item as DCAObjectFields).trade_params.fields.max_price === null) &&
      "min_price" in (item as DCAObjectFields).trade_params.fields &&
      (typeof (item as DCAObjectFields).trade_params.fields.min_price === "string" ||
        (item as DCAObjectFields).trade_params.fields.min_price === null) &&
      "base_coin_type" in item &&
      typeof (item as DCAObjectFields).base_coin_type === "string" &&
      "quote_coin_type" in item &&
      typeof (item as DCAObjectFields).quote_coin_type === "string",
  );
}
