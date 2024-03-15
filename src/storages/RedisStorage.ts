import { GetCacheParams, IStorage, RedisStorageClient, SetCacheParams, StorageValue } from "./types";
import { isStorageValue } from "./utils/typeguards";

/**
 * Singleton class for Redis storage implementation.
 *
 * Disclaimer: While the methods in this class are marked as public,
 * it is strongly discouraged to use them directly unless you are certain
 * about their behavior. For typical SDK usage, consider interacting with
 * the SDK's public API instead of directly using the methods of this class.
 * External usage may lead to unintended behavior and issues.
 */
export class RedisStorageSingleton implements IStorage {
  private static _instance: RedisStorageSingleton | undefined;
  private client: RedisStorageClient;
  private static version = 3;

  /**
   * Constructs a RedisStorageSingleton instance.
   * @param {RedisStorageClient} client - The Redis client instance.
   */
  private constructor(client: RedisStorageClient) {
    this.client = client;
  }

  /**
   * Gets the instance of the RedisStorageSingleton.
   * @param {RedisStorageClient} [client] - The optional Redis client instance.
   * @return {RedisStorageSingleton} - The singleton instance.
   * @throws {Error} If the client is not provided for the first instance creation.
   */
  public static getInstance(client?: RedisStorageClient): RedisStorageSingleton {
    if (!RedisStorageSingleton._instance) {
      if (client === undefined) {
        throw new Error("[RedisStorage] Client is required in arguments to create instance.");
      }

      const instance = new RedisStorageSingleton(client);
      RedisStorageSingleton._instance = instance;
    }

    return RedisStorageSingleton._instance;
  }

  /**
   * Sets cache data in Redis.
   * @param {SetCacheParams} params - Parameters containing provider, property, and value.
   * @return {Promise<void>} - A promise that resolves once the cache is set.
   * @throws {Error} - Throws an error if setting the cache fails.
   */
  public async setCache(params: SetCacheParams): Promise<void> {
    const { provider, property, value } = params;
    let key;

    if (provider === undefined) {
      key = `${property}.${RedisStorageSingleton.version}`;
    } else {
      key = `${provider}.${property}.${RedisStorageSingleton.version}`;
    }

    const stringifiedValue: string = JSON.stringify(value);

    const setResult = await this.client.set(key, stringifiedValue);

    if (setResult !== "OK") {
      console.debug("[RedisStorageSingleton] setCache failed for setting data in redis, params: ", params);
      throw new Error("[RedisStorageSingleton] setCache failed");
    }
  }

  /**
   * Retrieves cache data from Redis.
   * @param {GetCacheParams} params - Parameters containing provider and property.
   * @return {Promise<StorageValue>} - A promise that resolves to the retrieved StorageValue or null if not found.
   * @throws {Error} - Throws an error if the retrieved value is not a valid StorageValue.
   */
  public async getCache(params: GetCacheParams): Promise<StorageValue> {
    const { provider, property } = params;
    let key;

    if (provider === undefined) {
      key = `${property}.${RedisStorageSingleton.version}`;
    } else {
      key = `${provider}.${property}.${RedisStorageSingleton.version}`;
    }

    const value = await this.client.get(key);

    if (value === null) {
      return null;
    }

    const parsedValue: unknown = JSON.parse(value);

    if (isStorageValue(parsedValue)) {
      return parsedValue;
    } else {
      throw new Error(`[RedisStorage] getCache: value ${value} is not StorageValue.`);
    }
  }

  /**
   * Removes the current instance of RedisStorageSingleton.
   *
   * Disclaimer: While this method in this class is marked as public, it is strongly discouraged
   * to use it directly unless you are certain about the behavior.
   */
  public static removeInstance() {
    RedisStorageSingleton._instance = undefined;
  }
}
