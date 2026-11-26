import http from "http";

const BASE_URL = "http://127.0.0.1:5000";

const makeRequest = (urlPath) => {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    http
      .get(`${BASE_URL}${urlPath}`, (res) => {
        let rawData = "";
        res.on("data", (chunk) => {
          rawData += chunk;
        });
        res.on("end", () => {
          const durationMs = Math.round(performance.now() - start);
          try {
            const parsed = JSON.parse(rawData);
            resolve({
              statusCode: res.statusCode,
              durationMs,
              fromCache: parsed.fromCache ?? false,
              count: parsed.count ?? (parsed.products ? parsed.products.length : 0),
              data: parsed,
            });
          } catch (e) {
            resolve({ statusCode: res.statusCode, durationMs, rawData });
          }
        });
      })
      .on("error", reject);
  });
};

const runBenchmarks = async () => {
  console.log("=================================================");
  console.log("   BhansaMart Redis Caching Performance Benchmark");
  console.log("=================================================\n");

  const testEndpoints = [
    { name: "1. All Products Listing", path: "/api/products?page=1&limit=20" },
    { name: "2. Public Categories", path: "/api/categories?level=0" },
    { name: "3. Filtered Products (Grocery)", path: "/api/products?category=grocery&limit=10" },
    { name: "4. Sorted Products (Price Asc)", path: "/api/products?sortBy=price_asc&limit=10" },
  ];

  const results = [];

  for (const ep of testEndpoints) {
    console.log(`Testing: ${ep.name}`);

    // Call 1: Expect Cache Miss (MongoDB)
    const missRes = await makeRequest(ep.path);
    console.log(`  -> Run 1 (Cold / Cache Miss): ${missRes.durationMs}ms [fromCache: ${missRes.fromCache}]`);

    // Call 2: Expect Cache Hit (Redis)
    const hitRes = await makeRequest(ep.path);
    console.log(`  -> Run 2 (Warm / Cache Hit) : ${hitRes.durationMs}ms [fromCache: ${hitRes.fromCache}]`);

    const speedup = missRes.durationMs > 0 ? (missRes.durationMs / Math.max(1, hitRes.durationMs)).toFixed(1) : "1.0";
    console.log(`  âœ“ Latency Reduction: ${missRes.durationMs - hitRes.durationMs}ms (${speedup}x faster)\n`);

    results.push({
      name: ep.name,
      coldMs: missRes.durationMs,
      warmMs: hitRes.durationMs,
      speedup: `${speedup}x`,
      verifiedCacheHit: hitRes.fromCache === true,
    });
  }

  // Test Product Details if products exist
  const prodList = await makeRequest("/api/products?limit=1");
  const firstProd = prodList.data?.products?.[0];
  if (firstProd?._id) {
    console.log(`Testing: 5. Product Details (${firstProd.name || firstProd._id})`);
    const path = `/api/products/${firstProd._id}`;
    const miss = await makeRequest(path);
    console.log(`  -> Run 1 (Cold / Cache Miss): ${miss.durationMs}ms [fromCache: ${miss.fromCache}]`);
    const hit = await makeRequest(path);
    console.log(`  -> Run 2 (Warm / Cache Hit) : ${hit.durationMs}ms [fromCache: ${hit.fromCache}]`);
    const speedup = miss.durationMs > 0 ? (miss.durationMs / Math.max(1, hit.durationMs)).toFixed(1) : "1.0";
    console.log(`  âœ“ Latency Reduction: ${miss.durationMs - hit.durationMs}ms (${speedup}x faster)\n`);

    results.push({
      name: "5. Product Details",
      coldMs: miss.durationMs,
      warmMs: hit.durationMs,
      speedup: `${speedup}x`,
      verifiedCacheHit: hit.fromCache === true,
    });
  }

  console.log("=================================================");
  console.log("               BENCHMARK SUMMARY                 ");
  console.log("=================================================");
  console.table(results);
};

runBenchmarks().catch(console.error);
