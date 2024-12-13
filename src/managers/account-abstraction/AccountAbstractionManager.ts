/* eslint-disable require-jsdoc */

import { TransactionBlock } from "@mysten/sui.js/transactions";

/**
 * @class AccountAbstractionManager
 * @description This class encapsulates the business logic for an Account Abstraction smart contract.
 */
export class AccountAbstractionManager {
  private static _instance: AccountAbstractionManager;

  public static AA_PACKAGE_ADDRESS = "";
  public static ACCOUNT_CREATION_GAS_BUDGET = 50_000_000;

  /**
   * @public
   * @method getInstance
   * @description Gets the singleton instance of AccountAbstractionManager.
   * @return {AccountAbstractionManager} The singleton instance of AccountAbstractionManager.
   */
  public static getInstance(): AccountAbstractionManager {
    if (!AccountAbstractionManager._instance) {
      const instance = new AccountAbstractionManager();
      AccountAbstractionManager._instance = instance;
    }

    return AccountAbstractionManager._instance;
  }

  public static getCreateNewAccountTransaction({
    owner,
    transaction,
  }: {
    owner: string;
    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${AccountAbstractionManager.AA_PACKAGE_ADDRESS}::account::new_as_delegate`,
      typeArguments: [],
      arguments: [tx.pure(owner)],
    });

    tx.setGasBudget(AccountAbstractionManager.ACCOUNT_CREATION_GAS_BUDGET);

    return { tx, txRes };
  }
}
