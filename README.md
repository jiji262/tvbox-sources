# TVBox 影视源配置

[TVBox](https://github.com/ZxxXinI/tvbox) 的远程影视源配置。APK 启动时在后台拉取 `sources.json`，校验通过后替换内置线路并缓存到本机。增删线路、换地址、停用失效源只需要修改本仓库，**不需要重新发布 APK**。

| 地址 | 用途 |
| --- | --- |
| https://tv.navs.dpdns.org/sources.json | 主地址（Vercel 部署，Cloudflare DNS） |
| https://raw.githubusercontent.com/jiji262/tvbox-sources/main/sources.json | 备用地址 |
| https://cdn.jsdelivr.net/gh/jiji262/tvbox-sources@main/sources.json | 最后备用（CDN 有缓存，更新可能延迟数小时） |

> 请确保配置中的影视与直播接口具备合法授权。本仓库只保存接口地址，不托管任何影视内容。

## 更新流程

1. 修改 `sources.json`。
2. **把 `configVersion` 调大**，建议格式 `YYYYMMDDNN`（例如 `2026110902` 表示当天第 2 次修改），同时更新 `updatedAt`。
3. 本地校验：`node scripts/build.mjs --check-bump`（需要 Node.js 18+，无第三方依赖）。
4. 提交并推送到 `main`，Vercel 会自动构建部署，通常一分钟内生效。
5. 电视端在下次启动、回到前台（距上次检查超过 6 小时，上次检查失败时为 15 分钟）或在“设置 → 视频接口 → 影视源配置 → 检查更新”时获取新配置。

Vercel 构建时会运行同一套校验。校验失败时构建失败，线上继续使用上一份配置，不会把坏配置推给电视。

### 回滚

使用 `git revert` 撤销错误提交后，**仍然要把 `configVersion` 调到比当前线上更大的值**。APK 只接受版本号不低于本机已缓存配置的远程配置，用来避免 CDN 旧缓存把电视上的配置“倒退”回去。

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
      "protocol": "maccms-json",      // 目前只支持 MacCMS JSON；未知协议会被旧 APK 跳过
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
