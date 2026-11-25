import { createClient } from "redis";

let redisClient = null;
let isConnected = false;

const REDIS_URL = process.env.REDIS_URL || "redis://127.0.0.1:6379";

/**
 * Initialize centralized Redis Client
 */
export const initRedis = () => {
  if (redisClient) return redisClient;

  try {
    redisClient = createClient({
      url: REDIS_URL,
      // RESP: 2 ensures 100% compatibility across Windows Redis 3.0 / Memurai & production Redis 7+
      RESP: 2,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            // Keep retry alive but throttled to avoid log spam
            return 5000;
          }
          return Math.min(retries * 300, 2000);
        },
        connectTimeout: 5000,
      },
    });

    redisClient.on("connect", () => {
      // Socket connected
    });

    redisClient.on("ready", () => {
      isConnected = true;
      console.log(`[Redis] Connected and ready at ${REDIS_URL}`);
    });

    redisClient.on("reconnecting", () => {
      isConnected = false;
    });

    redisClient.on("error", (err) => {
      isConnected = false;
      // Soft logging: Prevent app crash when Redis is offline
      if (err.code === "ECONNREFUSED") {
        // Redis server offline; quiet fallback
      } else {
        console.warn(`[Redis Notice] ${err.message || "Cache unavailable, using MongoDB fallback."}`);
      }
    });

    redisClient.on("end", () => {
      isConnected = false;
    });

    // Connect asynchronously without blocking server startup
    redisClient.connect().catch((err) => {
      console.warn(`[Redis Notice] Could not connect to Redis: ${err.message}. Backend will continue with MongoDB.`);
    });
  } catch (error) {
    console.warn(`[Redis Init Error] ${error.message}`);
    redisClient = null;
    isConnected = false;
  }

  return redisClient;
};

// Initialize immediately on module load
initRedis();

/**
 * Check if Redis connection is active and ready
 */
export const isRedisReady = () => {
  return Boolean(isConnected && redisClient && redisClient.isReady);
};

/**
 * Get cached JSON data by key
 */
export const getCache = async (key) => {
  if (!isRedisReady()) return null;
  try {
    const data = await redisClient.get(key);
    if (!data) {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[Redis Cache MISS] ${key}`);
      }
      return null;
    }

    if (process.env.NODE_ENV !== "production") {
      console.log(`[Redis Cache HIT] ${key}`);
    }
    return JSON.parse(data);
  } catch (err) {
    console.warn(`[Redis getCache Error] Key ${key}:`, err.message);
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
      await redisClient.set(key, stringified, { EX: ttlSeconds });
    } else {
      await redisClient.set(key, stringified);
    }
    return true;
  } catch (err) {
    console.warn(`[Redis setCache Error] Key ${key}:`, err.message);
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
    console.warn(`[Redis deleteCache Error] Key ${key}:`, err.message);
    return false;
  }
};

/**
 * Invalidate cache keys matching pattern using non-blocking SCAN
 */
export const invalidateCache = async (pattern = "products:*") => {
  if (!isRedisReady()) return 0;
  try {
    const allKeys = [];
    for await (const chunk of redisClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      if (Array.isArray(chunk)) {
        allKeys.push(...chunk);
      } else if (chunk) {
        allKeys.push(chunk);
      }
    }

    if (allKeys.length > 0) {
      const deletedCount = await redisClient.del(allKeys);
      if (process.env.NODE_ENV !== "production") {
        console.log(`[Redis Invalidate] Cleared ${deletedCount} key(s) matching "${pattern}"`);
      }
      return deletedCount;
    }
    return 0;
  } catch (err) {
    console.warn(`[Redis invalidateCache Error] Pattern "${pattern}":`, err.message);
    return 0;
  }
};

// Alias for backwards compatibility
export const invalidateCachePattern = invalidateCache;

/**
 * Cache-Aside wrapper: Try cache first, fallback to fetchFn, save in cache
 */
export const getOrSetCache = async (key, fetchFn, ttlSeconds = 300) => {
  const cached = await getCache(key);
  if (cached !== null) {
    return cached;
  }

  const freshData = await fetchFn();
  if (freshData !== undefined && freshData !== null) {
    await setCache(key, freshData, ttlSeconds);
  }
  return freshData;
};

/**
 * Graceful shutdown for Redis
 */
export const closeRedis = async () => {
  if (redisClient) {
    try {
      await redisClient.quit();
      isConnected = false;
      console.log("[Redis] Disconnected gracefully.");
    } catch (err) {
      console.warn("[Redis close Error]:", err.message);
    }
  }
};

export default redisClient;
