import assert from "node:assert/strict";
import test from "node:test";
import { parseApkMetadata } from "./apk-metadata.mjs";

test("兼容新旧 aapt 最低系统字段，版本取自真实 APK", () => {
  for (const key of ["minSdkVersion", "sdkVersion"]) {
    const output = "package: name='com.dangdang.tv' versionCode='10313' versionName='1.3.13' platformBuildVersionCode='36'\n" + `${key}:'28'\n`;
    assert.deepEqual(parseApkMetadata(output), { packageName: "com.dangdang.tv", versionCode: 10313, versionName: "1.3.13", minSdk: 28 });
  }
  assert.throws(() => parseApkMetadata("not an APK"));
});
