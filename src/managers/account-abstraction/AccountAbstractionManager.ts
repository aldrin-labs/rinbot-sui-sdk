/**
 * @class AccountAbstractionManager
 * @description This class encapsulates the business logic for an Account Abstraction smart contract.
 */
export class AccountAbstractionManager {
  private static _instance: AccountAbstractionManager;

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
}
