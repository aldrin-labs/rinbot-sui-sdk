import { TransactionBlock } from "@mysten/sui.js/transactions";
import { TxBlock, Transaction, Arguments, Argument, Input } from "../txBlock";
import { DCA_CONTRACT, fromArgument } from "../utils";

const DCA_ROUTER = "cetus";
let InputIndex = 0;

const swapPatterns: Record<string, `${string}::${string}::${string}`> = {
  ".*::router::swap$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap"}`,
  ".*::router::swap_ab_bc$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_ab_bc"}`,
  ".*::router::swap_ab_cb$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_ab_cb"}`,
  ".*::router::swap_ba_bc$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_ba_bc"}`,
  ".*::router::swap_ba_cb$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_ba_cb"}`,
};

const checkPatterns: Record<string, `${string}::${string}::${string}`> = {
  ".*::router::check_coin_threshold$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"check_coin_threshold"}`,
};

type SwapParams = {
  globalConfig: Argument;
  poolA: Argument;
  poolB: Argument;
  inputFunds: Argument;
  outputFunds: Argument;
  // If simple swap then exists, else no
  a2b?: Argument;
  byAmountIn: Argument;
  amount0: Argument;
  amount1: Argument;
  sqrtPriceLimit0: Argument;
  sqrtPriceLimit1: Argument;
  clock: Argument;
  dca: Argument;
  gasGost: Argument;
};

/**
 * Builds a transaction block for Dollar Cost Averaging (DCA).
 * @param {TransactionBlock} txBlock - The transaction block to build upon.
 * @param {string} tokenFrom - The token to be exchanged from.
 * @param {string} tokenTo - The token to be exchanged to.
 * @param {string} dcaId - The ID for the Dollar Cost Averaging (DCA) operation.
 * @param {number} gasCost - The gas cost for the transaction.
 * @return {TransactionBlock} - The built transaction block for DCA.
 */
export function buildDcaTxBlock(
  txBlock: TransactionBlock,
  tokenFrom: string,
  tokenTo: string,
  dcaId: string,
  gasCost: number,
): TransactionBlock {
  let isSimpleSwap = false;

  // Initialize a TransactionBlock
  const dcaBlock: TxBlock = {
    version: 1,
    transactions: [],
    inputs: [],
    gasConfig: txBlock.blockData.gasConfig,
    sender: txBlock.blockData.sender,
    expiration: txBlock.blockData.expiration,
  };

  // 1. Transaction to create Coin<tokenFrom>
  dcaBlock.transactions.push({
    kind: "MoveCall",
    target: "0x2::coin::zero",
    arguments: [],
    typeArguments: [tokenFrom],
  });

  // 2. Transaction to create Coin<tokenTo>
  dcaBlock.transactions.push({
    kind: "MoveCall",
    target: "0x2::coin::zero",
    arguments: [],
    typeArguments: [tokenTo],
  });

  const swapPatternRegex = new RegExp(Object.keys(swapPatterns).join("|"));
  const checkPatternRegex = new RegExp(Object.keys(checkPatterns).join("|"));

  txBlock.blockData.transactions.forEach((transaction) => {
    if (transaction.kind === "MoveCall" && transaction.target) {
      const swapMatch: RegExpExecArray | null = swapPatternRegex.exec(transaction.target);

      if (swapMatch) {
        const parts = transaction.target.split("::");
        let newTarget: `${string}::${string}::${string}` = `${DCA_CONTRACT}::${DCA_ROUTER}::${parts[2]}`;
        isSimpleSwap = newTarget === `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap"}`;

        // if pattern is swap --> route: if a2b == true --> swap_ab, else --> swap_ba
        if (isSimpleSwap) {
          // Check if the argument at index 6 (arguments[5]) has value "true" or "false"
          const argument6 = transaction.arguments[5];
          if (argument6 && argument6.kind === "Input" && argument6.value === "true") {
            // Modify the function name to swap_ab
            newTarget = `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_ab"}`;
          } else if (argument6 && argument6.kind === "Input" && argument6.value === "false") {
            // Modify the function name to swap_ba
            newTarget = `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_ba"}`;
          } else {
            throw new Error("Incoherent function parameter");
          }
        }

        const swapParams: SwapParams = isSimpleSwap
          ? {
              globalConfig: fromArgument(transaction.arguments[0] as Argument, inputIdx()),
              poolA: fromArgument(transaction.arguments[1] as Argument, inputIdx()),
              poolB: fromArgument(transaction.arguments[2] as Argument, inputIdx()),
              inputFunds: { kind: "Result", index: 0 } as Argument,
              outputFunds: { kind: "Result", index: 1 } as Argument,
              a2b: fromArgument(transaction.arguments[5] as Argument, inputIdx()),
              byAmountIn: fromArgument(transaction.arguments[6] as Argument, inputIdx()),
              amount0: fromArgument(transaction.arguments[7] as Argument, inputIdx()),
              amount1: fromArgument(transaction.arguments[8] as Argument, inputIdx()),
              sqrtPriceLimit0: fromArgument(transaction.arguments[9] as Argument, inputIdx()),
              sqrtPriceLimit1: fromArgument(transaction.arguments[10] as Argument, inputIdx()),
              clock: fromArgument(transaction.arguments[10] as Argument, inputIdx()),
              dca: { kind: "Input", value: dcaId, index: inputIdx(), type: "object" },
              gasGost: { kind: "Input", value: gasCost, index: inputIdx(), type: "pure" },
            }
          : {
              globalConfig: fromArgument(transaction.arguments[0] as Argument, inputIdx()),
              poolA: fromArgument(transaction.arguments[1] as Argument, inputIdx()),
              poolB: fromArgument(transaction.arguments[2] as Argument, inputIdx()),
              inputFunds: { kind: "Result", index: 0 } as Argument,
              outputFunds: { kind: "Result", index: 1 } as Argument,
              byAmountIn: fromArgument(transaction.arguments[5] as Argument, inputIdx()),
              amount0: fromArgument(transaction.arguments[6] as Argument, inputIdx()),
              amount1: fromArgument(transaction.arguments[7] as Argument, inputIdx()),
              sqrtPriceLimit0: fromArgument(transaction.arguments[8] as Argument, inputIdx()),
              sqrtPriceLimit1: fromArgument(transaction.arguments[9] as Argument, inputIdx()),
              clock: fromArgument(transaction.arguments[10] as Argument, inputIdx()),
              dca: { kind: "Input", value: dcaId, index: inputIdx(), type: "object" },
              gasGost: { kind: "Input", value: gasCost, index: inputIdx(), type: "pure" },
            };

        const inputs = isSimpleSwap
          ? [
              swapParams.globalConfig as Input,
              swapParams.poolA as Input,
              swapParams.poolB as Input,
              swapParams.a2b as Input,
              swapParams.byAmountIn as Input,
              swapParams.amount0 as Input,
              swapParams.amount1 as Input,
              swapParams.sqrtPriceLimit0 as Input,
              swapParams.sqrtPriceLimit1 as Input,
              swapParams.clock as Input,
              swapParams.dca as Input,
              swapParams.gasGost as Input,
            ]
          : [
              swapParams.globalConfig as Input,
              swapParams.poolA as Input,
              swapParams.poolB as Input,
              swapParams.byAmountIn as Input,
              swapParams.amount0 as Input,
              swapParams.amount1 as Input,
              swapParams.sqrtPriceLimit0 as Input,
              swapParams.sqrtPriceLimit1 as Input,
              swapParams.clock as Input,
              swapParams.dca as Input,
              swapParams.gasGost as Input,
            ];

        const args: Arguments = isSimpleSwap
          ? [
              swapParams.globalConfig,
              swapParams.poolA,
              swapParams.poolB,
              swapParams.inputFunds,
              swapParams.outputFunds,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              swapParams.a2b!,
              swapParams.outputFunds,
              swapParams.byAmountIn,
              swapParams.amount0,
              swapParams.amount1,
              swapParams.sqrtPriceLimit0,
              swapParams.sqrtPriceLimit1,
              swapParams.clock,
              swapParams.dca,
              swapParams.gasGost,
            ]
          : [
              swapParams.globalConfig,
              swapParams.poolA,
              swapParams.poolB,
              swapParams.inputFunds,
              swapParams.outputFunds,
              swapParams.byAmountIn,
              swapParams.amount0,
              swapParams.amount1,
              swapParams.sqrtPriceLimit0,
              swapParams.sqrtPriceLimit1,
              swapParams.clock,
              swapParams.dca,
              swapParams.gasGost,
            ];

        const tx: Transaction = {
          arguments: args,
          kind: transaction.kind,
          target: newTarget,
          typeArguments: transaction.typeArguments,
        };

        dcaBlock.inputs.push(...inputs);
        dcaBlock.transactions.push(tx);
      } else {
        const checkMatch = checkPatternRegex.exec(transaction.target);

        if (checkMatch) {
          const parts = transaction.target.split("::");
          const newTarget: `${string}::${string}::${string}` = `${DCA_CONTRACT}::${DCA_ROUTER}::${parts[2]}`;

          const arg1 = transaction.arguments[1] as {
            kind: "Input";
            index: number;
            type: "object" | "pure" | undefined;
            value: any;
          };

          const minOutputArg = {
            kind: "Input",
            // This is the value produced by the Cetus SDK
            // that corresponds to the minOutput amount
            value: arg1.value,
            index: dcaBlock.inputs.length,
            type: "pure",
          };

          const args: Arguments = [
            {
              kind: "NestedResult",
              // this is the index of the swap transaction, which is 2,
              // i.e. the third element in the transactoin vec
              index: 2,
              // second element in the result array corresponding to second tx,
              // i.e this is the output funds
              resultIndex: 1,
            },
            minOutputArg as Argument,
          ];

          const tx: Transaction = {
            arguments: args,
            kind: transaction.kind,
            typeArguments: transaction.typeArguments,
            target: newTarget,
          };

          dcaBlock.inputs.push(minOutputArg as Input);
          dcaBlock.transactions.push(tx);
        }
      }
    }
  });

  const newTxBlock = TransactionBlock.from(JSON.stringify(dcaBlock));
  return newTxBlock;
}

// eslint-disable-next-line
function inputIdx(): number {
  ++InputIndex;
  return InputIndex - 1;
}
