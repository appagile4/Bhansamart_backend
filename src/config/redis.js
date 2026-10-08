import Redis from "ioredis";

let redisClient = null;
let isConnected = false;

const initRedis = () => {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = parseInt(process.env.REDIS_PORT || "6379", 10);
  const password = process.env.REDIS_PASSWORD || undefined;

  try {
    if (redisUrl) {
      redisClient = new Redis(redisUrl, {
        lazyConnect: false,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 5) return null; // stop retrying after 5 attempts to avoid log spam
          return Math.min(times * 300, 2000);
        },
      });
    } else {
      redisClient = new Redis({
        host,
        port,
        password,
        lazyConnect: false,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy(times) {
          if (times > 5) return null;
          return Math.min(times * 300, 2000);
        },
      });
    }

    redisClient.on("connect", () => {
      isConnected = true;
      console.log(`[Redis] Connected successfully to ${host}:${port}`);
    });

    redisClient.on("ready", () => {
      isConnected = true;
    });

    redisClient.on("error", (err) => {
      isConnected = false;
      // Graceful fallback - do not crash application if Redis is offline
      if (err.code === "ECONNREFUSED") {
        // Log once softly
      } else {
        console.warn(`[Redis Notice] ${err.message || "Connection issue. Proceeding without Redis cache."}`);
      }
    });

    redisClient.on("close", () => {
      isConnected = false;
    });
  } catch (error) {
    console.warn(`[Redis Init] Could not initialize Redis: ${error.message}`);
    redisClient = null;
    isConnected = false;
  }

  return redisClient;
};

// Initialize client immediately
initRedis();

/**
 * Check if Redis is ready and available
 */
export const isRedisReady = () => {
  return isConnected && redisClient && redisClient.status === "ready";
};

/**
 * Retrieve cached JSON data by key
 */
export const getCache = async (key) => {
  if (!isRedisReady()) return null;
  try {
    const data = await redisClient.get(key);
    if (!data) return null;
    return JSON.parse(data);
  } catch (err) {
    console.warn(`[Redis getCache error] for key ${key}:`, err.message);
    return null;
  }
};

/**
 * Save JSON data with an expiration TTL (in seconds)
 */
export const setCache = async (key, value, ttlSeconds = 300) => {
  if (!isRedisReady()) return false;
  try {
    const stringified = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await redisClient.set(key, stringified, "EX", ttlSeconds);
    } else {
      await redisClient.set(key, stringified);
    }
    return true;
  } catch (err) {
    console.warn(`[Redis setCache error] for key ${key}:`, err.message);
    return false;
  }
};

/**
 * Delete a specific cache key
 */
export const deleteCache = async (key) => {
  if (!isRedisReady()) return false;
  try {
    await redisClient.del(key);
    return true;
  } catch (err) {
    console.warn(`[Redis deleteCache error] for key ${key}:`, err.message);
    return false;
  }
};

/**
 * Invalidate cache keys matching pattern using non-blocking SCAN
 */
export const invalidateCachePattern = async (pattern = "products:*") => {
  if (!isRedisReady()) return 0;
  try {
    let cursor = "0";
    let totalDeleted = 0;
    do {
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;
      if (keys && keys.length > 0) {
        await redisClient.unlink(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== "0");

    return totalDeleted;
  } catch (err) {
    console.warn(`[Redis invalidateCachePattern error] pattern ${pattern}:`, err.message);
    return 0;
  }
};

export default redisClient;
