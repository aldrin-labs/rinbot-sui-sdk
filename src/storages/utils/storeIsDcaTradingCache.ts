/* eslint-disable require-jsdoc */

import { Storage, StorageProperty } from "../types";

export async function storeIsDcaTradingCache({
  storage,
  isDcaTrading,
}: {
  storage: Storage;
  isDcaTrading: boolean;
}): Promise<void> {
  try {
    const timestamp = Date.now().toString();

    await storage.setCache({
      property: StorageProperty.IsDCATrading,
      value: { value: isDcaTrading, timestamp },
    });
  } catch (error) {
    console.error("[storeIsDcaTrading] Error occured while storing:", error);

    throw error;
  }
}
