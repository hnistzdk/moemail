interface Env {
  DB: D1Database
  ATTACHMENTS?: R2Bucket
}

const CLEANUP_CONFIG = {
  // Whether to delete expired emails
  DELETE_EXPIRED_EMAILS: true,
  
  // Batch processing size
  BATCH_SIZE: 100,
} as const 

const ensureAttachmentsBucket = (env: Env): R2Bucket => {
  if (!env.ATTACHMENTS) {
    throw new Error('ATTACHMENTS R2 binding is required for cleanup worker')
  }

  return env.ATTACHMENTS
}

const main = {
  async scheduled(_: ScheduledEvent, env: Env) {
    const now = Date.now()

    try {
      const attachmentsBucket = ensureAttachmentsBucket(env)

      if (!CLEANUP_CONFIG.DELETE_EXPIRED_EMAILS) {
        console.log('Expired email deletion is disabled')
        return
      }

      const expiredEmails = await env.DB
        .prepare(`
          SELECT id
          FROM email
          WHERE expires_at < ?
          LIMIT ?
        `)
        .bind(now, CLEANUP_CONFIG.BATCH_SIZE)
        .all<{ id: string }>()

      const emailIds = (expiredEmails.results || []).map(item => item.id)

      if (emailIds.length === 0) {
        console.log('No expired emails found')
        return
      }

      const placeholders = emailIds.map(() => '?').join(',')

      const attachmentRows = await env.DB
        .prepare(`
          SELECT r2_key
          FROM attachment
          WHERE email_id IN (${placeholders})
        `)
        .bind(...emailIds)
        .all<{ r2_key: string }>()

      for (const row of attachmentRows.results || []) {
        await attachmentsBucket.delete(row.r2_key)
      }

      const result = await env.DB
        .prepare(`
          DELETE FROM email 
          WHERE id IN (${placeholders})
        `)
        .bind(...emailIds)
        .run()

      if (result.success) {
        console.log(`Deleted ${result?.meta?.changes ?? 0} expired emails and their associated messages`)
      } else {
        console.error('Failed to delete expired emails')
      }
    } catch (error) {
      console.error('Failed to cleanup:', error)
      throw error
    }
  }
}

export default main
