import { TransactionBlock } from "@mysten/sui.js/transactions";
import { TxBlock, Transaction, Arguments, Argument, Input } from "../txBlock";
import { DCA_CONTRACT, fromArgument } from "../utils";

const DCA_ROUTER = "flow_x";
let InputIndex = 0;

const swapPatterns: Record<string, `${string}::${string}::${string}`> = {
  ".*::router::swap_exact_output$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_exact_output"}`,
  ".*::router::swap_exact_output_doublehop$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_exact_output_doublehop"}`,
  ".*::router::swap_exact_output_triplehop$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_exact_output_triplehop"}`,
  ".*::router::swap_exact_input$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_exact_input"}`,
  ".*::router::swap_exact_input_doublehop$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_exact_input_doublehop"}`,
  ".*::router::swap_exact_input_triplehop$": `${DCA_CONTRACT}::${DCA_ROUTER}::${"swap_exact_input_triplehop"}`,
};

type SwapParams = {
  clock: Argument;
  pools: Argument;
  inputFunds: Argument;
  minOutput?: Argument; // ExactIn
  maxInputAmount?: Argument; // ExactOut
  exactOutput?: Argument; // ExactOut
  recipient: Argument;
  sqrtPrice: Argument;
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
  let isExactIn = false;

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
        const newTarget: `${string}::${string}::${string}` = `${DCA_CONTRACT}::${DCA_ROUTER}::${parts[2]}`;
        isExactIn = parts[2].includes("exact_input");

        const swapParams: SwapParams = isExactIn
          ? {
              clock: fromArgument(transaction.arguments[0] as Argument, inputIdx()),
              pools: fromArgument(transaction.arguments[1] as Argument, inputIdx()),
              inputFunds: { kind: "Result", index: 0 } as Argument,
              minOutput: fromArgument(transaction.arguments[3] as Argument, inputIdx()),
              recipient: fromArgument(transaction.arguments[4] as Argument, inputIdx()),
              sqrtPrice: fromArgument(transaction.arguments[5] as Argument, inputIdx()),
              dca: { kind: "Input", value: dcaId, index: inputIdx(), type: "object" },
              gasGost: { kind: "Input", value: gasCost, index: inputIdx(), type: "pure" },
            }
          : {
              clock: fromArgument(transaction.arguments[0] as Argument, inputIdx()),
              pools: fromArgument(transaction.arguments[1] as Argument, inputIdx()),
              inputFunds: { kind: "Result", index: 0 } as Argument,
              maxInputAmount: fromArgument(transaction.arguments[3] as Argument, inputIdx()),
              exactOutput: fromArgument(transaction.arguments[4] as Argument, inputIdx()),
              recipient: fromArgument(transaction.arguments[5] as Argument, inputIdx()),
              sqrtPrice: fromArgument(transaction.arguments[6] as Argument, inputIdx()),
              dca: { kind: "Input", value: dcaId, index: inputIdx(), type: "object" },
              gasGost: { kind: "Input", value: gasCost, index: inputIdx(), type: "pure" },
            };

        const inputs = isExactIn
          ? [
              swapParams.clock as Input,
              swapParams.pools as Input,
              swapParams.minOutput as Input,
              swapParams.recipient as Input,
              swapParams.sqrtPrice as Input,
              swapParams.dca as Input,
              swapParams.gasGost as Input,
            ]
          : [
              swapParams.clock as Input,
              swapParams.pools as Input,
              swapParams.maxInputAmount as Input,
              swapParams.exactOutput as Input,
              swapParams.recipient as Input,
              swapParams.sqrtPrice as Input,
              swapParams.dca as Input,
              swapParams.gasGost as Input,
            ];

        const args: Arguments = isExactIn
          ? [
              swapParams.clock,
              swapParams.pools,
              swapParams.inputFunds,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              swapParams.minOutput!,
              swapParams.recipient,
              swapParams.sqrtPrice,
              swapParams.dca,
              swapParams.gasGost,
            ]
          : [
              swapParams.clock,
              swapParams.pools,
              swapParams.inputFunds,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              swapParams.maxInputAmount!,
              // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
              swapParams.exactOutput!,
              swapParams.recipient,
              swapParams.sqrtPrice,
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
