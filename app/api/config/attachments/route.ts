import { NextResponse } from "next/server"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { checkPermission } from "@/lib/auth"
import { PERMISSIONS } from "@/lib/permissions"
import {
  ATTACHMENT_CONFIG_KEYS,
  normalizeAttachmentConfig,
  resolveAttachmentStorageConfig,
  serializeAttachmentConfig,
  type AttachmentConfigPayload,
} from "@/lib/attachments"

export const runtime = "edge"

const parseBoolean = (value: unknown) => typeof value === "boolean"

const validateAttachmentConfig = (config: AttachmentConfigPayload) => {
  if (!Number.isFinite(config.maxFileSize) || config.maxFileSize <= 0) {
    return "最大附件大小必须大于 0"
  }

  if (!Number.isInteger(config.maxFilesPerMessage) || config.maxFilesPerMessage <= 0) {
    return "单封邮件最大附件数必须为正整数"
  }

  if (!config.allowedMimePrefixes.length) {
    return "允许的 MIME 前缀不能为空"
  }

  if (config.allowedMimePrefixes.some(prefix => !prefix.trim())) {
    return "允许的 MIME 前缀格式无效"
  }

  return null
}

export async function GET() {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  if (!canAccess) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 })
  }

  try {
    const env = getRequestContext().env
    const values = await Promise.all([
      env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.storageEnabled),
      env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.maxFileSize),
      env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.maxFilesPerMessage),
      env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.allowedMimePrefixes),
      env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.downloadEnabled),
      env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.webhookIncludeLink),
      env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.retentionFollowEmailExpiry),
    ])

    const config = resolveAttachmentStorageConfig({
      [ATTACHMENT_CONFIG_KEYS.storageEnabled]: values[0],
      [ATTACHMENT_CONFIG_KEYS.maxFileSize]: values[1],
      [ATTACHMENT_CONFIG_KEYS.maxFilesPerMessage]: values[2],
      [ATTACHMENT_CONFIG_KEYS.allowedMimePrefixes]: values[3],
      [ATTACHMENT_CONFIG_KEYS.downloadEnabled]: values[4],
      [ATTACHMENT_CONFIG_KEYS.webhookIncludeLink]: values[5],
      [ATTACHMENT_CONFIG_KEYS.retentionFollowEmailExpiry]: values[6],
    })

    return NextResponse.json(config)
  } catch (error) {
    console.error("Failed to get attachment config:", error)
    return NextResponse.json({ error: "获取附件配置失败" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  if (!canAccess) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 })
  }

  try {
    const body = await request.json() as Partial<AttachmentConfigPayload>
    const normalized = normalizeAttachmentConfig(body)

    if (!parseBoolean(body.enabled) || !parseBoolean(body.downloadEnabled) || !parseBoolean(body.webhookIncludeLink) || !parseBoolean(body.retentionFollowEmailExpiry)) {
      return NextResponse.json({ error: "布尔配置格式无效" }, { status: 400 })
    }

    const validationError = validateAttachmentConfig(normalized)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const env = getRequestContext().env
    const serialized = serializeAttachmentConfig(normalized)
    await Promise.all(
      Object.entries(serialized).map(([key, value]) => env.SITE_CONFIG.put(key, value))
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to save attachment config:", error)
    return NextResponse.json({ error: "保存附件配置失败" }, { status: 500 })
  }
}
