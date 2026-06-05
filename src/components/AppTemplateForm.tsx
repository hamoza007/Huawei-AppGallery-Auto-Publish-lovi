"use client";
import { useEffect, useState } from "react";

interface AppInfoTemplate {
  defaultLang?: string;
  parentType?: number;
  childType?: number;
  grandChildType?: number;
  publishCountry?: string;
  privacyPolicy?: string;
}

export function AppTemplateForm() {
  const [t, setT] = useState<AppInfoTemplate>({});
  const [captureAppId, setCaptureAppId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/app-template")
      .then((r) => r.json())
      .then((d: { template: AppInfoTemplate }) => {
        setT(d.template ?? {});
        setLoaded(true);
      })
      .catch(() => setError("Failed to load template"));
  }, []);

  function set<K extends keyof AppInfoTemplate>(key: K, value: AppInfoTemplate[K]) {
    setT((prev) => ({ ...prev, [key]: value }));
  }

  async function post(payload: Record<string, unknown>, okMsg: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    const res = await fetch("/api/app-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) {
      const d = (await res.json()) as { template: AppInfoTemplate };
      setT(d.template ?? {});
      setStatus(okMsg);
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setError(d.error || "Request failed");
    }
  }

  const countryCount = (t.publishCountry ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean).length;

  if (!loaded) return <p className="text-sm text-neutral-500">Loading template…</p>;

  return (
    <div className="space-y-5">
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <label className="label">Capture from a configured app (recommended)</label>
        <p className="mb-2 text-xs text-neutral-500">
          Enter the AGC App ID of an app you&apos;ve already set up correctly (category, countries,
          privacy policy). We read its exact settings via the API and reuse them for every upload —
          no need to look up category IDs manually.
        </p>
        <div className="flex gap-2">
          <input
            className="input"
            value={captureAppId}
            onChange={(e) => setCaptureAppId(e.target.value)}
            placeholder="e.g. 117918145"
          />
          <button
            className="btn-primary whitespace-nowrap"
            disabled={busy || !captureAppId.trim()}
            onClick={() => post({ captureAppId: captureAppId.trim() }, "Captured settings from app and saved as the template.")}
          >
            {busy ? "Working…" : "Capture"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Category · parentType</label>
          <input
            className="input"
            value={t.parentType ?? ""}
            onChange={(e) => set("parentType", e.target.value ? Number(e.target.value) : undefined)}
            placeholder="e.g. 2 (Games)"
          />
        </div>
        <div>
          <label className="label">childType</label>
          <input
            className="input"
            value={t.childType ?? ""}
            onChange={(e) => set("childType", e.target.value ? Number(e.target.value) : undefined)}
            placeholder="e.g. 20"
          />
        </div>
        <div>
          <label className="label">grandChildType</label>
          <input
            className="input"
            value={t.grandChildType ?? ""}
            onChange={(e) => set("grandChildType", e.target.value ? Number(e.target.value) : undefined)}
            placeholder="e.g. 10115"
          />
        </div>
      </div>

      <div>
        <label className="label">Privacy policy URL</label>
        <input
          className="input"
          value={t.privacyPolicy ?? ""}
          onChange={(e) => set("privacyPolicy", e.target.value || undefined)}
          placeholder="https://example.com/privacy"
        />
      </div>

      <div>
        <label className="label">
          Distribution countries{countryCount > 0 ? ` (${countryCount})` : ""}
        </label>
        <textarea
          className="input min-h-[80px] font-mono text-xs"
          value={t.publishCountry ?? ""}
          onChange={(e) => set("publishCountry", e.target.value || undefined)}
          placeholder="US,GB,DE,FR,AE,SA  (comma-separated ISO codes; omit CN for 'all except China')"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Any invalid/duplicate codes and Huawei&apos;s synthetic &quot;ALL&quot; token are stripped automatically on save.
        </p>
      </div>

      <div>
        <label className="label">Default language</label>
        <input
          className="input"
          value={t.defaultLang ?? ""}
          onChange={(e) => set("defaultLang", e.target.value || undefined)}
          placeholder="en-US"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          onClick={() =>
            post(
              {
                defaultLang: t.defaultLang,
                parentType: t.parentType,
                childType: t.childType,
                grandChildType: t.grandChildType,
                privacyPolicy: t.privacyPolicy,
                publishCountry: t.publishCountry,
              },
              "Saved. These values are applied automatically after every upload.",
            )
          }
          disabled={busy}
        >
          {busy ? "Saving…" : "Save template"}
        </button>
        {status && <span className="text-sm text-green-600">{status}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
