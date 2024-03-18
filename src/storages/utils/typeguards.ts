/* eslint-disable require-jsdoc */

import { isValidDCAFields } from "../..";
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
      isValidDCAFields(data.value) ||
      isDcaIsTradingField(data.value))
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

export function isDcaIsTradingField(data: unknown): data is boolean {
  return typeof data === "boolean";
}
