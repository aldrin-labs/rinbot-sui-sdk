import { TransactionBlock } from "@mysten/sui.js/transactions";
import { BigNumberInstance } from "../../../providers/flowx/calculateAmountOutInternal";
import { estimateDealine } from "@flowx-pkg/ts-sdk";

export const CONTAINER_OBJECT_ID = "0xb65dcbf63fd3ad5d0ebfbf334780dc9f785eff38a4459e37ab08fa79576ee511";
export const CLOCK_ID = "0x0000000000000000000000000000000000000000000000000000000000000006";
export const PACKAGE_OBJECT_ID = "0xba153169476e8c3114962261d1edc70de5ad9781b83cc617ecc8c1923191cae0";

export const FUNCTION = {
  SWAP_EXACT_OUTPUT: "swap_exact_output",
  SWAP_EXACT_INPUT: "swap_exact_input",
  SWAP_EXACT_INPUT_DOUBLEHOP: "swap_exact_input_doublehop",
  SWAP_EXACT_OUTPUT_DOUBLEHOP: "swap_exact_output_doublehop",
  SWAP_EXACT_INPUT_TRIPLEHOP: "swap_exact_input_triplehop",
  SWAP_EXACT_OUTPUT_TRIPLEHOP: "swap_exact_output_triplehop",
  SWAP_EXACT_INPUT_DOUBLE_OUTPUT: "swap_exact_input_double_output",
  SWAP_EXACT_INPUT_TRIPLE_OUTPUT: "swap_exact_input_triple_output",
  SWAP_EXACT_INPUT_QUADRUPLE_OUTPUT: "swap_exact_input_quadruple_output",
  SWAP_EXACT_INPUT_QUINTUPLE_OUTPUT: "swap_exact_input_quintuple_output",
  SWAP_EXACT_DOUBLE_INPUT: "swap_exact_double_input",
  SWAP_EXACT_TRIPLE_INPUT: "swap_exact_triple_input",
  SWAP_EXACT_QUADRUPLE_INPUT: "swap_exact_quadruple_input",
  SWAP_EXACT_QUINTUPLE_INPUT: "swap_exact_quintuple_input",
};

// https://github.com/FlowX-Finance/ts-sdk/blob/master/src/types.ts#L4
export interface CoinMetadata {
  decimals?: number;
  description?: string;
  iconUrl?: string;
  type?: string;
  isVerified?: boolean;
  symbol?: string;
  balance?: number | string;
  derivedSUI?: number | string;
  derivedPriceInUSD?: number | string;
  name?: string;
  id?: string;
  stats?: CoinStats;
  twitterUrl?: string;
  websiteUrl?: string;
  coinMarketcapUrl?: string;
  coingeckoUrl?: string;
}

export interface CoinStruct {
  balance: string;
  coinObjectId: string;
  coinType: string;
  digest: string;
  previousTransaction: string;
  version: string;
}

export interface CoinStats {
  totalLiquidityInUSD: number | string;
  priceChange24H: number | string;
  price: number | string;
  volume7D: number | string;
  volume24H: number | string;
  transaction24H: number | string;
  totalLiquidity: number | string;
  fee24H: number | string;
}

export interface PairSetting {
  _id?: string;
  coinXType: string;
  coinYType: string;
  createdBy?: string;
  createdAt?: string;
  isNewPair?: boolean;
  lpType?: string;
  lpName?: string;
  userLpBalance?: string;
  reserveX?: string;
  reserveY?: string;
  lpObjectId?: string;
  inRate?: string;
  outRate?: string;
  stats?: PairStats;
}

export interface PairStats {
  volume7D: number | string;
  volume24H: number | string;
  transaction24H: number | string;
  totalLiquidity: number | string;
  fee24H: number | string;
  aprPerformance7D: number | string;
  totalLiquidityInUSD: string | number;
}

export type Amount = {
  amount: number | string;
  decimalAmount: number | string;
};

export interface SwapArgs {
  typeArguments: string[];
  args: any[];
  tx: TransactionBlock;
  callFunction: string;
}

// Forked from: https://github.com/FlowX-Finance/ts-sdk/blob/001d2b549931001fe01f4547c311b96
// 39182e0af/src/swap/swapExactInput.ts#L119
export const swapExactInputDoctored = async (
  isExactIn: boolean,
  amountIn: Amount,
  amountOut: Amount,
  trades: PairSetting[],
  coinIn: CoinMetadata,
  coinOut: CoinMetadata,
  account: string,
  valueSlippage: number,
) => {
  try {
    const slipageVal = valueSlippage > 100 ? 100 : valueSlippage < 0 ? 0 : valueSlippage;
    // eslint-disable-next-line new-cap
    const slippage = BigNumberInstance(slipageVal).div(100).toFixed();
    // if (isExactIn) {
    //   console.log("AAA", BigNumberInstance(1).minus(slippage).toFixed(), {
    //     amountIn: amountIn.decimalAmount,
    //     amountOutMin: BigNumberInstance(amountOut.decimalAmount)
    //       .multipliedBy(BigNumberInstance(1).minus(slippage).toFixed())
    //       .toFixed(0),
    //   });
    // } else {
    //   console.log("BBB", {
    //     amountInMax: amountIn.decimalAmount,
    //     amountOut: amountOut.decimalAmount,
    //   });
    // }
    const { typeArguments, args, tx, callFunction } = isExactIn
      ? await getArgsSwapExactInput(
          amountIn.decimalAmount,
          // eslint-disable-next-line new-cap
          BigNumberInstance(amountOut.decimalAmount)
            .multipliedBy(1 - +slippage)
            .toFixed(0),
          trades,
          coinIn,
          account,
          "",
        )
      : await getArgsSwapExactOutput(amountIn.decimalAmount, amountOut.decimalAmount, trades, coinIn, account, "");

    // console.log('=======> Swap Args ==========>');
    // console.log('Args: ', args);
    // console.log('Amount in: ', amountIn.decimalAmount);
    // console.log('Amount out: ', amountOut.decimalAmount);
    // console.log('Type Args: ', typeArguments);
    // console.log('=======> End Args ==========>');
    // console.log("KKK", tx);
    const txb = await swap(tx, typeArguments, args, callFunction);
    return txb;
  } catch (e) {
    console.log("error", e);
    // eslint-disable-next-line no-throw-literal
    throw `ERROR SWAP: ${e}`;
  }
};

const swap = async (
  tx: TransactionBlock,
  typeArguments: string[],
  args: any[],
  callFunction: string,
): Promise<TransactionBlock> => {
  tx.moveCall({
    target: `${PACKAGE_OBJECT_ID}::router::${callFunction}`,
    arguments: args,
    typeArguments,
  });
  return tx;
};

const getArgsSwapExactInput = async (
  amountIn: string | number,
  amountOutMin: string | number,
  trades: PairSetting[],
  coinIn: CoinMetadata,
  account: string,
  recipient: string,
): Promise<SwapArgs> => {
  const { coin: coinObjectId, tx } = await handleGetCoinAmount(amountIn, account, coinIn.type!);
  const typeArguments: any[] = [coinIn.type];
  trades?.forEach((item) => {
    const lastArgs = typeArguments[typeArguments.length - 1] ?? "";
    if (lastArgs == item.coinXType) {
      typeArguments.push(item.coinYType);
    } else {
      typeArguments.push(item.coinXType);
    }
  });
  return {
    tx,
    typeArguments,
    args: [
      tx.object(CLOCK_ID),
      tx.object(CONTAINER_OBJECT_ID),
      tx.object(coinObjectId),
      tx.pure(+amountOutMin),
      tx.pure(recipient || account),
      tx.pure(estimateDealine()),
    ],
    callFunction: getSwapFunction(trades, true),
  };
};

const getSwapFunction = (trades: PairSetting[], isExactIn = false) => {
  switch (trades?.length) {
    case 1:
      return isExactIn ? FUNCTION.SWAP_EXACT_INPUT : FUNCTION.SWAP_EXACT_OUTPUT;
    case 2:
      return isExactIn ? FUNCTION.SWAP_EXACT_INPUT_DOUBLEHOP : FUNCTION.SWAP_EXACT_OUTPUT_DOUBLEHOP;
    case 3:
      return isExactIn ? FUNCTION.SWAP_EXACT_INPUT_TRIPLEHOP : FUNCTION.SWAP_EXACT_OUTPUT_TRIPLEHOP;
    default:
      return isExactIn ? FUNCTION.SWAP_EXACT_INPUT : FUNCTION.SWAP_EXACT_OUTPUT;
  }
};

const getArgsSwapExactOutput = async (
  amountInMax: string | number,
  amountOut: string | number,
  trades: PairSetting[],
  coinIn: CoinMetadata,
  account: string,
  recipient: string,
): Promise<SwapArgs> => {
  const { coin: coinObjectId, tx } = await handleGetCoinAmount(amountInMax, account, coinIn.type!);

  const typeArguments: any[] = [coinIn.type];
  trades?.forEach((item) => {
    const lastArgs = typeArguments[typeArguments.length - 1] ?? "";
    if (lastArgs == item.coinXType) {
      typeArguments.push(item.coinYType);
    } else {
      typeArguments.push(item.coinXType);
    }
  });

  return {
    tx,
    typeArguments,
    args: [
      tx.object(CLOCK_ID),
      tx.object(CONTAINER_OBJECT_ID),
      tx.object(coinObjectId),
      tx.pure(+amountInMax),
      tx.pure(+amountOut),
      tx.pure(recipient || account),
      tx.pure(estimateDealine()),
    ],
    callFunction: getSwapFunction(trades, false),
  };
};

export const handleGetCoinAmount = async (
  amount: number | string,
  account: string,
  coinType: string,
  inheritTx?: TransactionBlock,
): Promise<{ tx: TransactionBlock; coin: string }> => {
  const tx = inheritTx ?? new TransactionBlock();
  const coin = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  return { tx, coin };
};
