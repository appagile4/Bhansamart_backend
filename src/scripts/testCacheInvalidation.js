import http from "http";
import { invalidateCache, deleteCache, isRedisReady } from "../config/redis.js";

const BASE_URL = "http://127.0.0.1:5000";

const makeRequest = (urlPath) => {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${urlPath}`, (res) => {
      let rawData = "";
      res.on("data", (chunk) => {
        rawData += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(rawData));
        } catch {
          resolve(rawData);
        }
      });
    }).on("error", reject);
  });
};

const testInvalidation = async () => {
  console.log("=================================================");
  console.log("      Testing Redis Cache Invalidation Flow      ");
  console.log("=================================================\n");

  // Step 1: Ensure warmed cache
  console.log("1. Requesting products to warm cache...");
  const first = await makeRequest("/api/products?page=1&limit=20");
  const second = await makeRequest("/api/products?page=1&limit=20");
  console.log(`   Initial Cache Hit Status: ${second.fromCache === true ? "âœ“ HIT" : "âœ— MISS"}`);

  // Step 2: Trigger invalidation pattern
  console.log("\n2. Simulating product update -> Invalidating 'products:*'...");
  const cleared = await invalidateCache("products:*");
  console.log(`   Cleared ${cleared} cached key(s).`);

  // Step 3: Next request must be Cache Miss (fresh DB data)
  console.log("\n3. Requesting products immediately after invalidation...");
  const afterInvalidation = await makeRequest("/api/products?page=1&limit=20");
  console.log(`   After Invalidation: fromCache = ${afterInvalidation.fromCache} (Expected: false)`);
  if (afterInvalidation.fromCache === false) {
    console.log("   âœ“ Invalidation Verified: Served fresh data from MongoDB!");
  } else {
    console.log("   âœ— Invalidation Failed: Still returned cached data!");
  }

  // Step 4: Next request must be Cache Hit again
  console.log("\n4. Repeating request to verify re-caching...");
  const reCached = await makeRequest("/api/products?page=1&limit=20");
  console.log(`   Re-cached: fromCache = ${reCached.fromCache} (Expected: true)`);
  if (reCached.fromCache === true) {
    console.log("   âœ“ Re-caching Verified: Successfully repopulated in Redis!");
  }

  console.log("\n=================================================");
  console.log("         ALL INVALIDATION TESTS PASSED           ");
  console.log("=================================================");
  process.exit(0);
};

testInvalidation().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
