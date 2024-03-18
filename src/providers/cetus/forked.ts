/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable require-jsdoc */

import { AggregatorResult, SplitPath, TickMath, ZERO } from "@cetusprotocol/cetus-sui-clmm-sdk";
import BN from "bn.js";
import { randomUUID } from "crypto";
import Decimal from "decimal.js";
import {
  FETCH_BEST_ROUTE_ATTEMPTS_COUNT,
  MAX_FETCH_BEST_ROUTE_TIMEOUT_DURATION,
  MIN_FETCH_BEST_ROUTE_TIMEOUT_DURATION,
} from "./config";

export async function fetchBestRoute({
  coinTypeFrom,
  coinTypeTo,
  amount,
  config: {
    apiUrl,
    attempts = FETCH_BEST_ROUTE_ATTEMPTS_COUNT,
    maxTimeoutDuration = MAX_FETCH_BEST_ROUTE_TIMEOUT_DURATION,
    minTimeoutDuration = MIN_FETCH_BEST_ROUTE_TIMEOUT_DURATION,
  },
  byAmountIn,
}: {
  coinTypeFrom: string;
  coinTypeTo: string;
  amount: string;
  byAmountIn: boolean;
  config: {
    apiUrl: string;
    attempts?: number;
    minTimeoutDuration?: number;
    maxTimeoutDuration?: number;
  };
}): Promise<AggregatorResult> {
  const params = new URLSearchParams({
    from: coinTypeFrom,
    to: coinTypeTo,
    amount: encodeURIComponent(amount),
    by_amount_in: encodeURIComponent(byAmountIn),
    order_split: encodeURIComponent(false),
    external_router: encodeURIComponent(false),
    request_id: encodeURIComponent(randomUUID()),
  });

  for (let i = 0; i < attempts; i++) {
    try {
      const timeout = Math.floor(Math.random() * (maxTimeoutDuration - minTimeoutDuration + 1)) + minTimeoutDuration;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(`${apiUrl}?${params.toString()}`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.status === 200) {
        return parseJsonResult(await response.json());
      } else {
        throw new Error("Response status is not 200.");
      }
    } catch (error) {
      console.error(`[fetchBestRoute] Attempt ${i + 1} failed: ${error}`);
    }
  }

  throw new Error("[fetchBestRoute] All attempts to fetch best route data failed.");
}

function parseJsonResult(data: any): AggregatorResult {
  const result: AggregatorResult = {
    isExceed: data.is_exceed,
    isTimeout: data.is_timeout,
    inputAmount: data.input_amount,
    outputAmount: data.output_amount,
    fromCoin: data.from_coin,
    toCoin: data.to_coin,
    byAmountIn: data.by_amount_in,
    splitPaths: data.split_paths.map((path: any) => {
      const splitPath: SplitPath = {
        pathIndex: path.path_index,
        lastQuoteOutput: path.last_quote_output,
        percent: path.percent,
        basePaths: path.best_path.map((basePath: any) => {
          return {
            direction: basePath.direction,
            label: basePath.label,
            poolAddress: basePath.provider,
            fromCoin: basePath.from_coin,
            toCoin: basePath.to_coin,
            outputAmount: basePath.output_amount,
            inputAmount: basePath.input_amount,
            feeRate: basePath.fee_rate,
            currentSqrtPrice: new BN(basePath.current_sqrt_price.toString()),
            afterSqrtPrice: basePath.label === "Cetus" ? new BN(basePath.after_sqrt_price.toString()) : ZERO,
            fromDecimal: basePath.from_decimal,
            toDecimal: basePath.to_decimal,
            currentPrice: calculatePrice(
              new BN(basePath.current_sqrt_price.toString()),
              basePath.from_decimal,
              basePath.to_decimal,
              basePath.direction,
              basePath.label,
            ),
          };
        }),
        inputAmount: path.input_amount,
        outputAmount: path.output_amount,
      };
      return splitPath;
    }),
  };
  return result;
}

function calculatePrice(
  currentSqrtPrice: BN,
  fromDecimals: number,
  toDecimals: number,
  a2b: boolean,
  label: string,
): Decimal {
  const decimalA = a2b ? fromDecimals : toDecimals;
  const decimalB = a2b ? toDecimals : fromDecimals;
  if (label === "Cetus") {
    const price = TickMath.sqrtPriceX64ToPrice(currentSqrtPrice, decimalA, decimalB);
    return price;
  }

  const price = new Decimal(currentSqrtPrice.toString()).div(new Decimal(10).pow(new Decimal(decimalB + 9 - decimalA)));
  return price;
}
