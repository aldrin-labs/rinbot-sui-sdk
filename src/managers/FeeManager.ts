import { CoinStruct } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import BigNumber from "bignumber.js";
import { SWAP_GAS_BUDGET } from "../providers/common";
import { isSuiCoinType } from "../providers/utils/isSuiCoinType";
import { GetTransactionType } from "../transactions/types";
import { BestRouteData, NonEmptyArray, Provider, SwapFee } from "./types";
import { getMergedCoinsStructure, mergeAllCoinsByStructure } from "./utils";

/**
 * @class FeeManager
 * @description Utility class for managing fees
 */
export class FeeManager {
  /**
   * Calculates the fee amount based on the fee percentage and amount.
   * @param {Object} params - The parameters object.
   * @param {string} params.feePercentage - The fee percentage should be provided as a percentage value
   * (e.g., "5%" for a 5% fee).
   * @param {string} params.amount - The amount as a string.
   * @param {number} params.tokenDecimals - The decimals of `coinType`.
   * @return {string} The calculated fee amount as a string.
   */
  public static calculateFeeAmountIn({
    feePercentage,
    amount,
    tokenDecimals,
  }: {
    feePercentage: string;
    amount: string;
    tokenDecimals: number;
  }): string {
    const feePercentageBig = new BigNumber(feePercentage);
    const amountBig = new BigNumber(amount);
    const feeAmount = amountBig.times(feePercentageBig).dividedBy(100).toFixed(tokenDecimals);
    const feeAmountInDecimals = new BigNumber(feeAmount).multipliedBy(10 ** tokenDecimals).toString();

    return feeAmountInDecimals;
  }

  /**
   * Calculates the net amount after deducting the fee.
   * @param {Object} params - The parameters object.
   * @param {string} params.feePercentage - The fee percentage should be provided as a percentage value
   * (e.g., "5%" for a 5% fee).
   * @param {string} params.amount - The amount as a string.
   * @param {number} params.tokenDecimals - The decimals of `coinType`.
   * @return {string} The net amount after deducting the fee.
   */
  public static calculateNetAmount({
    feePercentage,
    amount,
    tokenDecimals,
  }: {
    feePercentage: string;
    amount: string;
    tokenDecimals: number;
  }): string {
    const feeAmountIn = FeeManager.calculateFeeAmountIn({
      feePercentage,
      amount,
      tokenDecimals,
    });

    const amountRespectingFee = new BigNumber(amount)
      .multipliedBy(10 ** tokenDecimals)
      .minus(feeAmountIn)
      .dividedBy(10 ** tokenDecimals)
      .toString();

    return amountRespectingFee;
  }

  /**
   * @public
   * @method getFeeInSuiTransaction
   * @description Gets the transaction for deducting fees in SUI coin
   * from `signer` and transfer it to the `feeCollectorAddress`, based on the specified `feeAmountInMIST`.
   *
   * @return {Awaited<GetTransactionType>}
   * The transaction block and transaction result for the adding transaction.
   */
  public static getFeeInSuiTransaction({
    transaction,
    fees,
  }: {
    transaction?: TransactionBlock;
    fees: NonEmptyArray<{ feeAmount: string; feeCollectorAddress: string }>;
  }): Awaited<GetTransactionType> {
    const tx = transaction ?? new TransactionBlock();

    console.debug("\ntransactions before:", JSON.stringify(tx.blockData.transactions, null, 2));

    const [firstFeeObject, ...restFeeObjects] = fees;
    console.debug("firstFeeObject:", firstFeeObject);
    console.debug("restFeeObjects:", restFeeObjects);

    // Handle first fee object separately to define `txRes`. Otherwise TypeScript will say `txRes` is not defined.
    const [coin] = tx.splitCoins(tx.gas, [tx.pure(firstFeeObject.feeAmount)]);
    let txRes = tx.transferObjects([coin], tx.pure(firstFeeObject.feeCollectorAddress));

    restFeeObjects.forEach(({ feeAmount, feeCollectorAddress }) => {
      const [coin] = tx.splitCoins(tx.gas, [tx.pure(feeAmount)]);
      txRes = tx.transferObjects([coin], tx.pure(feeCollectorAddress));
    });

    console.debug("\ntransactions after:", JSON.stringify(tx.blockData.transactions, null, 2));

    return { tx, txRes };
  }

  /**
   * @public
   * @method getFeeInCoinTransaction
   * @description
   * Gets the transaction for deducting fees in any `coinType` from `signer` and transfer it
   * to the given `feeCollectorAddress`es, based on the specified `feeAmount`s.
   *
   * Merges all the coin objects into one, accounting already existing `MergeCoins` transactions in the given
   * `transaction` transaction block.
   *
   * @return {object} The transaction block, the transaction result for the adding transaction, and the `resultObject`,
   * all the coin objects were merged into.
   */
  public static getFeeInCoinTransaction({
    transaction,
    fee: { allCoinObjectsList, fees },
  }: {
    transaction?: TransactionBlock;
    fee: { fees: NonEmptyArray<{ feeAmount: string; feeCollectorAddress: string }>; allCoinObjectsList: CoinStruct[] };
  }): Awaited<GetTransactionType> & { resultObject: string } {
    const tx = transaction ?? new TransactionBlock();

    console.debug("\ntransactions before:", JSON.stringify(tx.blockData.transactions, null, 2));

    const mergedCoinsStructure = getMergedCoinsStructure({ tx, coinObjects: allCoinObjectsList });
    console.debug("\nmergedCoinsStructure:", JSON.stringify(mergedCoinsStructure, null, 2));

    let resultObject: string;

    if ("noMerges" in mergedCoinsStructure) {
      // If no `MergeCoins` transactions with the coin objects exist, merge all the coin objects into the first one
      const coinObjectIds = allCoinObjectsList.map((obj) => obj.coinObjectId);
      const [firstCoinObjectId, ...restCoinObjectIds] = coinObjectIds;

      resultObject = firstCoinObjectId;

      if (restCoinObjectIds.length !== 0) {
        tx.mergeCoins(
          tx.object(resultObject),
          restCoinObjectIds.map((objectId) => tx.object(objectId)),
        );
      }
    } else {
      const { destinationObject } = mergeAllCoinsByStructure({ transaction: tx, structure: mergedCoinsStructure });

      resultObject = destinationObject;
    }

    const [firstFeeObject, ...restFeeObjects] = fees;

    // Transfering fees to corresponding fee collectors.
    // Handling the first fee object separately to define `txRes`. Otherwise TypeScript will say `txRes` is not defined.
    const [coin] = tx.splitCoins(tx.object(resultObject), [tx.pure(firstFeeObject.feeAmount)]);
    let txRes = tx.transferObjects([coin], tx.pure(firstFeeObject.feeCollectorAddress));

    restFeeObjects.forEach(({ feeAmount, feeCollectorAddress }) => {
      const [coin] = tx.splitCoins(tx.object(resultObject), [tx.pure(feeAmount)]);
      txRes = tx.transferObjects([coin], tx.pure(feeCollectorAddress));
    });

    console.debug("\ntransactions after:", JSON.stringify(tx.blockData.transactions, null, 2));

    return { tx, txRes, resultObject };
  }

  /**
   * Adds the fees charging transactions to a provided `transaction` transaction block.
   *
   * @return {Awaited<GetTransactionType>} An object containing the transaction block with the fees transactions,
   * and the transaction result of the last transaction modification.
   */
  public static addFeesTransactionsToTransactionBlock({
    fee,
    transaction,
    tokenFrom,
  }: {
    fee: SwapFee;
    transaction: TransactionBlock;
    tokenFrom: string;
  }): Awaited<GetTransactionType> {
    const { fees, tokenFromCoinObjects: coinObjects } = fee;
    const coinObjectsProvided = coinObjects !== undefined && coinObjects.length !== 0;

    if (isSuiCoinType(tokenFrom)) {
      const { tx, txRes } = FeeManager.getFeeInSuiTransaction({
        transaction,
        fees,
      });

      return { tx, txRes };
    } else if (!isSuiCoinType(tokenFrom) && coinObjectsProvided) {
      const { tx, txRes } = FeeManager.getFeeInCoinTransaction({
        transaction,
        fee: { fees: fee.fees, allCoinObjectsList: coinObjects },
      });

      return { tx, txRes };
    } else {
      console.warn(
        "[addFeesTransactionsToTransactionBlock] Unexpected behaviour: params for fees object " +
          "are not correctly provided",
      );

      throw new Error("Unexpected params addFeesTransactionsToTransactionBlock");
    }
  }

  /**
   * First gets the transaction block with the fees charging transactions, and then pass it and other
   * required params to the `getSwapTransactionDoctored`.
   *
   * @return {TransactionBlock} The transaction block, containing the fees charging transactions and
   * the swap transactions.
   */
  public static async getTransactionWithFeesBeforeSwap({
    fees,
    coinObjects,
    maxOutputProvider,
    route,
    signerAddress,
    slippagePercentage,
  }: {
    fees: SwapFee["fees"];
    coinObjects: CoinStruct[];
    maxOutputProvider: Provider;
    route: BestRouteData["route"];
    signerAddress: string;
    slippagePercentage: number;
  }): Promise<TransactionBlock> {
    const { tx, resultObject } = FeeManager.getFeeInCoinTransaction({
      fee: { fees, allCoinObjectsList: coinObjects },
    });

    let doctoredMethodParams;

    if (maxOutputProvider.providerName === "Turbos") {
      doctoredMethodParams = {
        route,
        publicKey: signerAddress,
        slippagePercentage,
        txb: tx,
        inputCoinIds: [resultObject],
      };
    } else if (maxOutputProvider.providerName === "Flowx") {
      doctoredMethodParams = {
        route,
        publicKey: signerAddress,
        slippagePercentage,
        resultObject,
        txb: tx,
      };
    } else {
      doctoredMethodParams = {
        route,
        publicKey: signerAddress,
        slippagePercentage,
        txb: tx,
      };
    }

    const transaction = await maxOutputProvider.getSwapTransactionDoctored(doctoredMethodParams);

    // This is the limitation because some of the providers
    // doesn't set/calculate gas budger for their transactions properly.
    // We can do the simulation on our side, but it will slowdown the swap
    transaction.setGasBudget(SWAP_GAS_BUDGET);

    console.debug("\ntransactions after routing:", JSON.stringify(transaction.blockData.transactions, null, 2));

    return transaction;
  }

  /**
   * First gets the transaction block with the swap transactions, and then adds the fees charging transactions
   * to it.
   *
   * @return {TransactionBlock} The transaction block, containing the swap transactions and
   * the fees charging transactions.
   */
  public static async getTransactionWithFeesAfterSwap({
    fee,
    tokenFrom,
    maxOutputProvider,
    route,
    signerAddress,
    slippagePercentage,
  }: {
    fee: SwapFee;
    tokenFrom: string;
    maxOutputProvider: Provider;
    route: BestRouteData["route"];
    signerAddress: string;
    slippagePercentage: number;
  }) {
    const transaction = await maxOutputProvider.getSwapTransaction({
      route,
      publicKey: signerAddress,
      slippagePercentage,
    });

    // This is the limitation because some of the providers
    // doesn't set/calculate gas budger for their transactions properly.
    // We can do the simulation on our side, but it will slowdown the swap
    transaction.setGasBudget(SWAP_GAS_BUDGET);

    FeeManager.addFeesTransactionsToTransactionBlock({ transaction, fee, tokenFrom });

    return transaction;
  }
}
