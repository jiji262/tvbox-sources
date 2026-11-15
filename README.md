# TVBox 影视源配置

[TVBox](https://github.com/ZxxXinI/tvbox) 的远程影视源配置。APK 启动时在后台拉取 `sources.json`，校验通过后替换内置线路并缓存到本机。增删线路、换地址、停用失效源只需要修改本仓库，**不需要重新发布 APK**。

| 地址 | 用途 |
| --- | --- |
| https://tv.navs.dpdns.org/sources.json | 主地址（Vercel 部署，Cloudflare DNS） |
| https://raw.githubusercontent.com/jiji262/tvbox-sources/main/generated/sources.json | 备用地址 |
| https://cdn.jsdelivr.net/gh/jiji262/tvbox-sources@main/generated/sources.json | 最后备用（CDN 有缓存，更新可能延迟数小时） |

> 请确保配置中的影视与直播接口具备合法授权。本仓库只保存接口地址，不托管任何影视内容。

## 更新流程

1. 只人工维护根目录 `sources.json`，它始终保留为完整基准，定时检测不会覆盖。
2. 修改基准时把 `configVersion` 调大并更新 `updatedAt`。生成版本自动取基准与上次产物版本的最大值再加一。
3. 本地校验：`node scripts/build.mjs --check-bump`；测试：`node --test scripts/build.test.mjs scripts/health/*.test.mjs`（Node.js 22+，无第三方依赖）。
4. 提交并推送到 `main`，GitHub Actions 检测基准并提交 `generated/sources.json` 和 `generated/health.json`；Vercel 仅部署生成配置，检测完成后的部署通常需要约一分钟。
5. 电视端在下次启动、回到前台（距上次检查超过 6 小时，上次检查失败时为 15 分钟）或在“设置 → 视频接口 → 影视源配置 → 检查更新”时获取新配置。

GitHub Actions 每隔一天在北京时间 09:17 左右执行检测，按连续 UTC 日期判断，跨月仍相隔 48 小时；GitHub 调度可能延迟。修改基准或检测脚本会立即检测，也可在 Actions → `source-health` → Run workflow 手动执行。

MacCMS 检查目录、搜索、详情和实际媒体数据；JZ 共用发现与握手后，逐渠道解析并检查媒体。只读取少量媒体数据，不下载完整视频。每条源最多 30 秒，最多三条源并行，整个任务上限 10 分钟。检测节点是 GitHub 网络，可用不等于家庭电视网络一定可播放。

失败条目保留 ID 并设为 `enabled: false`（包括 JZ，不能删除后让 APK 补回内置渠道）；恢复后可在下一轮自动启用，人工停用的条目保持停用。整轮异常、结果不完整或全部失败时不发布，保留上一份有效产物。状态可查看 https://tv.navs.dpdns.org/health.json 或 Actions 运行摘要。

JZ 协议配置通过仓库 Secret `JZ_PROTOCOL_CONFIG` 提供，只供可信 main 分支检测使用，不能写进公开 JSON 或日志。公开仓库使用免费的标准 Ubuntu runner，不使用付费 runner、缓存或制品上传；Vercel 仅静态部署，不增加 Cron 或 Functions。Vercel 构建也会校验生成配置，失败时线上继续使用上一份配置。

### 回滚

撤销错误的基准修改后重新运行检测，由任务生成高于当前产物的版本；不要直接把旧生成文件部署上线。APK 只接受版本号不低于本机已缓存配置的远程配置，用来避免 CDN 旧缓存把电视上的配置“倒退”回去。

## 字段说明

```jsonc
{
  "schemaVersion": 1,                 // 结构版本。APK 只认识 1；改结构必须先发布支持新结构的 APK
  "configVersion": 2026110901,        // 配置版本，只能增大
  "updatedAt": "2026-11-09T19:00:00+08:00",
  "defaultHomeLineId": "liangzi",     // 默认首页线路，必须是一条启用的线路
  "configUrls": ["https://..."],      // 下次拉取时优先尝试的地址，只允许 https；APK 内置地址会作为兜底
  "lineDefaults": {
    "hiddenCategoryIds": [41, 42, 43, 44], // 默认隐藏的分类 ID
    "defaultTypeId": 13                     // 首页“全部”默认请求的分类 ID，0 表示不按分类过滤
  },
  "lines": [
    {
      "id": "liangzi",                // 唯一且永久不变；观看历史按 id 关联线路
      "name": "量子",                 // 电视上显示的名称
      "protocol": "maccms-json",      // MacCMS JSON；JZ 原生渠道使用 juzi-native
      "enabled": true,                // false：从线路列表和搜索中隐藏，已有观看历史仍可续播
      "searchable": true,             // 可选，false：不参与多来源搜索和详情补源
      "hiddenCategoryIds": [41],      // 可选，覆盖 lineDefaults
      "defaultTypeId": 13,            // 可选，覆盖 lineDefaults
      "baseUrls": [                   // 按顺序尝试，前一个失败自动用下一个
        "https://cj.lziapi.com/api.php/provide/vod/"
      ]
    }
  ],
  "contentFilter": { "blockedKeywords": ["伦理", "电影解说"] }, // 只能追加屏蔽词，APK 内置屏蔽词始终生效
  "live": { "sourceUrls": ["http://..."] },                    // 电视直播源，按顺序回退；为空时使用 APK 内置
  "platformLive": { "serviceUrl": "http://..." }               // 平台直播服务；为空时使用 APK 构建参数
}
```

### 线路 id 规则

- 只能包含字母、数字、`_`、`.`、`-`，长度 1–64。
- 已发布的 id 不要改名、不要复用。线路失效时优先改 `enabled: false` 或替换 `baseUrls`，这样用户的首页选择和观看历史不会丢失。
- `custom_` 前缀保留给用户在电视上扫码添加的自定义接口。
- `baseUrls` 必须以 http/https 开头，不能带 `?` 或 `#`；缺少结尾 `/` 时 APK 会自动补上。

### JZ 原生渠道

`juzi-native` 与 MacCms 条目放在同一个 `lines` 数组中。首次安装支持远端 JZ 渠道的新 APK 后，可直接在这里新增同协议渠道、改名、停用、排序和设置 `defaultHomeLineId`，无需重新打包；电视端不增加配置项，已保存的首页选择继续保留。旧 APK 会跳过不认识的渠道和字段。

```json
{"id":"juzi_shvip","name":"JZ·VIP蓝光","protocol":"juzi-native"}
```

渠道 ID 使用 `juzi_` 加上游真实渠道标识，如 `shvip` 对应 `juzi_shvip`；标识首字符为字母、数字或下划线，完整 ID 最多 64 字符。上游必须已支持该渠道并继续使用相同的 JZ 协议；配置校验通过不代表上游一定可播放。条目不能填写 `baseUrls` 或密钥字段，`enabled`、`searchable` 省略时均为 `true`。

所有 JZ 渠道共用根节点 `juzi.bootstrapUrls`，发现入口只需配置一次（下面为 `sources.json` 中的节点片段）：

```json
"juzi": {
  "bootstrapUrls": ["https://example.com/jz-discovery.json"]
}
```

发现入口返回 `{"enabled":true,"domain":"https://api.example.com"}`。`bootstrapUrls` 最多 10 个，只允许不含凭据和片段的 HTTPS 地址；远端入口优先，发现或握手失败后自动尝试 APK 内置入口。省略 `juzi`、省略该数组或设置为空数组均使用内置入口。更新入口后，新请求会重新握手，已经开始的请求继续完成。

协议密钥、签名、加解密和解析器仍留在 APK，不能放进此公开配置；协议本身变化时仍需更新 APK。

JZ 不继承 MacCms 的默认分类 ID；可在条目中单独设置 `defaultTypeId`（0 表示全部）和 `hiddenCategoryIds`。未列出的内置渠道仍保留，停用请显式设置 `enabled: false`；NN 备用角色由 APK 固定，始终放在普通和自定义线路之后。旧 JSON 无 JZ 条目时仍使用内置 JZ 顺序和默认源，远程失败时保留最近有效缓存或 APK 内置值。

## APK 端行为

- 首次安装：使用 APK 内置配置（与本仓库首个版本一致），后台拉取远程配置。
- 拉取顺序：上一份配置的 `configUrls` → APK 内置地址（主域名 → GitHub Raw → jsDelivr），任一地址成功即停止。
- 校验失败、网络失败或远程版本低于本机缓存时，保留当前配置，不影响正常使用。
- 已缓存的配置与 APK 内置配置比较版本，取较新的一份；升级 APK 后不会被旧缓存覆盖。
- 首页线路被停用或删除时，自动切换到 `defaultHomeLineId`；用户扫码添加的自定义接口不受远程配置影响。

## 部署

- Vercel 项目 `djiteam/tvbox-sources` 已连接本仓库，推送 `main` 自动部署生产环境；构建命令和输出目录见 `vercel.json`。
- Vercel 默认域名 `tvbox-sources-rho.vercel.app` 在国内常无法访问，所以不写进 `configUrls`。
- 自定义域名 `tv.navs.dpdns.org` 的 DNS 在 Cloudflare（区域 `navs.dpdns.org`）：
  - CNAME `tv` → `46da4ca9d640ed5c.vercel-dns-017.com`，代理状态保持“仅 DNS”，由 Vercel 签发和续期 HTTPS 证书。
  - TXT `_vercel` 是 Vercel 的域名所有权验证记录，不要删除。

## 本地预览

```bash
node scripts/build.mjs
npx serve dist   # 或任意静态文件服务器
```

构建读取已提交的 `generated/sources.json`。需要本地重新检测时，将 JZ 配置通过环境变量 `JZ_PROTOCOL_CONFIG` 注入，再执行 `node scripts/health/run.mjs`，不要把密钥写入仓库。
