# Sage Plugin · AI 配额与用量

选择任意模型，查看该模型自己的订阅配额和本地 Token 用量。按新的 `sage.plugin.json` 规范实现。

## 功能

- 模型选择器：来自本机各 CLI 的真实用量（engine + model）
- 当前模型的今日 Token、近 30 天 Token、请求/会话数、估算成本
- Claude / Codex 订阅配额窗口（5 小时、周限、模型级窗口）
- 近 30 天按天柱状图
- 选择结果持久化，下次打开仍停留在同一模型

## 数据来源

- `ctx.usage`：宿主从本机 CLI 会话日志统计的 Token/成本数据，只读、不上传
- `ctx.limits`：宿主读取本机 CLI 登录状态后查询官方接口；插件拿不到凭据
- 首次读取限额前，Sage 会要求用户确认读取本机 CLI 登录状态

## 权限

```json
["ui:panel-tab", "usage.read", "limits.read", "storage"]
```

## 构建

```bash
pnpm install
pnpm build
```

## 本地安装

Sage → 插件中心 → 从本地目录安装，选择本仓库根目录。安装后在插件详情页确认 `usage.read` / `limits.read` 权限。

## 要求

- Sage >= 1.2.5
