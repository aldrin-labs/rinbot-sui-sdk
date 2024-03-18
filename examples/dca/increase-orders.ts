import { SuiClient } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { DCAManagerSingleton } from "../../src/managers/dca/DCAManager";
import { keypair, signAndExecuteTransaction, user } from "../common";
import { delegateeKeypair } from "./common";

// yarn ts-node examples/dca/increase-orders.ts
export const increaseOrders = async () => {
  const suiProviderUrl = "https://fullnode.mainnet.sui.io";
  const provider = new SuiClient({ url: suiProviderUrl });
  const transaction = new TransactionBlock();
  const sender = keypair.toSuiAddress();

  const dcaInstance = DCAManagerSingleton.getInstance(suiProviderUrl);
  const dcas = await dcaInstance.getDCAsByUser({ publicKey: sender });
  const desiredObjectId = "0x4d0316c3a32221e175ab2bb9abe360ed1d4498806dc50984ab67ce0ba90f2842";

  const currentDCAData = dcas.find((el) => el.fields.id.id === desiredObjectId);
  console.debug("currentDCAData: ", currentDCAData);

  if (!currentDCAData) {
    throw new Error(`No DCA found for such dca object id ${desiredObjectId}`);
  }

  const baseCoinType = currentDCAData.fields.base_coin_type;
  const quoteCoinType = currentDCAData.fields.quote_coin_type;
  const addOrdersCount = 3;

  const { tx, txRes } = await DCAManagerSingleton.getDCAIncreaseOrdersRemainingTransaction({
    publicKey: user,
    baseCoinType,
    quoteCoinType,

    dca: desiredObjectId,
    addOrdersCount,

    transaction,
  });

  // const res = await provider.devInspectTransactionBlock({
  //   sender: sender,
  //   transactionBlock: tx,
  // });

  const res = await signAndExecuteTransaction(tx, delegateeKeypair);

  console.debug("txRes: ", txRes);
  console.debug("tx: ", tx);
  console.debug("tx.blockData: ", tx.blockData);
  console.dir(tx.blockData, { depth: null });
  console.debug("sender: ", sender);
  console.debug("res: ", res);
};

increaseOrders();
