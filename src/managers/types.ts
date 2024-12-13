import { CoinStruct } from "@mysten/sui.js/client";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import { AftermathSingleton } from "../providers/aftermath/aftermath";
import { CetusSingleton } from "../providers/cetus/cetus";
import { FlowxSingleton } from "../providers/flowx/flowx";
import { InterestProtocolSingleton } from "../providers/interest/interest";
import { TurbosSingleton } from "../providers/turbos/turbos";
import { TryCatchWrapperResult } from "../providers/types";

export type CommonCoinData = {
  symbol?: string;
  type: string;
  decimals: number;
};

export type CoinAssetData = Omit<CommonCoinData, "decimals"> & {
  balance: string;
  noDecimals: boolean;
  decimals: number | null;
};

export type UpdatedCoinsCache = { provider: string; data: CommonCoinData[] };

export type Provider =
  | TurbosSingleton
  | CetusSingleton
  | AftermathSingleton
  | FlowxSingleton
  | InterestProtocolSingleton;

export type Providers = Provider[];

export type ProvidersToRouteDataMap = Map<
  string,
  {
    provider: Provider;
    route: TryCatchWrapperResult;
  }
>;

export type UpdateCoinsCacheHandler = (arg: UpdatedCoinsCache) => void;

export interface ICoinManager {
  getCoinByType(coinType: string): CommonCoinData;
  getCoinByType2(coinType: string): Promise<CommonCoinData | null>;
  getCoinsByProviderMap(): Map<string, Map<string, CommonCoinData>>;
  getAllCoins(): Map<string, CommonCoinData>;
}

export interface IWalletManager {
  getAvailableWithdrawSuiAmount(publicKey: string): Promise<{ availableAmount: string; totalGasFee: string }>;
  getSuiBalance(publicKey: string): Promise<string>;
  getAvailableSuiBalance(publicKey: string): Promise<string>;
  getAllCoinAssets(publicKey: string): Promise<CoinAssetData[]>;
}

export interface IRouteManager {
  getBestRouteTransaction({
    tokenFrom,
    tokenTo,
    amount,
    slippagePercentage,
    signerAddress,
  }: {
    tokenFrom: string;
    tokenTo: string;
    amount: string;
    slippagePercentage: number;
    signerAddress: string;
  }): Promise<{ tx: TransactionBlock; outputAmount: bigint; providerName: string }>;
}

export type CreateCoinTransactionParams = {
  name: string;
  symbol: string;
  decimals: string;
  fixedSupply: boolean;
  mintAmount: string;
  url: string;
  description: string;
  signerAddress: string;
  transaction?: TransactionBlock;
};

export type CreateCoinExternalApiResType = {
  modules: string[] | number[][];
  dependencies: string[];
  digest: number[];
};

export type BestRouteData = {
  maxOutputProvider: Provider;
  maxOutputAmount: bigint;
  route: TryCatchWrapperResult;
};

export type NonEmptyArray<T> = [T, ...T[]];

export type MergedCoinsStructure = {
  destinations: NonEmptyArray<string>;
  sources: NonEmptyArray<string>;
  unusedSources: string[];
};

export type SwapFee = {
  tokenFromDecimals: number;
  fees: NonEmptyArray<{
    feeAmount: string;
    feeCollectorAddress: string;
  }>;
  tokenFromCoinObjects?: CoinStruct[];
};
