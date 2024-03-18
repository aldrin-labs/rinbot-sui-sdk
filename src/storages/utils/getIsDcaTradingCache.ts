/* eslint-disable require-jsdoc */

import { Storage, StorageProperty, StorageValue } from "../types";
import { isDcaIsTradingField } from "./typeguards";

export async function getIsDcaTradingCache({ storage }: { storage: Storage }): Promise<boolean> {
  let isDcaTrading = false;

  const isDcaTradingCache: StorageValue = await storage.getCache({ property: StorageProperty.IsDCATrading });

  if (isDcaIsTradingField(isDcaTradingCache?.value)) {
    isDcaTrading = isDcaTradingCache.value;
  } else if (isDcaTradingCache === null) {
    console.warn("[getIsDcaTradingCache] Received empty isDcaTrading from strorage, isDcaTrading === null");
  } else {
    const stringifiedIsDcaTrading: string = JSON.stringify(isDcaTradingCache.value);
    throw new Error(
      "[getIsDcaTradingCache] isDcaTrading from storage is not boolean or null. " +
        `Value from storage: ${stringifiedIsDcaTrading}`,
    );
  }

  return isDcaTrading;
}
