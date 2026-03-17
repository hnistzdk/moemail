# moemail 项目协作说明

本文件用于帮助后续会话快速理解当前项目结构、关键设计、最近新增能力与修改注意事项。

## 基本要求

- 所有回复默认使用简体中文。
- 对现有代码做修改时，优先沿用已有模式，避免无关重构。
- 非用户明确要求，不要擅自删除文件或做大规模结构调整。
- 修改后优先执行最小必要验证，当前项目至少执行 `npx tsc --noEmit`。

## 项目概览

- 前端框架：`Next.js`（App Router）
- 运行环境：`Cloudflare Pages + Workers`
- 数据存储：
  - `D1`：业务数据
  - `KV(SITE_CONFIG)`：站点运行时配置
  - `R2(ATTACHMENTS)`：附件对象存储
- 主要 worker：
  - `workers/email-receiver.ts`：收信、解析邮件、存储附件、发送 webhook
  - `workers/cleanup.ts`：清理过期邮箱/邮件及其附件

## 权限约定

- 管理站点配置使用权限：`PERMISSIONS.MANAGE_CONFIG`
- 当前“附件配置管理页面”仅允许管理员（皇帝）使用
- 权限判断沿用：`checkPermission(PERMISSIONS.MANAGE_CONFIG)`

## 当前附件设计

### 附件配置来源

附件相关配置现在优先从 `SITE_CONFIG` 读取；读不到时才回退到环境变量或默认值。

核心配置键定义在：`app/lib/attachments.ts`

- `ATTACHMENT_STORAGE_ENABLED`
- `ATTACHMENT_MAX_FILE_SIZE`
- `ATTACHMENT_MAX_FILES_PER_MESSAGE`
- `ATTACHMENT_ALLOWED_MIME_PREFIXES`
- `ATTACHMENT_DOWNLOAD_ENABLED`
- `ATTACHMENT_WEBHOOK_INCLUDE_LINK`
- `ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY`

### 统一配置模型

附件配置统一在 `app/lib/attachments.ts` 维护，包括：

- `resolveAttachmentStorageConfig`
- `normalizeAttachmentConfig`
- `serializeAttachmentConfig`
- `ATTACHMENT_CONFIG_KEYS`

后续若新增附件配置项，应优先在这里补齐，再接入接口和 UI。

## 当前附件功能落点

### 1. 管理端配置页面

管理员附件配置面板位置：`app/components/profile/attachment-config-panel.tsx`

该面板已经接入个人中心：`app/components/profile/profile-card.tsx`

后端接口：`app/api/config/attachments/route.ts`

接口职责：

- `GET`：读取附件配置
- `POST`：保存附件配置到 `SITE_CONFIG`
- 仅 `MANAGE_CONFIG` 权限可访问

### 2. 收信与附件存储

收信 worker：`workers/email-receiver.ts`

当前行为：

- 收到邮件后解析附件
- 根据配置判断是否存储附件
- 依据大小、数量、MIME 前缀过滤附件
- 将附件写入 `R2`
- 将附件元数据写入 `D1`
- Webhook 是否附带下载链接，受 `ATTACHMENT_WEBHOOK_INCLUDE_LINK` 控制

注意：

- `downloadUrl` 为空字符串表示不向前端/下游暴露下载入口，并不代表对象未存储

### 3. 附件下载

下载接口：`app/api/emails/[id]/[messageId]/attachments/[attachmentId]/route.ts`

当前行为：

- 当 `ATTACHMENT_DOWNLOAD_ENABLED=false` 时，接口直接返回 `403`
- 否则按原逻辑读取 `R2` 并返回文件流

消息详情接口：`app/api/emails/[id]/[messageId]/route.ts`

当前行为：

- 当下载关闭时，返回的 `download_url` 为空字符串

前端展示：`app/components/emails/message-view.tsx`

当前行为：

- 有 `download_url` 时展示可点击下载项
- 无 `download_url` 时展示禁用样式和“已禁用下载”提示

## 删除与清理链路

### 手动删除

手动删除邮箱：`app/api/emails/[id]/route.ts`

手动删除单封邮件：`app/api/emails/[id]/[messageId]/route.ts`

当前行为：

- 删除前会先查附件记录
- 然后尝试删除对应 `R2` 对象
- 再删除 `D1` 中的消息/邮箱记录

注意：

- 手动删除链路仍然是“删除 R2 失败只记录日志，继续删库”模式
- 如果后续要提升一致性，可以参考 cleanup worker 的保护方式继续改造

### 定时清理

清理 worker：`workers/cleanup.ts`

当前行为：

- 清理过期邮箱前，会先判断 `ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY`
- 若该开关为 `true`：
  - 要求存在 `ATTACHMENTS` 绑定
  - 会先删除 `R2` 附件对象，再删 `D1` 记录
- 若该开关为 `false`：
  - 会跳过附件对象清理
  - 仅删除邮箱记录

重要说明：

- 当该开关为 `false` 时，R2 中会保留附件对象
- 当前项目**没有**第二条“独立附件回收策略”
- 这表示对象会被有意保留，后续如果需要单独回收，需要新增专门清理逻辑

## 部署配置注意事项

### 主应用/收信/清理的绑定要求

#### Pages / 主应用

- `DB`
- `SITE_CONFIG`
- `ATTACHMENTS`

#### Email Receiver Worker

- `DB`
- `ATTACHMENTS`
- 建议具备附件相关环境变量兜底（如存在）

#### Cleanup Worker

必须绑定：

- `DB`
- `SITE_CONFIG`
- `ATTACHMENTS`（当附件跟随邮箱过期清理时必需）

### wrangler 示例配置

附件相关配置已体现在：

- `wrangler.example.json`
- `wrangler.email.example.json`
- `wrangler.cleanup.example.json`

其中 `wrangler.cleanup.example.json` 现在必须包含：

- `kv_namespaces -> SITE_CONFIG`
- `r2_buckets -> ATTACHMENTS`

### 部署脚本

部署脚本：`scripts/deploy/index.ts`

当前行为：

- 会更新 `wrangler.cleanup.json` 中的 `R2` bucket 配置
- 会更新 `wrangler.cleanup.json` 中的 `KV namespace` 配置
- 在部署 cleanup worker 前，会校验是否存在 `ATTACHMENTS` 绑定

注意：

- 如果后续修改了 cleanup worker 依赖的绑定，部署脚本也要同步更新

## 配置是否会被重新部署覆盖

- 管理页面修改的附件配置保存在 `KV(SITE_CONFIG)` 中
- 正常重新 deploy **不会自动覆盖**这些配置
- 只有以下情况可能导致看起来“配置没了”：
  - 更换了 `KV_NAMESPACE_ID`
  - 部署脚本主动重写了 `SITE_CONFIG`
  - 人工在 Cloudflare 控制台或脚本中覆盖了 KV 值

## 国际化注意事项

本次新增了以下文案：

- `app/i18n/messages/zh-CN/profile.json`
- `app/i18n/messages/en/profile.json`
- `app/i18n/messages/zh-CN/emails.json`
- `app/i18n/messages/en/emails.json`

如果后续继续补 UI，请优先同步中英文文案；其他语言可视情况补齐。

## 后续修改建议

如果后续继续改附件能力，建议遵循这个顺序：

1. 先改 `app/lib/attachments.ts` 中的配置模型
2. 再改 `app/api/config/attachments/route.ts`
3. 再改对应 worker / API 真实生效逻辑
4. 最后补前端配置页面与 i18n 文案
5. 修改完执行 `npx tsc --noEmit`

## 已知待改进点

- 手动删除邮箱/邮件时，R2 删除失败仍会继续删库，可能产生孤儿对象
- `ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY=false` 时暂无独立附件回收机制
- 当前只补了中文、英文的新增文案，其他语言暂未同步

## 本地变更提醒

- 当前工作区里 `.gitignore` 存在未提交变更，不属于本次附件配置改动主线
- 后续提交时注意不要误把无关修改混入
