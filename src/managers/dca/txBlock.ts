export interface TxBlock {
  version: 1;
  transactions: Transactions;
  inputs: Inputs;
  gasConfig: {
    payment?:
      | {
          objectId: string;
          version: string | number;
          digest: string;
        }[]
      | undefined;
    owner?: string | undefined;
    price?: string | undefined;
    budget?: string | undefined;
  };
  sender?: string | undefined;
  expiration?:
    | {
        Epoch: number;
      }
    | {
        None: true | null;
      }
    | null
    | undefined;
}

export interface Argument {
  kind: "Input" | "GasCoin" | "Result" | "NestedResult";
  index: number;
  type?: "object" | "pure";
  value?: any;
  resultIndex?: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Arguments extends Array<Argument> {}

export interface Input {
  kind: "Input";
  index: number;
  type?: "object" | "pure" | undefined;
  value?: any;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Inputs extends Array<Input> {}

type MoveCallTransaction = {
  arguments: Arguments;
  kind: "MoveCall";
  typeArguments: string[];
  target: `${string}::${string}::${string}`;
};

type TransferObjectsTransaction = {
  objects: Arguments;
  kind: "TransferObjects";
  address: Argument;
};

type SplitCoinsTransaction = {
  kind: "SplitCoins";
  coin: Argument;
  amounts: Arguments;
};

type MergeCoinsTransaction = {
  kind: "MergeCoins";
  destination: Argument;
  sources: Arguments;
};

type MakeMoveVecTransaction = {
  objects: Arguments;
  kind: "MakeMoveVec";
  type?:
    | {
        None: true | null;
      }
    | {
        Some: Record<string, unknown>;
      }
    | undefined;
};

type PublishTransaction = {
  kind: "Publish";
  dependencies: string[];
  modules: number[][];
};

type UpgradeTransaction = {
  packageId: string;
  kind: "Upgrade";
  dependencies: string[];
  modules: number[][];
  ticket: Argument;
};

export type Transaction =
  | MoveCallTransaction
  | TransferObjectsTransaction
  | SplitCoinsTransaction
  | MergeCoinsTransaction
  | MakeMoveVecTransaction
  | PublishTransaction
  | UpgradeTransaction;

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Transactions extends Array<Transaction> {}
