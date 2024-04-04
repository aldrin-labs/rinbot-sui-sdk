/* eslint-disable require-jsdoc */
import { SuiClient } from "@mysten/sui.js/client";
import { Keypair, SignatureWithBytes } from "@mysten/sui.js/cryptography";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { verifyPersonalMessage } from "@mysten/sui.js/verify";
import { ObjectArg } from "../../transactions/types";
import { obj } from "../../transactions/utils";
import { BoostedClaimCapType, DecodedAmount, hexStringToByteArray, isBoostedClaimCap } from "./utils";
import BigNumber from "bignumber.js";
import { SUI_DENOMINATOR } from "../..";
import { getAllOwnedObjects } from "../../providers/utils/getAllOwnedObjects";
import { bcs } from "@mysten/sui.js/bcs";
import { SUI_CLOCK_OBJECT_ID } from "@mysten/sui.js/utils";

/**
 * @class RefundManagerSingleton
 * @description
 * This class encapsulates the business logic for a Refund smart contract.
 */
export class RefundManagerSingleton {
  public static SIMLATION_ACCOUNT_ADDRESS = "0xca9711c3de3ef474209ebd920b894e4d374ff09e210bc31cbd2d266f7bff90ca";
  public static REFUND_PACKAGE_ADDRESS = "0x691f8797d421028d476a62e5680d85a2c666d9ca5f16c5036d316b7c5b9c4a22";
  public static REFUND_PACKAGE_ADDRESS_READ = "";
  public static REFUND_POOL_OBJECT_ID = "0xc4d53c30dfcff1ce3b18f08114a6016552625d3f647ebb24fbde34175f373354";
  public static REFUND_POOL_PUBLISHER_OBJECT_ID = "0xcfdd94c59c6a811d6b2fe3a927ff97871ef6a7fcc643e5880fe015b37ccbf12e";
  public static REFUND_BOOSTED_CLAIM_CAP_STRUCT_TYPE_NAME = "BoostedClaimCap";
  public static REFUND_MODULE_NAME = "refund";
  public static REFUND_BOOSTED_MODULE_NAME = "booster";
  // eslint-disable-next-line max-len
  public static BOOSTER_OBJECT_TYPE = `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::${RefundManagerSingleton.REFUND_BOOSTED_MODULE_NAME}::${this.REFUND_BOOSTED_CLAIM_CAP_STRUCT_TYPE_NAME}`;

  public static REFUND_GAS_BUGET = 50_000_000;
  public static REFUND_GAS_BUDGET_ADDRESS_ADDITION = 1_000_000_000;

  private static _instance: RefundManagerSingleton;
  private provider: SuiClient;

  /**
   * Constructs a new instance of the SuiProvider class with the provided SUI provider URL.
   *
   * @private
   * @constructor
   * @param {string} suiProviderUrl - The URL of the SUI provider.
   */
  private constructor(suiProviderUrl: string) {
    this.provider = new SuiClient({ url: suiProviderUrl });
  }

  /**
   * @public
   * @method getInstance
   * @description Gets the singleton instance of RefundManagerSingleton.
   * @param {string} [suiProviderUrl] - Url of SUI provider.
   * @return {RefundManagerSingleton} The singleton instance of RefundManagerSingleton.
   */
  public static getInstance(suiProviderUrl?: string): RefundManagerSingleton {
    if (!RefundManagerSingleton._instance) {
      if (suiProviderUrl === undefined) {
        throw new Error("[DCAManager] SUI provider url is required in arguments to create DCAManager instance.");
      }

      const instance = new RefundManagerSingleton(suiProviderUrl);
      RefundManagerSingleton._instance = instance;
    }

    return RefundManagerSingleton._instance;
  }

  public static getAddAddressesTransaction({
    publisherObjectId,
    poolObjectId,
    addressesList,
    amountsList,

    transaction,
  }: {
    publisherObjectId: ObjectArg;
    poolObjectId: ObjectArg;
    addressesList: string[];
    amountsList: string[];

    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::add_addresses`,
      typeArguments: [],
      arguments: [obj(tx, publisherObjectId), obj(tx, poolObjectId), tx.pure(addressesList), tx.pure(amountsList)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUDGET_ADDRESS_ADDITION);

    return { tx, txRes };
  }

  public static getClaimRefundTransaction({
    poolObjectId,
    clock = SUI_CLOCK_OBJECT_ID,
    transaction,
  }: {
    poolObjectId: ObjectArg;
    clock?: ObjectArg;
    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::claim_refund`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId), obj(tx, clock)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public static startFundingPhase({
    publisherObjectId,
    poolObjectId,
    timeoutMilliseconds,
    clock,

    transaction,
  }: {
    publisherObjectId: ObjectArg;
    poolObjectId: ObjectArg;
    timeoutMilliseconds: number;
    clock: ObjectArg;

    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::start_funding_phase`,
      typeArguments: [],
      arguments: [obj(tx, publisherObjectId), obj(tx, poolObjectId), tx.pure(timeoutMilliseconds), obj(tx, clock)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public static startClaimPhase({
    poolObjectId,
    clock = SUI_CLOCK_OBJECT_ID,

    transaction,
  }: {
    poolObjectId: ObjectArg;
    clock?: ObjectArg;

    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::start_claim_phase`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId), obj(tx, clock)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public static startReclaimPhase({
    poolObjectId,
    clock,

    transaction,
  }: {
    poolObjectId: ObjectArg;
    clock: ObjectArg;

    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::start_reclaim_phase`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId), obj(tx, clock)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public async getCurrentRefundPhase({
    poolObjectId,
    transaction,
  }: {
    poolObjectId: string;
    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::phase`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    const res = await this.provider.devInspectTransactionBlock({
      sender: RefundManagerSingleton.SIMLATION_ACCOUNT_ADDRESS,
      transactionBlock: tx,
    });

    if (!res.results) {
      throw new Error("No results found for the request phase request");
    }

    const returnValues = res.results[0].returnValues;

    if (!returnValues) {
      throw new Error("Return values are undefined");
    }

    const phase = returnValues[0][0][0];

    return phase;
  }

  public async getUnclaimedAddressesList({
    poolObjectId,
    transaction,
  }: {
    poolObjectId: string;
    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::unclaimed`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    const res = await this.provider.devInspectTransactionBlock({
      sender: RefundManagerSingleton.SIMLATION_ACCOUNT_ADDRESS,
      transactionBlock: tx,
    });

    if (!res.results) {
      throw new Error("No results found for the request phase request");
    }

    const returnValues = res.results[0].returnValues;

    if (!returnValues) {
      throw new Error("Return values are undefined");
    }

    const table = returnValues[0][0];

    return table;
  }

  public async getClaimAmountNormal({
    poolObjectId,
    affectedAddress,
  }: {
    poolObjectId: string;
    affectedAddress: string;
  }) {
    const tx = new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::amount_to_claim`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId), tx.pure(affectedAddress)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    const res = await this.provider.devInspectTransactionBlock({
      sender: RefundManagerSingleton.SIMLATION_ACCOUNT_ADDRESS,
      transactionBlock: tx,
    });

    if (!res.results) {
      throw new Error("No results found for the request phase request");
    }

    const returnValues = res.results[0].returnValues;

    if (!returnValues) {
      throw new Error("Return values are undefined");
    }

    const rawAmountBytes = returnValues[0][0];
    const decoded: DecodedAmount = bcs.de("Option<u64>", new Uint8Array(rawAmountBytes));
    let amount: string;

    if ("Some" in decoded && decoded.Some) {
      amount = decoded.Some;
    } else if ("None" in decoded && decoded.None === true) {
      amount = "0"; // Use "0" if decoded.None is true
    } else {
      throw new Error("Decoded amount has an invalid shape");
    }

    const amountInMist = amount.toString();
    const amountInSui = new BigNumber(amount).div(SUI_DENOMINATOR).toString();

    return { mist: amountInMist, sui: amountInSui };
  }

  public async getClaimAmountBoosted({
    poolObjectId,
    affectedAddress,
  }: {
    poolObjectId: string;
    affectedAddress: string;
  }) {
    const tx = new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::amount_to_claim_boosted`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId), tx.pure(affectedAddress)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    const res = await this.provider.devInspectTransactionBlock({
      sender: RefundManagerSingleton.SIMLATION_ACCOUNT_ADDRESS,
      transactionBlock: tx,
    });

    if (!res.results) {
      throw new Error("No results found for the request phase request");
    }

    const returnValues = res.results[0].returnValues;

    if (!returnValues) {
      throw new Error("Return values are undefined");
    }

    const rawAmountBytes = returnValues[0][0];
    const decoded: DecodedAmount = bcs.de("Option<u64>", new Uint8Array(rawAmountBytes));
    let amount: string;

    if ("Some" in decoded && decoded.Some) {
      amount = decoded.Some;
    } else if ("None" in decoded && decoded.None === true) {
      amount = "0"; // Use "0" if decoded.None is true
    } else {
      throw new Error("Decoded amount has an invalid shape");
    }

    const amountInMist = amount.toString();
    const amountInSui = new BigNumber(amount).div(SUI_DENOMINATOR).toString();

    return { mist: amountInMist, sui: amountInSui };
  }

  public async getClaimAmount({ poolObjectId, affectedAddress }: { poolObjectId: string; affectedAddress: string }) {
    const [normalRefund, boostedRefund] = await Promise.all([
      this.getClaimAmountNormal({ poolObjectId, affectedAddress }),
      this.getClaimAmountBoosted({ poolObjectId, affectedAddress }),
    ]);

    return { normalRefund, boostedRefund };
  }

  public async getBoostedClaimCap({ ownerAddress, newAddress }: { ownerAddress: string; newAddress: string }): Promise<{
    boostedClaimCapObjectId: string | null;
    isAnyBoostedClaimCapExists: boolean;
    boostedClaimCapNotAssociatedWithNewAddressObjectId: string | null;
  }> {
    const allBoostedClaimCapObjects = await getAllOwnedObjects({
      provider: this.provider,
      options: {
        owner: ownerAddress,
        // TODO: Check for correctness
        // Because this might not work in case of upgraded package id, so as a solution,
        // we need to use another filter, which would allow to fetch `BoostedClaimCap` for multiple package addresses
        filter: { StructType: RefundManagerSingleton.BOOSTER_OBJECT_TYPE },
        options: {
          showContent: true,
          showType: true,
        },
      },
    });

    const allBoostedClaimCapListRaw = allBoostedClaimCapObjects as unknown;

    if (!Array.isArray(allBoostedClaimCapListRaw)) {
      throw new Error("[getBoostedClaimCap] Wrong shape returned for get boosted claim cap request");
    }

    const listOfObjectClaimCaps = allBoostedClaimCapListRaw.filter((el): el is BoostedClaimCapType =>
      isBoostedClaimCap(el),
    );

    // We should make sure that boosted claim cap is related to the new address that was provided
    // Otherwise, ignoring the new address, we'll return the boosted claim cap
    // which might not be related to the client
    const boostedClaimCapsAssociatedWithNewAddress = listOfObjectClaimCaps.filter(
      (el) => el.data.content.fields.new_address === newAddress,
    );

    //
    const boostedClaimCapsNotAssociatedWithNewAddress = listOfObjectClaimCaps.filter(
      (el) => el.data.content.fields.new_address !== newAddress,
    );

    const isAnyBoostedClaimCapExists =
      listOfObjectClaimCaps.length > 0 || boostedClaimCapsAssociatedWithNewAddress.length > 0;

    // We can pick any of the associated with the user and new address boosted claim cap
    const boostedClaimCapObject = boostedClaimCapsAssociatedWithNewAddress[0];

    const boostedClaimCapNotAssociatedWithNewAddress = boostedClaimCapsNotAssociatedWithNewAddress[0];

    // We should return related to new address
    return {
      boostedClaimCapObjectId: boostedClaimCapObject?.data?.objectId ?? null,
      isAnyBoostedClaimCapExists,
      boostedClaimCapNotAssociatedWithNewAddressObjectId:
        boostedClaimCapNotAssociatedWithNewAddress?.data?.objectId ?? null,
    };
  }

  public static getReturnBoosterCapTransaction({
    transaction,
    boostedClaimCap,
    poolObjectId,
  }: {
    transaction?: TransactionBlock;
    boostedClaimCap: ObjectArg;
    poolObjectId: ObjectArg;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::booster::return_booster_cap`,
      typeArguments: [],
      arguments: [obj(tx, boostedClaimCap), obj(tx, poolObjectId)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public static getReclaimFundsTransaction({ poolObjectId }: { poolObjectId: ObjectArg }) {
    const tx = new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::refund::reclaim_funds`,
      typeArguments: [],
      arguments: [obj(tx, poolObjectId)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public static getAllowBoostedClaim({
    publisherObjectId,
    poolObjectId,
    affectedAddress,
    newAddress,

    transaction,
  }: {
    publisherObjectId: string;
    poolObjectId: string;
    affectedAddress: string;
    newAddress: string;

    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::booster::allow_boosted_claim`,
      typeArguments: [],
      arguments: [obj(tx, publisherObjectId), obj(tx, poolObjectId), tx.pure(affectedAddress), tx.pure(newAddress)],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public static getClaimRefundBoostedTransaction({
    boostedClaimCap,
    poolObjectId,
    clock = SUI_CLOCK_OBJECT_ID,
    userRinbotRefundDestinationAddress,

    transaction,
  }: {
    boostedClaimCap: ObjectArg;
    poolObjectId: ObjectArg;
    clock?: ObjectArg;
    userRinbotRefundDestinationAddress: ObjectArg;

    transaction?: TransactionBlock;
  }) {
    const tx = transaction ?? new TransactionBlock();

    const txRes = tx.moveCall({
      target: `${RefundManagerSingleton.REFUND_PACKAGE_ADDRESS}::booster::claim_refund_boosted`,
      typeArguments: [],
      arguments: [
        obj(tx, boostedClaimCap),
        obj(tx, poolObjectId),
        tx.pure(userRinbotRefundDestinationAddress),
        obj(tx, clock),
      ],
    });

    tx.setGasBudget(RefundManagerSingleton.REFUND_GAS_BUGET);

    return { tx, txRes };
  }

  public static getMessageForBoostedRefund({
    poolObjectId,
    affectedAddress,
    newAddress,
  }: {
    poolObjectId: string;
    affectedAddress: string;
    newAddress: string;
  }) {
    // Convert string values to hexadecimal buffers inline
    const affectedAddressBytes = hexStringToByteArray(affectedAddress);
    const newAddressBytes = hexStringToByteArray(newAddress);
    const poolIdBytes = hexStringToByteArray(poolObjectId);

    // Construct the message by concatenating the byte arrays
    const msg = new Uint8Array(affectedAddressBytes.length + newAddressBytes.length + poolIdBytes.length);
    msg.set(affectedAddressBytes, 0);
    msg.set(newAddressBytes, affectedAddressBytes.length);
    msg.set(poolIdBytes, affectedAddressBytes.length + newAddressBytes.length);

    return { bytes: msg, hex: Buffer.from(msg).toString("hex") };
  }

  public static async signMessageSignatureForBoostedRefund({
    keypair,
    poolObjectId,
    affectedAddress,
    newAddress,
  }: {
    keypair: Keypair;
    poolObjectId: string;
    affectedAddress: string;
    newAddress: string;
  }): Promise<SignatureWithBytes> {
    const message = RefundManagerSingleton.getMessageForBoostedRefund({ poolObjectId, affectedAddress, newAddress });
    const signedMessage = await keypair.signPersonalMessage(message.bytes);

    return signedMessage;
  }

  /*
  @throws an error in case signature is not valid
  */
  public static async verifySignedMessageForBoostedRefund({
    poolObjectId,
    affectedAddress,
    newAddress,

    signedMessageSignature,
  }: {
    poolObjectId: string;
    newAddress: string;
    affectedAddress: string;

    signedMessageSignature: string;
  }) {
    const targetMessage = RefundManagerSingleton.getMessageForBoostedRefund({
      poolObjectId,
      affectedAddress,
      newAddress,
    });

    const signedPublicKey = await verifyPersonalMessage(targetMessage.bytes, signedMessageSignature);

    if (affectedAddress !== signedPublicKey.toSuiAddress()) {
      throw new Error("Affected address is different from the signer of the message");
    }

    return true;
  }
}
