import { getRequestContext } from "@cloudflare/next-on-pages"
import { NextResponse } from "next/server"
import { and, eq } from "drizzle-orm"
import { createDb } from "@/lib/db"
import { attachments, emails, messages } from "@/lib/schema"
import { getUserId } from "@/lib/apiKey"
import { ATTACHMENT_CONFIG_KEYS } from "@/lib/attachments"

export const runtime = "edge"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; messageId: string; attachmentId: string }> }
) {
  try {
    const downloadEnabled = await getRequestContext().env.SITE_CONFIG.get(ATTACHMENT_CONFIG_KEYS.downloadEnabled)
    if (String(downloadEnabled || "true").toLowerCase() === "false") {
      return NextResponse.json(
        { error: "Attachment download is disabled" },
        { status: 403 }
      )
    }

    const userId = await getUserId()
    const { id, messageId, attachmentId } = await params
    const db = createDb()

    const email = await db.query.emails.findFirst({
      where: and(
        eq(emails.id, id),
        eq(emails.userId, userId!)
      )
    })

    if (!email) {
      return NextResponse.json(
        { error: "Email not found or no permission to view" },
        { status: 403 }
      )
    }

    const message = await db.query.messages.findFirst({
      where: and(
        eq(messages.id, messageId),
        eq(messages.emailId, id)
      )
    })

    if (!message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 }
      )
    }

    const attachment = await db.query.attachments.findFirst({
      where: and(
        eq(attachments.id, attachmentId),
        eq(attachments.messageId, messageId),
        eq(attachments.emailId, id)
      )
    })

    if (!attachment) {
      return NextResponse.json(
        { error: "Attachment not found" },
        { status: 404 }
      )
    }

    const object = await getRequestContext().env.ATTACHMENTS.get(attachment.r2Key)

    if (!object?.body) {
      return NextResponse.json(
        { error: "Attachment object not found" },
        { status: 404 }
      )
    }

    const headers = new Headers()
    headers.set("Content-Type", attachment.contentType)
    headers.set("Content-Length", attachment.size.toString())
    headers.set(
      "Content-Disposition",
      `${attachment.disposition === 'inline' ? 'inline' : 'attachment'}; filename="${encodeURIComponent(attachment.filename || 'attachment')}"`
    )

    return new Response(object.body, { headers })
  } catch (error) {
    console.error("Failed to download attachment:", error)
    return NextResponse.json(
      { error: "Failed to download attachment" },
      { status: 500 }
    )
  }
}
