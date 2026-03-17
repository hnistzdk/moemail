import { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { attachments, emails, messages, webhooks } from '../app/lib/schema'
import { eq, sql } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { WEBHOOK_CONFIG } from '../app/config/webhook'
import { EmailMessage } from '../app/lib/webhook'
import {
  buildAttachmentDownloadUrl,
  buildAttachmentKey,
  formatAttachmentFileName,
  resolveAttachmentStorageConfig,
  shouldStoreAttachment,
} from '../app/lib/attachments'

const getSiteConfigValue = async (env: Env, key: string) => {
  try {
    return await env.SITE_CONFIG.get(key)
  } catch {
    return undefined
  }
}

const getEnvValue = (env: Env, key: string) => {
  return (env as unknown as Record<string, unknown>)[key]
}

const getAttachmentRuntimeConfig = async (env: Env) => {
  const [storageEnabled, maxFileSize, maxFilesPerMessage, allowedMimePrefixes, downloadEnabled, webhookIncludeLink, retentionFollowEmailExpiry] = await Promise.all([
    getSiteConfigValue(env, 'ATTACHMENT_STORAGE_ENABLED'),
    getSiteConfigValue(env, 'ATTACHMENT_MAX_FILE_SIZE'),
    getSiteConfigValue(env, 'ATTACHMENT_MAX_FILES_PER_MESSAGE'),
    getSiteConfigValue(env, 'ATTACHMENT_ALLOWED_MIME_PREFIXES'),
    getSiteConfigValue(env, 'ATTACHMENT_DOWNLOAD_ENABLED'),
    getSiteConfigValue(env, 'ATTACHMENT_WEBHOOK_INCLUDE_LINK'),
    getSiteConfigValue(env, 'ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY'),
  ])

  return resolveAttachmentStorageConfig({
    ATTACHMENT_STORAGE_ENABLED: storageEnabled ?? getEnvValue(env, 'ATTACHMENT_STORAGE_ENABLED'),
    ATTACHMENT_MAX_FILE_SIZE: maxFileSize ?? getEnvValue(env, 'ATTACHMENT_MAX_FILE_SIZE'),
    ATTACHMENT_MAX_FILES_PER_MESSAGE: maxFilesPerMessage ?? getEnvValue(env, 'ATTACHMENT_MAX_FILES_PER_MESSAGE'),
    ATTACHMENT_ALLOWED_MIME_PREFIXES: allowedMimePrefixes ?? getEnvValue(env, 'ATTACHMENT_ALLOWED_MIME_PREFIXES'),
    ATTACHMENT_DOWNLOAD_ENABLED: downloadEnabled ?? getEnvValue(env, 'ATTACHMENT_DOWNLOAD_ENABLED'),
    ATTACHMENT_WEBHOOK_INCLUDE_LINK: webhookIncludeLink ?? getEnvValue(env, 'ATTACHMENT_WEBHOOK_INCLUDE_LINK'),
    ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY: retentionFollowEmailExpiry ?? getEnvValue(env, 'ATTACHMENT_RETENTION_FOLLOW_EMAIL_EXPIRY'),
  })
}

const getAttachmentByteSize = (content: ArrayBuffer) => content.byteLength

const handleEmail = async (message: ForwardableEmailMessage, env: Env) => {
  const db = drizzle(env.DB, { schema: { attachments, emails, messages, webhooks } })
  const attachmentConfig = await getAttachmentRuntimeConfig(env)

  const parsedMessage = await PostalMime.parse(message.raw)

  console.log('parsedMessage:', parsedMessage)

  try {
    const targetEmail = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, message.to.toLowerCase())
    })

    if (!targetEmail) {
      console.error(`Email not found: ${message.to}`)
      return
    }

    const savedMessage = await db.insert(messages).values({
      emailId: targetEmail.id,
      fromAddress: message.from,
      subject: parsedMessage.subject || '(No subject)',
      content: parsedMessage.text || '',
      html: parsedMessage.html || '',
      type: 'received',
    }).returning().get()

    const savedAttachments: NonNullable<EmailMessage['attachments']> = []

    if (attachmentConfig.enabled && parsedMessage.attachments.length > 0) {
      const allowedAttachments = parsedMessage.attachments.slice(0, attachmentConfig.maxFilesPerMessage)

      for (const attachment of allowedAttachments) {
        const size = getAttachmentByteSize(attachment.content)
        if (!shouldStoreAttachment(attachmentConfig, attachment.mimeType, size)) {
          continue
        }

        try {
          const attachmentId = crypto.randomUUID()
          const filename = formatAttachmentFileName(attachment.filename)
          const r2Key = buildAttachmentKey(targetEmail.id, savedMessage.id, attachmentId)

          await env.ATTACHMENTS.put(r2Key, attachment.content, {
            httpMetadata: {
              contentType: attachment.mimeType,
            },
            customMetadata: {
              originalFilename: filename,
              emailId: targetEmail.id,
              messageId: savedMessage.id,
            },
          })

          await db.insert(attachments).values({
            id: attachmentId,
            messageId: savedMessage.id,
            emailId: targetEmail.id,
            filename,
            contentType: attachment.mimeType,
            size,
            r2Key,
            contentId: attachment.contentId || null,
            disposition: attachment.disposition || null,
          })

          savedAttachments.push({
            id: attachmentId,
            filename,
            contentType: attachment.mimeType,
            size,
            inline: attachment.disposition === 'inline',
            contentId: attachment.contentId || null,
            downloadUrl: attachmentConfig.downloadEnabled
              ? buildAttachmentDownloadUrl(targetEmail.id, savedMessage.id, attachmentId)
              : '',
          })
        } catch (attachmentError) {
          console.error('Failed to persist attachment:', attachmentError)
        }
      }
    }

    const webhook = await db.query.webhooks.findFirst({
      where: eq(webhooks.userId, targetEmail.userId!)
    })

    if (webhook?.enabled) {
      try {
        await fetch(webhook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Event': WEBHOOK_CONFIG.EVENTS.NEW_MESSAGE
          },
          body: JSON.stringify({
            emailId: targetEmail.id,
            messageId: savedMessage.id,
            fromAddress: savedMessage.fromAddress,
            subject: savedMessage.subject,
            content: savedMessage.content,
            html: savedMessage.html,
            receivedAt: savedMessage.receivedAt.toISOString(),
            toAddress: targetEmail.address,
            attachments: attachmentConfig.webhookIncludeLink
              ? savedAttachments
              : savedAttachments.map(attachment => ({
                  ...attachment,
                  downloadUrl: '',
                })),
          } as EmailMessage)
        })
      } catch (error) {
        console.error('Failed to send webhook:', error)
      }
    }

    console.log(`Email processed: ${parsedMessage.subject}`)
  } catch (error) {
    console.error('Failed to process email:', error)
  }
}

const worker = {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env)
  }
}

export default worker
