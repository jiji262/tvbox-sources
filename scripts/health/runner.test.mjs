import assert from "node:assert/strict";
import test from "node:test";
import { collectResults } from "./runner.mjs";

test("最多三条源并行，停用项不访问网络，失败结果保留身份", async () => {
  let active = 0, peak = 0;
  const lines = Array.from({ length: 7 }, (_, i) => ({ id: String(i), enabled: i !== 6 }));
  const results = await collectResults(lines, async (line) => {
    active++; peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active--;
    if (line.id === "2") throw new Error("sensitive URL or credential must not be logged");
    return {};
  });
  assert.equal(peak, 3);
  assert.deepEqual(results.map((row) => row.id), ["0", "1", "2", "3", "4", "5", "6"]);
  assert.equal(results[2].status, "unavailable");
  assert.equal(results[6].status, "disabled");
  assert.ok(!JSON.stringify(results).includes("sensitive"));
});
