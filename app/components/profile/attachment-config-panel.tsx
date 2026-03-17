"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"

interface AttachmentConfig {
  enabled: boolean
  maxFileSize: number
  maxFilesPerMessage: number
  allowedMimePrefixes: string[]
  downloadEnabled: boolean
  webhookIncludeLink: boolean
  retentionFollowEmailExpiry: boolean
}

const DEFAULT_CONFIG: AttachmentConfig = {
  enabled: false,
  maxFileSize: 5 * 1024 * 1024,
  maxFilesPerMessage: 3,
  allowedMimePrefixes: ["image/", "application/pdf"],
  downloadEnabled: true,
  webhookIncludeLink: true,
  retentionFollowEmailExpiry: true,
}

export function AttachmentConfigPanel() {
  const t = useTranslations("profile.attachment")
  const { toast } = useToast()
  const [config, setConfig] = useState<AttachmentConfig>(DEFAULT_CONFIG)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const response = await fetch("/api/config/attachments")
        if (!response.ok) throw new Error(t("loadFailed"))

        const data = await response.json() as AttachmentConfig
        setConfig({
          ...data,
          allowedMimePrefixes: data.allowedMimePrefixes?.length ? data.allowedMimePrefixes : DEFAULT_CONFIG.allowedMimePrefixes,
        })
      } catch (error) {
        toast({
          title: t("loadFailed"),
          description: error instanceof Error ? error.message : t("loadFailed"),
          variant: "destructive",
        })
      }
    }

    fetchConfig()
  }, [t, toast])

  const handleSave = async () => {
    setLoading(true)

    try {
      const response = await fetch("/api/config/attachments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      })

      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error || t("saveFailed"))
      }

      toast({
        title: t("saveSuccess"),
        description: t("saveSuccess"),
      })
    } catch (error) {
      toast({
        title: t("saveFailed"),
        description: error instanceof Error ? error.message : t("saveFailed"),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Paperclip className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-dashed border-primary/40 p-4">
          <div className="space-y-1">
            <Label htmlFor="attachment-enabled" className="text-sm font-medium">
              {t("enabled")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("enabledDescription")}</p>
          </div>
          <Switch
            id="attachment-enabled"
            checked={config.enabled}
            onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, enabled: checked }))}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="attachment-max-size">{t("maxFileSize")}</Label>
            <Input
              id="attachment-max-size"
              type="number"
              min="1"
              value={config.maxFileSize}
              onChange={(event) => setConfig((prev) => ({ ...prev, maxFileSize: Number(event.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground">{t("maxFileSizeDescription")}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="attachment-max-files">{t("maxFilesPerMessage")}</Label>
            <Input
              id="attachment-max-files"
              type="number"
              min="1"
              value={config.maxFilesPerMessage}
              onChange={(event) => setConfig((prev) => ({ ...prev, maxFilesPerMessage: Number(event.target.value) || 0 }))}
            />
            <p className="text-xs text-muted-foreground">{t("maxFilesPerMessageDescription")}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment-mime-prefixes">{t("allowedMimePrefixes")}</Label>
          <Input
            id="attachment-mime-prefixes"
            value={config.allowedMimePrefixes.join(",")}
            onChange={(event) => setConfig((prev) => ({
              ...prev,
              allowedMimePrefixes: event.target.value.split(",").map(item => item.trim()).filter(Boolean),
            }))}
            placeholder={t("allowedMimePrefixesPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">{t("allowedMimePrefixesDescription")}</p>
        </div>

        <div className="space-y-3 rounded-lg border border-dashed border-primary/40 p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="attachment-download-enabled" className="text-sm font-medium">
                {t("downloadEnabled")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("downloadEnabledDescription")}</p>
            </div>
            <Switch
              id="attachment-download-enabled"
              checked={config.downloadEnabled}
              onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, downloadEnabled: checked }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="attachment-webhook-link" className="text-sm font-medium">
                {t("webhookIncludeLink")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("webhookIncludeLinkDescription")}</p>
            </div>
            <Switch
              id="attachment-webhook-link"
              checked={config.webhookIncludeLink}
              onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, webhookIncludeLink: checked }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="attachment-retention-follow-email-expiry" className="text-sm font-medium">
                {t("retentionFollowEmailExpiry")}
              </Label>
              <p className="text-xs text-muted-foreground">{t("retentionFollowEmailExpiryDescription")}</p>
            </div>
            <Switch
              id="attachment-retention-follow-email-expiry"
              checked={config.retentionFollowEmailExpiry}
              onCheckedChange={(checked) => setConfig((prev) => ({ ...prev, retentionFollowEmailExpiry: checked }))}
            />
          </div>
        </div>

        <Button onClick={handleSave} disabled={loading} className="w-full">
          {loading ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  )
}
