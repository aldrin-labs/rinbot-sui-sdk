import { TransactionBlock } from "@mysten/sui.js/transactions";
import { BN, Decimal, MAX_SQRT_PRICE, MIN_SQRT_PRICE, Pool, Trade, TurbosSdk } from "turbos-clmm-sdk";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui.js/utils";

const ONE_MINUTE = 60 * 1000;

// eslint-disable-next-line
function amountOutWithSlippage(amountOut: Decimal, slippage: string, amountSpecifiedIsInput: boolean) {
  if (amountSpecifiedIsInput) {
    const minus = new Decimal(100).minus(slippage).div(100);
    return new Decimal(amountOut).mul(minus).toFixed(0);
  }

  const plus = new Decimal(100).plus(slippage).div(100);
  return new Decimal(amountOut).mul(plus).toFixed(0);
}

// eslint-disable-next-line
function sqrtPriceWithSlippage(
  sdk: TurbosSdk,
  price: Decimal,
  slippage: string,
  a2b: boolean,
  decimalsA: number,
  decimalsB: number,
): string {
  const newPrice = new Decimal(price).mul(
    a2b ? new Decimal(100).minus(slippage).div(100) : new Decimal(100).plus(slippage).div(100),
  );
  const sqrtPrice = sdk.math.priceToSqrtPriceX64(newPrice, decimalsA, decimalsB);

  if (sqrtPrice.lt(new BN(MIN_SQRT_PRICE))) {
    return MIN_SQRT_PRICE;
  }
  if (sqrtPrice.gt(new BN(MAX_SQRT_PRICE))) {
    return MAX_SQRT_PRICE;
  }
  return sqrtPrice.toString();
}

// eslint-disable-next-line
function getFunctionNameAndTypeArguments(pools: Pool.Types[], coinTypeA: string, coinTypeB: string) {
  let typeArguments: string[] = [];
  const functionName: string[] = ["swap"];
  if (pools.length === 1) {
    typeArguments = pools[0]!;
    if (coinTypeA === typeArguments[0]) {
      functionName.push("a", "b");
    } else {
      functionName.push("b", "a");
    }
  } else {
    const pool1Args = pools[0]!;
    const pool2Args = pools[1]!;
    if (coinTypeA === pool1Args[0]) {
      functionName.push("a", "b");
      typeArguments.push(pool1Args[0], pool1Args[2], pool1Args[1]);
    } else {
      functionName.push("b", "a");
      typeArguments.push(pool1Args[1], pool1Args[2], pool1Args[0]);
    }

    typeArguments.push(pool2Args[2], coinTypeB);
    if (coinTypeB === pool2Args[0]) {
      functionName.push("c", "b");
    } else {
      functionName.push("b", "c");
    }
  }

  return {
    functionName: functionName.join("_"),
    typeArguments,
  };
}

// eslint-disable-next-line
export async function swapDoctored(sdk: TurbosSdk, options: Trade.SwapOptions): Promise<TransactionBlock> {
  const { coinTypeA, coinTypeB, address, amountSpecifiedIsInput, slippage } = options;
  const amountA = new Decimal(options.amountA);
  const amountB = new Decimal(options.amountB);

  const contract = await sdk.contract.getConfig();
  console.log("Geting Routes");
  const routes = await Promise.all(
    options.routes.map(async (item) => {
      const typeArguments = await sdk.pool.getPoolTypeArguments(item.pool);
      const [coinA, coinB] = await Promise.all([
        sdk.coin.getMetadata(typeArguments[0]),
        sdk.coin.getMetadata(typeArguments[1]),
      ]);
      return {
        ...item,
        coinA,
        coinB,
        typeArguments: typeArguments,
      };
    }),
  );
  console.log("Got Routes");
  // Doctoring the coinIDs --> empty array
  const coinIds: string[] = [];
  const { functionName, typeArguments } = getFunctionNameAndTypeArguments(
    routes.map(({ typeArguments }) => typeArguments),
    coinTypeA,
    coinTypeB,
  );
  console.log("Got Function Names");
  const sqrtPrices = routes.map(({ nextTickIndex, coinA, coinB, a2b }) => {
    const nextTickPrice = sdk.math.tickIndexToPrice(nextTickIndex, coinA.decimals, coinB.decimals);
    return sqrtPriceWithSlippage(sdk, nextTickPrice, slippage, a2b, coinA.decimals, coinB.decimals);
  });
  console.log("Got sqrtPrices");

  const txb = options.txb || new TransactionBlock();
  txb.moveCall({
    target: `${contract.PackageId}::swap_router::${functionName}`,
    typeArguments: typeArguments,
    arguments: [
      ...routes.map(({ pool }) => txb.object(pool)),
      txb.makeMoveVec({
        objects: sdk.coin.convertTradeCoins(txb, coinIds, coinTypeA, amountA),
      }),
      txb.pure((amountSpecifiedIsInput ? amountA : amountB).toFixed(0), "u64"),
      txb.pure(
        amountOutWithSlippage(amountSpecifiedIsInput ? amountB : amountA, slippage, amountSpecifiedIsInput),
        "u64",
      ),
      ...sqrtPrices.map((price) => txb.pure(price, "u128")),
      txb.pure(amountSpecifiedIsInput, "bool"),
      txb.pure(address, "address"),
      txb.pure(Date.now() + ONE_MINUTE * 3, "u64"),
      txb.object(SUI_CLOCK_OBJECT_ID),
      txb.object(contract.Versioned),
    ],
  });

  return txb;
}
