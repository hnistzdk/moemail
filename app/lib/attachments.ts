const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024
const DEFAULT_MAX_FILES_PER_MESSAGE = 3
const DEFAULT_ALLOWED_PREFIXES = ["image/", "application/pdf"]

export const ATTACHMENT_CONFIG_KEYS = {
  storageEnabled: "ATTACHMENT_STORAGE_ENABLED",
  maxFileSize: "ATTACHMENT_MAX_FILE_SIZE",
  maxFilesPerMessage: "ATTACHMENT_MAX_FILES_PER_MESSAGE",
  allowedMimePrefixes: "ATTACHMENT_ALLOWED_MIME_PREFIXES",
  downloadEnabled: "ATTACHMENT_DOWNLOAD_ENABLED",
  webhookIncludeLink: "ATTACHMENT_WEBHOOK_INCLUDE_LINK",
  retentionFollowEmailExpiry: "ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY",
} as const

export interface AttachmentStorageConfig {
  enabled: boolean
  maxFileSize: number
  maxFilesPerMessage: number
  allowedMimePrefixes: string[]
  downloadEnabled: boolean
  webhookIncludeLink: boolean
  retentionFollowEmailExpiry: boolean
}

export interface AttachmentConfigPayload {
  enabled: boolean
  maxFileSize: number
  maxFilesPerMessage: number
  allowedMimePrefixes: string[]
  downloadEnabled: boolean
  webhookIncludeLink: boolean
  retentionFollowEmailExpiry: boolean
}

export interface StoredAttachment {
  id: string
  messageId: string
  emailId: string
  filename: string | null
  contentType: string
  size: number
  r2Key: string
  contentId: string | null
  disposition: string | null
}

export function resolveAttachmentStorageConfig(env: Record<string, unknown>) {
  const rawPrefixes = String(env[ATTACHMENT_CONFIG_KEYS.allowedMimePrefixes] || "")
  const maxFileSize = Number(env[ATTACHMENT_CONFIG_KEYS.maxFileSize])
  const maxFilesPerMessage = Number(env[ATTACHMENT_CONFIG_KEYS.maxFilesPerMessage])

  return {
    enabled: String(env[ATTACHMENT_CONFIG_KEYS.storageEnabled] || "false").toLowerCase() === "true",
    maxFileSize: Number.isFinite(maxFileSize) && maxFileSize > 0 ? maxFileSize : DEFAULT_MAX_FILE_SIZE,
    maxFilesPerMessage: Number.isFinite(maxFilesPerMessage) && maxFilesPerMessage > 0 ? maxFilesPerMessage : DEFAULT_MAX_FILES_PER_MESSAGE,
    allowedMimePrefixes: rawPrefixes.trim()
      ? rawPrefixes.split(",").map(item => item.trim()).filter(Boolean)
      : DEFAULT_ALLOWED_PREFIXES,
    downloadEnabled: String(env[ATTACHMENT_CONFIG_KEYS.downloadEnabled] || "true").toLowerCase() !== "false",
    webhookIncludeLink: String(env[ATTACHMENT_CONFIG_KEYS.webhookIncludeLink] || "true").toLowerCase() !== "false",
    retentionFollowEmailExpiry: String(env[ATTACHMENT_CONFIG_KEYS.retentionFollowEmailExpiry] || "true").toLowerCase() !== "false",
  } satisfies AttachmentStorageConfig
}

export function normalizeAttachmentConfig(input: Partial<AttachmentConfigPayload> | null | undefined): AttachmentConfigPayload {
  const rawPrefixes = Array.isArray(input?.allowedMimePrefixes)
    ? input?.allowedMimePrefixes
    : String(input?.allowedMimePrefixes || "").split(",")

  const maxFileSize = Number(input?.maxFileSize)
  const maxFilesPerMessage = Number(input?.maxFilesPerMessage)

  return {
    enabled: Boolean(input?.enabled),
    maxFileSize: Number.isFinite(maxFileSize) && maxFileSize > 0 ? maxFileSize : DEFAULT_MAX_FILE_SIZE,
    maxFilesPerMessage: Number.isFinite(maxFilesPerMessage) && maxFilesPerMessage > 0 ? maxFilesPerMessage : DEFAULT_MAX_FILES_PER_MESSAGE,
    allowedMimePrefixes: rawPrefixes.map(item => String(item).trim()).filter(Boolean),
    downloadEnabled: input?.downloadEnabled ?? true,
    webhookIncludeLink: input?.webhookIncludeLink ?? true,
    retentionFollowEmailExpiry: input?.retentionFollowEmailExpiry ?? true,
  }
}

export function serializeAttachmentConfig(config: AttachmentConfigPayload) {
  return {
    [ATTACHMENT_CONFIG_KEYS.storageEnabled]: config.enabled.toString(),
    [ATTACHMENT_CONFIG_KEYS.maxFileSize]: config.maxFileSize.toString(),
    [ATTACHMENT_CONFIG_KEYS.maxFilesPerMessage]: config.maxFilesPerMessage.toString(),
    [ATTACHMENT_CONFIG_KEYS.allowedMimePrefixes]: config.allowedMimePrefixes.join(","),
    [ATTACHMENT_CONFIG_KEYS.downloadEnabled]: config.downloadEnabled.toString(),
    [ATTACHMENT_CONFIG_KEYS.webhookIncludeLink]: config.webhookIncludeLink.toString(),
    [ATTACHMENT_CONFIG_KEYS.retentionFollowEmailExpiry]: config.retentionFollowEmailExpiry.toString(),
  }
}

export function getAllowedAttachmentPrefixes(config: AttachmentStorageConfig) {
  const raw = config.allowedMimePrefixes.join(",")
  if (!raw.trim()) return DEFAULT_ALLOWED_PREFIXES
  return raw.split(",").map(item => item.trim()).filter(Boolean)
}

export function buildAttachmentKey(emailId: string, messageId: string, attachmentId: string) {
  return `attachments/${emailId}/${messageId}/${attachmentId}`
}

export function shouldStoreAttachment(
  config: AttachmentStorageConfig,
  contentType: string | null | undefined,
  size: number
) {
  if (!config.enabled) return false
  if (!contentType) return false
  if (size <= 0 || size > config.maxFileSize) return false

  const prefixes = getAllowedAttachmentPrefixes(config)
  return prefixes.some(prefix => contentType.startsWith(prefix))
}

export function formatAttachmentFileName(filename: string | null | undefined, fallback = "attachment") {
  return filename?.trim() || fallback
}

export function buildAttachmentDownloadUrl(emailId: string, messageId: string, attachmentId: string) {
  return `/api/emails/${emailId}/${messageId}/attachments/${attachmentId}`
}
