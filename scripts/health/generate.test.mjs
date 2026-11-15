import assert from "node:assert/strict";
import test from "node:test";
import { generateSnapshot, isScheduledDay } from "./generate.mjs";

const baseline = {
  schemaVersion: 1, configVersion: 100, defaultHomeLineId: "juzi_a",
  lines: [
    { id: "juzi_a", name: "JZ·A", protocol: "juzi-native" },
    { id: "public", name: "公共", baseUrls: ["https://bad.test/", "https://good.test/"] },
    { id: "disabled", name: "手动停用", enabled: false, baseUrls: ["https://off.test/"] },
  ],
};
const now = new Date("2026-11-16T01:17:00Z");
const results = [
  { id: "juzi_a", status: "unavailable", stage: "media" },
  { id: "public", status: "available", stage: "media", healthyUrls: ["https://good.test/"] },
  { id: "disabled", status: "disabled" },
];

test("基准不被修改，失败 JZ 显式停用，默认源和备用地址指向可用产物", () => {
  const before = JSON.stringify(baseline);
  const output = generateSnapshot({ baseline, results, now });
  assert.equal(JSON.stringify(baseline), before);
  assert.equal(output.lines[0].enabled, false);
  assert.equal(output.lines[1].enabled, true);
  assert.deepEqual(output.lines[1].baseUrls, ["https://good.test/"]);
  assert.equal(output.lines[2].enabled, false);
  assert.equal(output.defaultHomeLineId, "public");
  assert.equal(output.configVersion, 101);
  assert.equal(output.updatedAt, "2026-11-16T01:17:00.000Z");
  assert.ok(output.configUrls.slice(1).every((url) => url.includes("/generated/sources.json")));
});

test("下一次从基准重检，可恢复之前失败的源，不能恢复手动停用项", () => {
  const previous = generateSnapshot({ baseline, results, now });
  const recovered = results.map((r) => ({ ...r, status: "available" }));
  const output = generateSnapshot({ baseline, results: recovered, previous, now });
  assert.equal(output.lines[0].enabled, true);
  assert.equal(output.lines[2].enabled, false);
  assert.equal(output.defaultHomeLineId, "juzi_a");
  assert.equal(output.configVersion, 102);
});

test("整轮失败、缺少结果、重复结果和未知结果均不发布", () => {
  for (const rows of [
    results.map((r) => ({ ...r, status: "unavailable" })),
    results.slice(0, 2), [...results, results[0]],
    [...results, { id: "unexpected", status: "available" }],
  ]) assert.throws(() => generateSnapshot({ baseline, results: rows, now }));
});

test("版本始终高于基准及上一份产物，保持元数据和条目身份", () => {
  const output = generateSnapshot({ baseline, results, previous: { configVersion: 200 }, now });
  assert.equal(output.configVersion, 201);
  assert.deepEqual(output.lines.map((line) => line.id), ["juzi_a", "public", "disabled"]);
  assert.equal(output.schemaVersion, 1);
});

test("隔天按连续 UTC 日期计算，跨月底仍相隔48小时", () => {
  const dates = ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"];
  const selected = dates.filter((date) => isScheduledDay(new Date(date)));
  assert.equal(selected.length, 2);
  assert.equal(Date.parse(selected[1]) - Date.parse(selected[0]), 48 * 3600 * 1000);
});
