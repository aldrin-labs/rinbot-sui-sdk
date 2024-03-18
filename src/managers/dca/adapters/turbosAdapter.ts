import { TransactionBlock } from "@mysten/sui.js/transactions";
import { TxBlock, Transaction, Arguments, Argument, Input } from "../txBlock";
import { fromArgument } from "../utils";
import { DCA_CONFIG } from "../config";

const DCA_ROUTER = "turbos";
let InputIndex = 0;

const swapPatterns: Record<string, `${string}::${string}::${string}`> = {
  ".*::swap_router::swap_a_b$": `${DCA_CONFIG.DCA_CONTRACT}::${DCA_ROUTER}::${"swap_a_b"}`,
  ".*::swap_router::swap_b_a$": `${DCA_CONFIG.DCA_CONTRACT}::${DCA_ROUTER}::${"swap_b_a"}`,
  ".*::swap_router::swap_a_b_b_c$": `${DCA_CONFIG.DCA_CONTRACT}::${DCA_ROUTER}::${"swap_a_b_b_c"}`,
  ".*::swap_router::swap_a_b_c_b$": `${DCA_CONFIG.DCA_CONTRACT}::${DCA_ROUTER}::${"swap_a_b_c_b"}`,
  ".*::swap_router::swap_b_a_b_c$": `${DCA_CONFIG.DCA_CONTRACT}::${DCA_ROUTER}::${"swap_b_a_b_c"}`,
  ".*::swap_router::swap_b_a_c_b$": `${DCA_CONFIG.DCA_CONTRACT}::${DCA_ROUTER}::${"swap_b_a_c_b"}`,
};

type SwapParams = {
  pool: Argument;
  poolII?: Argument; // Swap with hop
  coin: Argument;
  amount: Argument;
  amountThreshold: Argument;
  sqrtPriceLimit: Argument;
  sqrtPriceLimitII?: Argument; // Swap with hop
  isExactIn: Argument;
  recipient: Argument;
  deadline: Argument;
  clock: Argument;
  versioned: Argument;
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
  //   // Check first transaction. If its SplitCoin, then we know we need to
  //   // remove input of index 1, which is the split amount
  //   const txBlockInputs = cloneDeep(txBlock.blockData.inputs); // make a copy

  //   const tx0 = txBlock.blockData.transactions[0];

  //   if (tx0.kind === "SplitCoins") {
  //     txBlockInputs.splice(1, 1); // This removes the second element, idx:1
  //   }

  let simpleSwap = false;

  // Initialize a TransactionBlock
  const dcaBlock: TxBlock = {
    version: 1,
    transactions: [],
    inputs: [],
    gasConfig: txBlock.blockData.gasConfig,
    sender: txBlock.blockData.sender,
    expiration: txBlock.blockData.expiration,
  };

  // 1. Transaction to create Coin<tokenFrom>, i.e. input funds
  dcaBlock.transactions.push({
    kind: "MoveCall",
    target: "0x2::coin::zero",
    arguments: [],
    typeArguments: [tokenFrom],
  });

  const swapPatternRegex = new RegExp(Object.keys(swapPatterns).join("|"));

  txBlock.blockData.transactions.forEach((transaction) => {
    if (transaction.kind === "MoveCall" && transaction.target) {
      const swapMatch: RegExpExecArray | null = swapPatternRegex.exec(transaction.target);

      if (swapMatch) {
        const parts = transaction.target.split("::");
        const newTarget: `${string}::${string}::${string}` = `${DCA_CONFIG.DCA_CONTRACT}::${DCA_ROUTER}::${parts[2]}`;
        simpleSwap = parts[2] === "swap_a_b" || parts[2] === "swap_b_a";

        const swapParams: SwapParams = simpleSwap
          ? {
              pool: fromArgument(transaction.arguments[0] as Argument, inputIdx()),
              coin: { kind: "Result", index: 0 } as Argument,
              amount: fromArgument(transaction.arguments[2] as Argument, inputIdx()),
              amountThreshold: fromArgument(transaction.arguments[3] as Argument, inputIdx()),
              sqrtPriceLimit: fromArgument(transaction.arguments[4] as Argument, inputIdx()),
              isExactIn: fromArgument(transaction.arguments[5] as Argument, inputIdx()),
              recipient: fromArgument(transaction.arguments[6] as Argument, inputIdx()),
              deadline: fromArgument(transaction.arguments[7] as Argument, inputIdx()),
              clock: fromArgument(transaction.arguments[8] as Argument, inputIdx()),
              versioned: fromArgument(transaction.arguments[9] as Argument, inputIdx()),
              dca: { kind: "Input", value: dcaId, index: inputIdx(), type: "object" },
              gasGost: { kind: "Input", value: gasCost, index: inputIdx(), type: "pure" },
            }
          : {
              pool: fromArgument(transaction.arguments[0] as Argument, inputIdx()),
              poolII: fromArgument(transaction.arguments[1] as Argument, inputIdx()),
              coin: { kind: "Result", index: 0 } as Argument,
              amount: fromArgument(transaction.arguments[3] as Argument, inputIdx()),
              amountThreshold: fromArgument(transaction.arguments[4] as Argument, inputIdx()),
              sqrtPriceLimit: fromArgument(transaction.arguments[5] as Argument, inputIdx()),
              sqrtPriceLimitII: fromArgument(transaction.arguments[6] as Argument, inputIdx()),
              isExactIn: fromArgument(transaction.arguments[7] as Argument, inputIdx()),
              recipient: fromArgument(transaction.arguments[8] as Argument, inputIdx()),
              deadline: fromArgument(transaction.arguments[9] as Argument, inputIdx()),
              clock: fromArgument(transaction.arguments[10] as Argument, inputIdx()),
              versioned: fromArgument(transaction.arguments[11] as Argument, inputIdx()),
              dca: { kind: "Input", value: dcaId, index: inputIdx(), type: "object" },
              gasGost: { kind: "Input", value: gasCost, index: inputIdx(), type: "pure" },
            };

        const inputs = simpleSwap
          ? [
              swapParams.pool as Input,
              swapParams.amount as Input,
              swapParams.amountThreshold as Input,
              swapParams.sqrtPriceLimit as Input,
              swapParams.isExactIn as Input,
              swapParams.recipient as Input,
              swapParams.deadline as Input,
              swapParams.clock as Input,
              swapParams.versioned as Input,
              swapParams.dca as Input,
              swapParams.gasGost as Input,
            ]
          : [
              swapParams.pool as Input,
              swapParams.poolII as Input,
              swapParams.amount as Input,
              swapParams.amountThreshold as Input,
              swapParams.sqrtPriceLimit as Input,
              swapParams.sqrtPriceLimitII as Input,
              swapParams.isExactIn as Input,
              swapParams.recipient as Input,
              swapParams.deadline as Input,
              swapParams.clock as Input,
              swapParams.versioned as Input,
              swapParams.dca as Input,
              swapParams.gasGost as Input,
            ];

        const args: Arguments = simpleSwap
          ? [
              swapParams.pool,
              swapParams.coin,
              swapParams.amount,
              swapParams.amountThreshold,
              swapParams.sqrtPriceLimit,
              swapParams.isExactIn,
              swapParams.recipient,
              swapParams.deadline,
              swapParams.clock,
              swapParams.versioned,
              swapParams.dca,
              swapParams.gasGost,
            ]
          : [
              swapParams.pool,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              swapParams.poolII!,
              swapParams.coin,
              swapParams.amount,
              swapParams.amountThreshold,
              swapParams.sqrtPriceLimit,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              swapParams.sqrtPriceLimitII!,
              swapParams.isExactIn,
              swapParams.recipient,
              swapParams.deadline,
              swapParams.clock,
              swapParams.versioned,
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
