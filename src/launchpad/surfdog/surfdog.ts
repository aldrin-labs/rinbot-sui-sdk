/* eslint-disable require-jsdoc */
import { SuiClient } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { fromB64 } from "@mysten/sui.js/utils";
import {
  buy as createBuyTicketTransaction,
  createUserState as createUserStateTransaction,
} from "./__generated__/meme/meme/functions";
import { State, UserState } from "./__generated__/meme/meme/structs";
import { SURF } from "./__generated__/meme/surf/structs";
import { SurfDogConfig } from "./types";

export class SurfdogLaunchpadSingleton {
  private static _instance: SurfdogLaunchpadSingleton;
  private provider: SuiClient;
  private config: SurfDogConfig;

  /**
   * Constructs a new instance of the SuiProvider class with the provided SUI provider URL.
   *
   * @private
   * @constructor
   * @param {string} suiProviderUrl - The URL of the SUI provider.
   * @param {SurfDogConfig} [config] - Config for SurfDog
   */
  private constructor(suiProviderUrl: string, config: SurfDogConfig) {
    this.provider = new SuiClient({ url: suiProviderUrl });
    this.config = config;
  }

  /**
   * @public
   * @method getInstance
   * @description Gets the singleton instance of SurfdogLaunchpadSingleton.
   * @param {string} [suiProviderUrl] - Url of SUI provider.
   * @param {SurfDogConfig} [config] - Config for SurfDog
   * @return {SurfdogLaunchpadSingleton} The singleton instance of SurfdogLaunchpadSingleton.
   */
  public static getInstance(suiProviderUrl?: string, config?: SurfDogConfig): SurfdogLaunchpadSingleton {
    if (!SurfdogLaunchpadSingleton._instance) {
      if (suiProviderUrl === undefined) {
        throw new Error(
          "[SurfdogLaunchpadSingleton] SUI provider url is required in arguments to create SurfdogLaunchpad instance.",
        );
      }

      if (config === undefined) {
        throw new Error(
          "[SurfdogLaunchpadSingleton] config is required in arguments to create SurfdogLaunchpad instance.",
        );
      }

      const instance = new SurfdogLaunchpadSingleton(suiProviderUrl, config);
      SurfdogLaunchpadSingleton._instance = instance;
    }

    return SurfdogLaunchpadSingleton._instance;
  }

  public async getUserState(publicKey: string) {
    // TODO: Might be dangeours in case user has more than 50 user states
    const object = await this.provider.getOwnedObjects({
      filter: { StructType: UserState.$typeName },
      options: {
        showContent: true,
        showOwner: true,
        showType: true,
        showStorageRebate: true,
        showBcs: true,
      },
      owner: publicKey,
    });

    if (!(Array.isArray(object.data) && object.data[0] && object.data[0].data && object.data[0].data.bcs)) {
      console.warn(`User ${publicKey} does not have state objects`);

      return null;
    }

    const userStateBcs = object.data[0].data.bcs;

    const isBcsBytesInStateBcs = "bcsBytes" in userStateBcs;
    if (!isBcsBytesInStateBcs) {
      console.debug("[SurfdogLaunchpadSingleton.getUserState] bcsBytes does not exist stateBcs", userStateBcs);
      throw new Error("bcsBytes does not exist stateBcs");
    }

    const userState = UserState.fromBcs(fromB64(userStateBcs.bcsBytes));
    const userGameState = {
      allTickets: userState.allTickets,
      id: userState.id,
      wonTickets: userState.wonTickets,
    };

    return userGameState;
  }

  public async getGameState() {
    const object = await this.provider.getObject({
      id: this.config.GAME_ADDRESS,
      options: {
        showBcs: true,
        showContent: true,
      },
    });

    if (!object.data) {
      console.debug("[SurfdogLaunchpadSingleton.getGameState] object.data", object.data);
      throw new Error("Failed to fetch game state: object.data is empty");
    }

    const stateBcs = object.data.bcs;
    if (!stateBcs) {
      console.debug("[SurfdogLaunchpadSingleton.getGameState] State does not exist bsc", stateBcs);
      throw new Error("State does not exist bsc");
    }

    const isBcsBytesInStateBcs = "bcsBytes" in stateBcs;
    if (!isBcsBytesInStateBcs) {
      console.debug("[SurfdogLaunchpadSingleton.getGameState] bcsBytes does not exist stateBcs", stateBcs);
      throw new Error("bcsBytes does not exist stateBcs");
    }

    const globalState = State.fromBcs(State.phantom(SURF.phantom()), fromB64(stateBcs.bcsBytes));
    const globalStateParsed = {
      allTickets: globalState.allTickets,
      startTimestamp: globalState.start,
      ticketPrice: globalState.ticketPrice,
      tokensPerTicket: globalState.tokensPerTicket,
      winningTickets: globalState.wonTickets,
      balanceLeft: globalState.balance.value,
    };

    return globalStateParsed;
  }

  public async createUserState() {
    const tx = new TransactionBlock();

    const userStateTxRes = createUserStateTransaction(tx);

    return { tx, txRes: userStateTxRes };
  }

  public async buyTicket({ ticketPrice, userStateId }: { ticketPrice: string; userStateId: string }) {
    const tx = new TransactionBlock();

    const [coin] = tx.splitCoins(tx.gas, [tx.pure(ticketPrice)]);

    const buyUserTicketTxRes = createBuyTicketTransaction(tx, SURF.$typeName, {
      clock: this.config.CLOCK_ADDRESS,
      state: this.config.GAME_ADDRESS,
      userState: userStateId,
      payment: coin,
    });

    return { tx, txRes: buyUserTicketTxRes };
  }
}