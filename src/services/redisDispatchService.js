import redisClient, { isRedisReady } from "../config/redis.js";
import DeliveryBoy from "../models/DeliveryBoy.js";

// Key namespace constants
const KEY_RIDERS_ONLINE = "riders:online";
const KEY_RIDERS_AVAILABLE = "riders:available";
const KEY_RIDERS_GEO = "riders:locations";
const PREFIX_RIDER_LOC = "rider:location:";
const PREFIX_RIDER_PRESENCE = "rider:presence:";
const PREFIX_DISPATCH_LOCK = "dispatch:lock:";
const PREFIX_DISPATCH_OFFER = "dispatch:offer:";

/**
 * Calculate Haversine distance in kilometers
 */
export const calculateDistanceKm = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
};

class RedisDispatchService {
  constructor() {
    this.geoSupported = false;
    this.checkGeoSupport();
  }

  async checkGeoSupport() {
    if (!isRedisReady()) return;
    try {
      await redisClient.sendCommand(["GEOADD", "test:probe", "85.32", "27.71", "probe"]);
      await redisClient.del("test:probe");
      this.geoSupported = true;
    } catch {
      this.geoSupported = false;
    }
  }

  /**
   * Set Rider Status to ONLINE in Redis
   */
  async setRiderOnline(riderId, lng, lat) {
    if (!isRedisReady() || !riderId) return false;
    const rId = riderId.toString();
    try {
      await redisClient.sAdd(KEY_RIDERS_ONLINE, rId);
      await redisClient.sAdd(KEY_RIDERS_AVAILABLE, rId);

      const now = Date.now().toString();
      await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "status", "AVAILABLE");
      await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "updatedAt", now);
      await redisClient.expire(`${PREFIX_RIDER_PRESENCE}${rId}`, 86400);

      if (lng != null && lat != null && !isNaN(lng) && !isNaN(lat)) {
        await this.updateRiderLocation(rId, lng, lat);
      }
      return true;
    } catch (err) {
      console.warn(`[RedisDispatchService] setRiderOnline error for ${rId}:`, err.message);
      return false;
    }
  }

  /**
   * Set Rider Status to OFFLINE in Redis
   */
  async setRiderOffline(riderId) {
    if (!isRedisReady() || !riderId) return false;
    const rId = riderId.toString();
    try {
      await redisClient.sRem(KEY_RIDERS_ONLINE, rId);
      await redisClient.sRem(KEY_RIDERS_AVAILABLE, rId);
      if (this.geoSupported) {
        try {
          await redisClient.zRem(KEY_RIDERS_GEO, rId);
        } catch (_) {}
      }
      await redisClient.del(`${PREFIX_RIDER_LOC}${rId}`);
      await redisClient.del(`${PREFIX_RIDER_PRESENCE}${rId}`);
      return true;
    } catch (err) {
      console.warn(`[RedisDispatchService] setRiderOffline error for ${rId}:`, err.message);
      return false;
    }
  }

  /**
   * Mark Rider BUSY (fulfilling an assigned delivery)
   */
  async setRiderBusy(riderId, orderId = "") {
    if (!isRedisReady() || !riderId) return false;
    const rId = riderId.toString();
    try {
      await redisClient.sRem(KEY_RIDERS_AVAILABLE, rId);
      await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "status", "BUSY");
      await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "activeOrderId", orderId.toString());
      await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "updatedAt", Date.now().toString());
      return true;
    } catch (err) {
      console.warn(`[RedisDispatchService] setRiderBusy error for ${rId}:`, err.message);
      return false;
    }
  }

  /**
   * Mark Rider AVAILABLE (completed or freed from delivery)
   */
  async setRiderAvailable(riderId) {
    if (!isRedisReady() || !riderId) return false;
    const rId = riderId.toString();
    try {
      const isOnline = await redisClient.sIsMember(KEY_RIDERS_ONLINE, rId);
      if (isOnline) {
        await redisClient.sAdd(KEY_RIDERS_AVAILABLE, rId);
        await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "status", "AVAILABLE");
        await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "activeOrderId", "");
        await redisClient.hSet(`${PREFIX_RIDER_PRESENCE}${rId}`, "updatedAt", Date.now().toString());
      }
      return true;
    } catch (err) {
      console.warn(`[RedisDispatchService] setRiderAvailable error for ${rId}:`, err.message);
      return false;
    }
  }

  /**
   * Check if a rider is currently online and available
   */
  async isRiderAvailable(riderId) {
    if (!isRedisReady() || !riderId) return true;
    try {
      return Boolean(await redisClient.sIsMember(KEY_RIDERS_AVAILABLE, riderId.toString()));
    } catch {
      return true;
    }
  }

  /**
   * Get all currently online rider IDs
   */
  async getOnlineRiders() {
    if (!isRedisReady()) return [];
    try {
      return await redisClient.sMembers(KEY_RIDERS_ONLINE);
    } catch (err) {
      console.warn("[RedisDispatchService] getOnlineRiders error:", err.message);
      return [];
    }
  }

  /**
   * Get all currently available rider IDs
   */
  async getAvailableRiders() {
    if (!isRedisReady()) return [];
    try {
      return await redisClient.sMembers(KEY_RIDERS_AVAILABLE);
    } catch (err) {
      console.warn("[RedisDispatchService] getAvailableRiders error:", err.message);
      return [];
    }
  }

  /**
   * Update Rider GPS Location in Redis
   */
  async updateRiderLocation(riderId, lng, lat, heading = 0, speed = 0) {
    if (!isRedisReady() || !riderId) return false;
    const rId = riderId.toString();
    const lon = Number(lng);
    const lati = Number(lat);
    if (isNaN(lon) || isNaN(lati)) return false;

    try {
      // 1. Native Redis GEO if supported (Redis 3.2+)
      if (this.geoSupported) {
        try {
          await redisClient.sendCommand([
            "GEOADD",
            KEY_RIDERS_GEO,
            lon.toString(),
            lati.toString(),
            rId,
          ]);
        } catch (_) {
          this.geoSupported = false;
        }
      }

      // 2. High-speed Redis Hash per rider (compatible with all Redis versions)
      const locKey = `${PREFIX_RIDER_LOC}${rId}`;
      await redisClient.hSet(locKey, "lng", lon.toString());
      await redisClient.hSet(locKey, "lat", lati.toString());
      await redisClient.hSet(locKey, "heading", heading.toString());
      await redisClient.hSet(locKey, "speed", speed.toString());
      await redisClient.hSet(locKey, "updatedAt", Date.now().toString());
      await redisClient.expire(locKey, 7200); // 2 hour TTL

      return true;
    } catch (err) {
      console.warn(`[RedisDispatchService] updateRiderLocation error for ${rId}:`, err.message);
      return false;
    }
  }

  /**
   * Retrieve cached GPS location for a rider
   */
  async getRiderLocation(riderId) {
    if (!isRedisReady() || !riderId) return null;
    const rId = riderId.toString();
    try {
      const data = await redisClient.hGetAll(`${PREFIX_RIDER_LOC}${rId}`);
      if (!data || !data.lat || !data.lng) return null;
      return {
        latitude: parseFloat(data.lat),
        longitude: parseFloat(data.lng),
        heading: parseFloat(data.heading || "0"),
        speed: parseFloat(data.speed || "0"),
        updatedAt: data.updatedAt ? new Date(parseInt(data.updatedAt, 10)) : new Date(),
      };
    } catch (err) {
      console.warn(`[RedisDispatchService] getRiderLocation error for ${rId}:`, err.message);
      return null;
    }
  }

  /**
   * Find Nearby Available Riders using Redis
   * Returns list of { riderId, distanceKm, latitude, longitude, locationAgeSeconds }
   */
  async findNearbyAvailableRiders(storeLng, storeLat, radiusKm = 5, excludeIds = []) {
    if (!isRedisReady()) return [];
    const excludeSet = new Set((excludeIds || []).map((id) => id.toString()));

    try {
      // 1. If native GEO is supported
      if (this.geoSupported) {
        try {
          const rawGeo = await redisClient.sendCommand([
            "GEORADIUS",
            KEY_RIDERS_GEO,
            storeLng.toString(),
            storeLat.toString(),
            radiusKm.toString(),
            "km",
            "WITHDIST",
            "WITHCOORD",
            "ASC",
          ]);

          if (Array.isArray(rawGeo) && rawGeo.length > 0) {
            const results = [];
            for (const item of rawGeo) {
              const rId = Array.isArray(item) ? item[0] : item;
              if (excludeSet.has(rId)) continue;

              const isAvail = await redisClient.sIsMember(KEY_RIDERS_AVAILABLE, rId);
              if (!isAvail) continue;

              const dist = parseFloat(item[1] || "0");
              const coords = item[2] || [];
              results.push({
                riderId: rId,
                distanceKm: dist,
                longitude: coords[0] ? parseFloat(coords[0]) : storeLng,
                latitude: coords[1] ? parseFloat(coords[1]) : storeLat,
                locationAgeSeconds: 0,
              });
            }
            return results;
          }
        } catch (_) {
          this.geoSupported = false;
        }
      }

      // 2. High-speed Fallback using Redis Available Set + Rider Location Hashes
      const availableRiderIds = await redisClient.sMembers(KEY_RIDERS_AVAILABLE);
      if (!availableRiderIds || availableRiderIds.length === 0) return [];

      const nearbyRiders = [];
      const now = Date.now();

      for (const rId of availableRiderIds) {
        if (excludeSet.has(rId)) continue;

        const loc = await this.getRiderLocation(rId);
        if (!loc || isNaN(loc.latitude) || isNaN(loc.longitude)) continue;

        const distKm = calculateDistanceKm(storeLat, storeLng, loc.latitude, loc.longitude);
        if (distKm <= radiusKm) {
          const ageSeconds = Math.round((now - loc.updatedAt.getTime()) / 1000);
          nearbyRiders.push({
            riderId: rId,
            distanceKm: distKm,
            latitude: loc.latitude,
            longitude: loc.longitude,
            locationAgeSeconds: ageSeconds,
          });
        }
      }

      nearbyRiders.sort((a, b) => a.distanceKm - b.distanceKm);
      return nearbyRiders;
    } catch (err) {
      console.warn("[RedisDispatchService] findNearbyAvailableRiders error:", err.message);
      return [];
    }
  }

  /**
   * Acquire Atomic Distributed Lock for Order Dispatch
   * Returns lockToken string if acquired successfully, or null if already locked
   */
  async acquireDispatchLock(orderId, ttlSeconds = 15) {
    if (!isRedisReady() || !orderId) return "mongo_fallback_lock";
    const lockKey = `${PREFIX_DISPATCH_LOCK}${orderId.toString()}`;
    const token = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    try {
      const result = await redisClient.set(lockKey, token, {
        NX: true,
        EX: ttlSeconds,
      });
      return result === "OK" ? token : null;
    } catch (err) {
      console.warn(`[RedisDispatchService] acquireDispatchLock error for ${orderId}:`, err.message);
      return "mongo_fallback_lock";
    }
  }

  /**
   * Release Atomic Distributed Lock
   */
  async releaseDispatchLock(orderId, lockToken) {
    if (!isRedisReady() || !orderId) return true;
    const lockKey = `${PREFIX_DISPATCH_LOCK}${orderId.toString()}`;
    try {
      const currentToken = await redisClient.get(lockKey);
      if (currentToken === lockToken || !lockToken) {
        await redisClient.del(lockKey);
      }
      return true;
    } catch (err) {
      console.warn(`[RedisDispatchService] releaseDispatchLock error for ${orderId}:`, err.message);
      return false;
    }
  }

  /**
   * Set Active Dispatch Offer with exact server TTL
   */
  async setDispatchOffer(orderId, riderId, ttlSeconds = 20) {
    if (!isRedisReady() || !orderId || !riderId) return true;
    const offerKey = `${PREFIX_DISPATCH_OFFER}${orderId.toString()}:${riderId.toString()}`;
    try {
      await redisClient.set(offerKey, Date.now().toString(), { EX: ttlSeconds });
      return true;
    } catch (err) {
      console.warn(`[RedisDispatchService] setDispatchOffer error:`, err.message);
      return false;
    }
  }

  /**
   * Check if Dispatch Offer is still actively pending
   */
  async isOfferActive(orderId, riderId) {
    if (!isRedisReady() || !orderId || !riderId) return true; // Fallback to MongoDB check
    const offerKey = `${PREFIX_DISPATCH_OFFER}${orderId.toString()}:${riderId.toString()}`;
    try {
      const exists = await redisClient.exists(offerKey);
      return exists === 1;
    } catch (err) {
      return true; // Fallback
    }
  }

  /**
   * Clear active dispatch offer key
   */
  async clearDispatchOffer(orderId, riderId) {
    if (!isRedisReady() || !orderId || !riderId) return true;
    const offerKey = `${PREFIX_DISPATCH_OFFER}${orderId.toString()}:${riderId.toString()}`;
    try {
      await redisClient.del(offerKey);
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Reconcile Online & Available Riders from MongoDB into Redis
   * Called during server initialization to restore state after restarts
   */
  async reconcileOnlineRiders() {
    if (!isRedisReady()) return;
    try {
      const onlinePartners = await DeliveryBoy.find({
        approvalStatus: "APPROVED",
        "securityDeposit.status": "PAID",
        availability: { $in: ["ONLINE", "BUSY"] },
      }).select("_id availability currentLocation activeOrderId");

      console.log(`[RedisDispatchService] Reconciling ${onlinePartners.length} online rider(s)...`);

      for (const p of onlinePartners) {
        const rId = p._id.toString();
        await redisClient.sAdd(KEY_RIDERS_ONLINE, rId);

        if (p.availability === "ONLINE" && !p.activeOrderId) {
          await redisClient.sAdd(KEY_RIDERS_AVAILABLE, rId);
        } else {
          await redisClient.sRem(KEY_RIDERS_AVAILABLE, rId);
        }

        const coords = p.currentLocation?.coordinates;
        if (Array.isArray(coords) && coords.length >= 2) {
          await this.updateRiderLocation(rId, coords[0], coords[1]);
        }
      }
      console.log("[RedisDispatchService] Rider reconciliation complete.");
    } catch (err) {
      console.warn("[RedisDispatchService] Rider reconciliation error:", err.message);
    }
  }
}

const redisDispatchService = new RedisDispatchService();
export default redisDispatchService;
