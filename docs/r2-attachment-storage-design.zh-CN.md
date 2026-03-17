# R2 附件存储设计方案

## 背景

当前项目在收信时已经通过 `PostalMime.parse(message.raw)` 解析邮件内容，但只保存了邮件正文、HTML、发件人、主题等信息，没有对附件做持久化处理。

这会带来两个直接问题：

- 用户收到带附件的邮件时，网页端无法查看或下载附件
- Webhook 虽然可以收到新邮件通知，但无法拿到附件内容或附件访问地址

结合上游仓库的讨论：

- `issue #24` 说明当前项目确实未实现附件转储
- `issue #64` 提出了将附件保存到 Cloudflare R2，并在 Webhook 中暴露附件链接的需求

本方案目标是在不明显增加账单风险的前提下，为项目增加一套可控的 R2 附件存储能力。

---

## 目标

- 收信时自动解析附件
- 将附件二进制存储到 Cloudflare R2
- 将附件元数据存储到 D1
- 邮件详情接口返回附件列表
- Webhook 可返回附件元数据和下载地址
- 附件生命周期跟随邮箱或消息生命周期清理
- 默认具备控费能力，避免长期无上限写入和存储

## 非目标

- 第一阶段不做复杂附件预览编辑
- 第一阶段不做跨邮件附件去重
- 第一阶段不做超大附件分片断点续传控制台
- 第一阶段不直接暴露公开 Bucket 链接
- 第一阶段不优先支持分享链接直接下载附件

---

## 当前实现现状

### 关键入口

- 收信 Worker：`workers/email-receiver.ts`
- 消息表定义：`app/lib/schema.ts`
- Webhook 类型：`app/lib/webhook.ts`
- 环境绑定声明：`types.d.ts`

### 当前邮件处理流程

1. Cloudflare Email Routing 将邮件投递给 `workers/email-receiver.ts`
2. Worker 使用 `PostalMime.parse(message.raw)` 解析邮件
3. 将正文、HTML、主题、发件人等保存到 `messages` 表
4. 如果配置了 webhook，则将消息正文信息 POST 给外部地址

### 当前缺失能力

- 没有附件表
- 没有 R2 绑定
- 没有附件下载接口
- Webhook 中没有附件字段
- 清理任务不会清理附件对象

---

## 总体设计

采用以下双层存储结构：

- `D1`：保存附件元数据
- `R2`：保存附件实际二进制对象

设计原则：

- 邮件正文保存优先，附件保存失败不能阻断主流程
- 附件持久化为可选能力，不默认强制开启
- 下载必须走站内鉴权接口，不直接公开 R2
- 清理策略优先保证不会产生大量孤儿对象

---

## 数据模型设计

建议新增一张 `attachments` 表。

### 表结构建议

字段建议如下：

- `id`: `text`，主键，UUID
- `messageId`: `text`，关联 `messages.id`
- `emailId`: `text`，关联 `emails.id`
- `filename`: `text`，原始文件名
- `contentType`: `text`，附件 MIME 类型
- `size`: `integer`，字节大小
- `r2Key`: `text`，R2 对象键
- `contentId`: `text`，用于 inline 资源引用
- `disposition`: `text`，如 `attachment` 或 `inline`
- `sha256`: `text`，可选，预留给后续去重或校验
- `createdAt`: `integer(timestamp_ms)`

### 索引建议

- `messageIdIdx`
- `emailIdIdx`
- `createdAtIdx`
- `r2KeyUnique` 或普通索引

### 为什么要冗余 `emailId`

虽然可以通过 `messageId -> message -> email` 反查邮箱，但在清理过期邮箱时，直接通过 `emailId` 批量查附件更简单，SQL 更轻，代码也更直观。

---

## R2 对象命名方案

建议使用稳定、无歧义的 Key 规则：

```text
attachments/{emailId}/{messageId}/{attachmentId}
```

不建议把原始文件名直接作为对象 key 的一部分，因为：

- 文件名可能包含空格、特殊字符、编码问题
- 文件名不一定唯一
- 后续改名会增加兼容成本

原始文件名保存在 D1 中即可。

### 可选对象元数据

写入 R2 时可附带对象元数据：

- `contentType`
- `originalFilename`
- `emailId`
- `messageId`

---

## 环境与配置设计

### Cloudflare 绑定

需要增加 R2 Bucket 绑定，例如：

- `ATTACHMENTS: R2Bucket`

涉及文件：

- `types.d.ts`
- `wrangler.email.example.json`
- `wrangler.example.json`

### 配置项建议

建议增加以下配置项：

- `ATTACHMENT_STORAGE_ENABLED`
- `ATTACHMENT_MAX_FILE_SIZE`
- `ATTACHMENT_MAX_FILES_PER_MESSAGE`
- `ATTACHMENT_ALLOWED_MIME_PREFIXES`
- `ATTACHMENT_ALLOWED_MIME_TYPES`
- `ATTACHMENT_DOWNLOAD_ENABLED`
- `ATTACHMENT_WEBHOOK_INCLUDE_LINK`
- `ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY`

### 推荐默认值

```text
ATTACHMENT_STORAGE_ENABLED=false
ATTACHMENT_MAX_FILE_SIZE=5242880
ATTACHMENT_MAX_FILES_PER_MESSAGE=3
ATTACHMENT_ALLOWED_MIME_PREFIXES=image/,application/pdf
ATTACHMENT_DOWNLOAD_ENABLED=true
ATTACHMENT_WEBHOOK_INCLUDE_LINK=true
ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY=true
```

说明：

- 默认关闭，避免用户部署后立刻引入 R2 成本
- 单附件默认 5MB，适合图片和 PDF 场景
- 每封最多 3 个附件，避免极端写入

---

## 收信链路设计

### 目标流程

```text
接收邮件
  ↓
PostalMime 解析邮件
  ↓
保存 messages 正文
  ↓
筛选允许存储的附件
  ↓
写入 R2
  ↓
写入 attachments 元数据到 D1
  ↓
发送 webhook（附带附件信息）
```

### 关键原则

- 正文保存成功比附件保存更重要
- 附件失败不能导致整封邮件丢失
- 附件保存为增强能力，不是主链路强依赖

### 附件筛选规则

收信时对每个附件依次判断：

1. 若 `ATTACHMENT_STORAGE_ENABLED=false`，直接跳过
2. 若附件数量超过上限，仅保留前 N 个
3. 若单附件大小超过上限，跳过
4. 若 `contentType` 不在允许范围内，跳过
5. 若附件内容为空或解析异常，跳过

### 失败策略

允许以下状态存在：

- 邮件正文成功，附件全部成功
- 邮件正文成功，附件部分成功
- 邮件正文成功，附件全部跳过
- 邮件正文成功，附件全部失败

建议对附件处理错误只记录日志，不抛出导致主流程失败。

---

## Webhook 设计

当前 `EmailMessage` 结构只包含正文信息，建议扩展附件字段。

### 建议结构

新增：

- `attachments?: AttachmentWebhookItem[]`

字段建议：

- `id`
- `filename`
- `contentType`
- `size`
- `inline`
- `contentId`
- `downloadUrl`

### 访问地址策略

不建议直接返回公开的 R2 URL，建议返回站内下载接口：

```text
/api/emails/{emailId}/{messageId}/attachments/{attachmentId}
```

这样可以：

- 统一走项目现有权限体系
- 不需要公开 Bucket
- 后续可以平滑切换签名 URL 或其他存储方式

### Webhook 模式建议

可支持两个级别：

- `metadata-only`：只返回附件元数据
- `store-and-link`：返回元数据和站内下载地址

第一阶段建议直接实现 `store-and-link`，但允许通过配置关闭链接返回。

---

## API 设计

### 1. 邮件详情接口扩展

文件：`app/api/emails/[id]/[messageId]/route.ts`

在当前返回结构中增加：

- `attachments`

返回项建议包含：

- `id`
- `filename`
- `contentType`
- `size`
- `inline`
- `downloadUrl`

### 2. 附件下载接口

建议新增接口：

```text
app/api/emails/[id]/[messageId]/attachments/[attachmentId]/route.ts
```

处理逻辑：

1. 校验当前用户是否拥有邮箱访问权限
2. 查询附件元数据
3. 从 R2 读取对象
4. 设置响应头并流式返回

建议响应头：

- `Content-Type`
- `Content-Length`
- `Content-Disposition`

其中：

- 图片或可内联内容可按 `inline`
- 其他大多建议 `attachment`

### 3. 共享链接附件访问

第一阶段建议**暂不支持**。

原因：

- 会增加 token 权限模型复杂度
- 先把登录用户自己的附件场景做稳定更划算

第二阶段可考虑扩展到：

- `email share`
- `message share`

---

## 前端 UI 设计

第一阶段 UI 保持最小可用即可。

### 邮件详情页展示

建议新增附件区域：

- 文件名
- 类型
- 大小
- 下载按钮

### 无附件存储时的提示

如果解析到邮件有附件，但站点未启用附件存储，可以显示提示：

```text
该邮件可能包含附件，但当前站点未启用附件存储。
```

这能直接改善 `issue #24` 中提到的“只能看到标题，看不到附件，用户不知道发生了什么”的体验问题。

---

## 清理策略

### 目标

- 避免 R2 存储长期累积
- 避免邮箱过期后留下孤儿对象
- 使用免费删除操作控制成本

### 建议策略

依托现有 `workers/cleanup.ts`，在清理过期邮箱时一并清理附件：

1. 查出过期邮箱
2. 查出对应附件的 `r2Key`
3. 删除 R2 对象
4. 删除附件元数据
5. 删除邮箱和消息

### 顺序建议

建议优先：

```text
删除 R2 对象 → 删除 attachments 记录 → 删除 message/email
```

原因是如果先删数据库，后删对象失败，容易残留不可追踪的孤儿对象。

### 批量处理建议

如果后续附件规模变大，可演进为分批清理：

- 每轮只处理固定数量过期邮箱
- 每轮只处理固定数量附件对象

第一阶段可先保持简单实现。

---

## 成本与控费分析

### 已核实的 R2 免费额度

Cloudflare R2 免费层包含：

- 存储：`10 GB-month / 月`
- Class A：`1,000,000 次 / 月`
- Class B：`10,000,000 次 / 月`
- `DeleteObject` 免费

其中：

- `PutObject` 属于 Class A
- `GetObject` 属于 Class B

### 风险判断

对于 moemail 这种临时邮箱场景，真正更需要警惕的是：

- 附件对象长期累积导致存储持续增长
- 下载过于频繁导致 Class B 读取过多

反而单看写入次数，只要没有达到非常大的邮件规模，通常不容易先碰到 100 万/月的免费上限。

### 粗略量级估算

若按一个附件约对应一次 `PutObject`：

- 每月 `2 万` 个附件 ≈ `2 万` 次写入
- 每月 `10 万` 个附件 ≈ `10 万` 次写入
- 每月 `50 万` 个附件 ≈ `50 万` 次写入

只要附件量级不接近百万级，写入成本一般可控。

### 真正建议的控费手段

#### 1. 默认关闭附件持久化

不让所有部署实例默认启用 R2。

#### 2. 限制 MIME 类型

建议默认仅允许：

- `image/*`
- `application/pdf`

#### 3. 限制单附件大小

建议默认 5MB。

#### 4. 限制每封邮件可持久化的附件数量

建议默认 3 个。

#### 5. 生命周期跟随邮箱过期

这是最关键的控存储策略。

#### 6. 后续可增加用户级配额

可扩展为：

- 每用户每月最多保存多少附件
- 每用户每月最多保存多少字节

### 结论

只要同时满足：

- 默认关闭
- 限类型
- 限大小
- 限数量
- 自动删除

则引入 R2 附件存储后，**一般不会轻易把 Cloudflare 免费写入额度打爆**。

---

## 推荐实施范围（第一阶段）

建议第一阶段只实现以下能力：

- R2 附件存储
- D1 附件元数据表
- 消息详情返回附件列表
- 登录用户下载附件
- Webhook 返回附件元数据和站内下载地址
- 清理任务自动删除过期附件

暂不实现：

- 分享页附件下载
- 高级预览能力
- 内容去重
- 复杂配额后台管理

这是当前性价比最高、风险最低的版本。

---

## 实施顺序建议

建议按以下顺序推进：

1. 新增 `attachments` 表和 migration
2. 增加 R2 绑定与环境类型
3. 扩展 `workers/email-receiver.ts`，实现附件写入 R2 + D1
4. 扩展消息详情接口，返回附件元数据
5. 新增附件下载接口
6. 前端邮件详情页显示附件列表和下载按钮
7. 扩展 webhook 附件字段
8. 扩展 `workers/cleanup.ts`，删除过期附件对象

---

## 涉及文件清单（预估）

预计会改动或新增以下文件：

- `workers/email-receiver.ts`
- `workers/cleanup.ts`
- `app/lib/schema.ts`
- `app/lib/webhook.ts`
- `app/api/emails/[id]/[messageId]/route.ts`
- `app/components/emails/message-view.tsx`
- `types.d.ts`
- `wrangler.email.example.json`
- `wrangler.example.json`
- `drizzle/*` migration 文件
- 新增附件下载接口文件

---

## 风险点

### 1. Worker 资源消耗

大附件会增加 Worker 处理时的 CPU / 内存压力，因此必须限制单附件大小。

### 2. 清理一致性

如果只删 D1 不删 R2，会产生孤儿对象，因此清理流程必须明确。

### 3. 权限控制

如果直接暴露公开 URL，后续权限收紧会很困难，因此一开始就应通过站内接口访问。

### 4. 分享链接复杂度

附件下载一旦进入分享场景，权限模型和滥用风险都会增加，所以建议分阶段推进。

---

## 最终建议

建议以“默认关闭、按需开启、带严格限制”的方式实现 R2 附件存储。

### 推荐默认策略

- 默认关闭附件持久化
- 开启后仅支持 `PDF + 图片`
- 单附件不超过 `5MB`
- 每封最多 `3` 个附件
- 附件生命周期跟随邮箱过期
- 下载统一走站内 API
- Webhook 返回元数据和站内下载地址

这是目前最平衡的方案：

- 能满足上游 `issue #64` 的主要目标
- 能解释并解决 `issue #24` 暴露的用户体验问题
- 能最大程度压住 R2 使用成本和复杂度

---

## 后续可选增强项

后续若第一阶段上线稳定，可再考虑：

- 分享链接支持附件下载
- 管理后台配额设置
- 用户级附件统计
- 附件预览（图片/PDF）
- 内容哈希去重
- 外链签名下载 URL

