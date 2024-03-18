import { CoinStruct } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { GetTransactionType } from "../transactions/types";
import BigNumber from "bignumber.js";

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
   * @return {GetTransactionType}
   * A promise that resolves to the transaction block and transaction result for the adding transaction.
   */
  public static async getFeeInSuiTransaction({
    transaction,
    fee: { feeAmountInMIST, feeCollectorAddress },
  }: {
    transaction?: TransactionBlock;
    fee: { feeAmountInMIST: string; feeCollectorAddress: string };
  }): GetTransactionType {
    const tx = transaction ?? new TransactionBlock();
    const [coin] = tx.splitCoins(tx.gas, [tx.pure(feeAmountInMIST)]);
    const txRes = tx.transferObjects([coin], tx.pure(feeCollectorAddress));

    return { tx, txRes };
  }

  /**
   * @public
   * @method getFeeInCoinTransaction
   * @description Gets the transaction for deducting fees in any `coinType`
   * from `signer` and transfer it to the `feeCollectorAddress`, based on the specified `feeAmount`.
   *
   * @return {GetTransactionType}
   * A promise that resolves to the transaction block and transaction result for the adding transaction.
   */
  public static getFeeInCoinTransaction({
    transaction,
    fee: { feeAmount, feeCollectorAddress, allCoinObjectsList },
  }: {
    transaction?: TransactionBlock;
    fee: { feeAmount: string; feeCollectorAddress: string; allCoinObjectsList: CoinStruct[] };
  }) {
    const tx = transaction ?? new TransactionBlock();

    const sourceCoinObjectId = allCoinObjectsList[0].coinObjectId;
    const isMergeCoinsRequired = allCoinObjectsList.length > 1;

    if (isMergeCoinsRequired) {
      console.warn("[getFeeInCoinTransaction] [isMergeCoinsRequired]");
      const coinObjectIdsToMerge = allCoinObjectsList.slice(1).map((el) => el.coinObjectId);

      tx.mergeCoins(
        tx.object(sourceCoinObjectId),
        coinObjectIdsToMerge.map((el) => tx.object(el)),
      );
    }

    const coinSplitTxResult = tx.splitCoins(tx.object(sourceCoinObjectId), [tx.pure(feeAmount)]);
    const txRes = tx.transferObjects([coinSplitTxResult], tx.pure(feeCollectorAddress));

    return { tx, txRes };
  }
}
