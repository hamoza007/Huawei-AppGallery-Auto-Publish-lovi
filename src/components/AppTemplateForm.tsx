"use client";
import { useEffect, useState } from "react";

interface AppInfoTemplate {
  defaultLang?: string;
  parentType?: number;
  childType?: number;
  grandChildType?: number;
  publishCountry?: string;
  privacyPolicy?: string;
  deviceTypes?: string;
  isFree?: boolean;
  collectPersonalData?: boolean;
  genAiNotInvolved?: boolean;
  releaseImmediately?: boolean;
  autoSubmitForReview?: boolean;
  autoContentRating?: boolean;
  isGameCasual?: boolean;
}

// All Huawei-supported country/region codes except CN (Chinese mainland).
// Sourced from Huawei AppGallery "all countries/regions" (200 countries) minus CN.
const ALL_COUNTRIES_EXCEPT_CN = [
  "AD","AE","AF","AG","AI","AL","AM","AO","AR","AS","AT","AU","AW","AZ",
  "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BM","BN","BO","BR","BS",
  "BT","BW","BY","BZ","CA","CD","CF","CG","CH","CI","CK","CL","CM","CO",
  "CR","CV","CW","CY","CZ","DE","DJ","DK","DM","DO","DZ","EC","EE","EG",
  "ER","ES","ET","FI","FJ","FM","FO","FR","GA","GB","GD","GE","GH","GL",
  "GM","GN","GQ","GR","GT","GW","GY","HK","HN","HR","HT","HU","ID","IE",
  "IL","IN","IQ","IR","IS","IT","JM","JO","JP","KE","KG","KH","KI","KM",
  "KN","KR","KW","KZ","LA","LB","LC","LI","LK","LR","LS","LT","LU","LV",
  "LY","MA","MC","MD","ME","MG","MH","MK","ML","MM","MN","MO","MR","MT",
  "MU","MV","MW","MX","MY","MZ","NA","NE","NG","NI","NL","NO","NP","NR",
  "NZ","OM","PA","PE","PG","PH","PK","PL","PS","PT","PW","PY","QA","RO",
  "RS","RU","RW","SA","SB","SC","SD","SE","SG","SI","SK","SL","SM","SN",
  "SO","SR","ST","SV","SZ","TD","TG","TH","TJ","TL","TM","TN","TO","TR",
  "TT","TV","TW","TZ","UA","UG","US","UY","UZ","VA","VC","VE","VN","VU",
  "WS","YE","ZA","ZM","ZW",
].join(",");

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

  function applyGamePreset() {
    setT((prev) => ({
      ...prev,
      parentType: 2,
      childType: 20,
      grandChildType: 10115,
      isGameCasual: true,
    }));
  }

  function applyAllCountriesExceptCN() {
    setT((prev) => ({ ...prev, publishCountry: ALL_COUNTRIES_EXCEPT_CN }));
  }

  function applyFullAutoPreset() {
    setT((prev) => ({
      ...prev,
      parentType: 2,
      childType: 20,
      grandChildType: 10115,
      isGameCasual: true,
      deviceTypes: "4,6",
      isFree: true,
      collectPersonalData: false,
      genAiNotInvolved: true,
      releaseImmediately: true,
      autoSubmitForReview: true,
      autoContentRating: true,
      publishCountry: ALL_COUNTRIES_EXCEPT_CN,
      privacyPolicy: prev.privacyPolicy || "https://sites.google.com/view/makeuphanane",
    }));
  }

  if (!loaded) return <p className="text-sm text-neutral-500">Loading template...</p>;

  return (
    <div className="space-y-5">
      {/* Quick preset */}
      <div className="rounded-md border border-blue-200 bg-blue-50 p-3">
        <label className="label text-blue-900">Quick presets</label>
        <p className="mb-2 text-xs text-blue-700">
          Apply recommended settings in one click. You can still customize individual fields below.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn-primary whitespace-nowrap text-sm"
            onClick={applyFullAutoPreset}
            disabled={busy}
          >
            Full auto (Games / RPG / Incremental / Casual + all countries)
          </button>
          <button
            className="rounded border border-blue-300 bg-white px-3 py-1.5 text-sm hover:bg-blue-50"
            onClick={applyGamePreset}
            disabled={busy}
          >
            Games / Role-playing / Incremental
          </button>
          <button
            className="rounded border border-blue-300 bg-white px-3 py-1.5 text-sm hover:bg-blue-50"
            onClick={applyAllCountriesExceptCN}
            disabled={busy}
          >
            All countries except China
          </button>
        </div>
      </div>

      {/* Capture from existing app */}
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <label className="label">Capture from a configured app (recommended)</label>
        <p className="mb-2 text-xs text-neutral-500">
          Enter the AGC App ID of an app you&apos;ve already set up correctly (category, countries,
          privacy policy). We read its exact settings via the API and reuse them for every upload.
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
            {busy ? "Working..." : "Capture"}
          </button>
        </div>
      </div>

      {/* Device types */}
      <div>
        <label className="label">Compatible devices</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={(t.deviceTypes ?? "").includes("4")}
              onChange={(e) => {
                const ids = new Set((t.deviceTypes ?? "").split(",").filter(Boolean));
                if (e.target.checked) ids.add("4"); else ids.delete("4");
                set("deviceTypes", [...ids].join(",") || undefined);
              }}
            />
            Mobile Phone
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={(t.deviceTypes ?? "").includes("6")}
              onChange={(e) => {
                const ids = new Set((t.deviceTypes ?? "").split(",").filter(Boolean));
                if (e.target.checked) ids.add("6"); else ids.delete("6");
                set("deviceTypes", [...ids].join(",") || undefined);
              }}
            />
            Tablet
          </label>
        </div>
      </div>

      {/* Category */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Category - parentType</label>
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

      {/* Casual game checkbox */}
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={t.isGameCasual ?? false}
          onChange={(e) => set("isGameCasual", e.target.checked)}
        />
        Casual game (sub-category)
      </label>

      {/* Privacy policy */}
      <div>
        <label className="label">Privacy policy URL</label>
        <input
          className="input"
          value={t.privacyPolicy ?? ""}
          onChange={(e) => set("privacyPolicy", e.target.value || undefined)}
          placeholder="https://example.com/privacy"
        />
      </div>

      {/* Distribution countries */}
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

      {/* Payment type */}
      <div>
        <label className="label">Payment type</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="isFree"
              checked={t.isFree === true}
              onChange={() => set("isFree", true)}
            />
            Free
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="isFree"
              checked={t.isFree === false}
              onChange={() => set("isFree", false)}
            />
            Paid
          </label>
        </div>
      </div>

      {/* Content rating */}
      <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
        <label className="label">Content rating (age rating questionnaire)</label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={t.autoContentRating ?? false}
            onChange={(e) => set("autoContentRating", e.target.checked)}
          />
          Automatically answer all questions with &quot;No&quot; and verify
        </label>
        <p className="mt-1 text-xs text-neutral-500">
          Fetches the IARC questionnaire via the API, selects &quot;No&quot; for every question, and submits for verification.
        </p>
      </div>

      {/* Privacy tags */}
      <div>
        <label className="label">Collect personal data</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="collectPersonalData"
              checked={t.collectPersonalData === false}
              onChange={() => set("collectPersonalData", false)}
            />
            No
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="collectPersonalData"
              checked={t.collectPersonalData === true}
              onChange={() => set("collectPersonalData", true)}
            />
            Yes
          </label>
        </div>
      </div>

      {/* AI declaration */}
      <div>
        <label className="label">Generative AI service</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="genAiNotInvolved"
              checked={t.genAiNotInvolved === true}
              onChange={() => set("genAiNotInvolved", true)}
            />
            Not involved
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="genAiNotInvolved"
              checked={t.genAiNotInvolved === false}
              onChange={() => set("genAiNotInvolved", false)}
            />
            Involved
          </label>
        </div>
      </div>

      {/* Release timing */}
      <div>
        <label className="label">Release time</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="releaseImmediately"
              checked={t.releaseImmediately === true}
              onChange={() => set("releaseImmediately", true)}
            />
            Immediately once approved
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="releaseImmediately"
              checked={t.releaseImmediately === false}
              onChange={() => set("releaseImmediately", false)}
            />
            Specified time
          </label>
        </div>
      </div>

      {/* Auto-submit */}
      <div className="rounded-md border border-green-200 bg-green-50 p-3">
        <label className="flex items-center gap-1.5 text-sm font-medium text-green-900">
          <input
            type="checkbox"
            checked={t.autoSubmitForReview ?? false}
            onChange={(e) => set("autoSubmitForReview", e.target.checked)}
          />
          Auto-submit for review after upload
        </label>
        <p className="mt-1 text-xs text-green-700">
          When enabled, the app is automatically submitted for Huawei review after all fields are applied.
          No manual console interaction needed.
        </p>
      </div>

      {/* Default language */}
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
                deviceTypes: t.deviceTypes,
                isFree: t.isFree,
                collectPersonalData: t.collectPersonalData,
                genAiNotInvolved: t.genAiNotInvolved,
                releaseImmediately: t.releaseImmediately,
                autoSubmitForReview: t.autoSubmitForReview,
                autoContentRating: t.autoContentRating,
                isGameCasual: t.isGameCasual,
              },
              "Saved. These values are applied automatically after every upload.",
            )
          }
          disabled={busy}
        >
          {busy ? "Saving..." : "Save template"}
        </button>
        {status && <span className="text-sm text-green-600">{status}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
