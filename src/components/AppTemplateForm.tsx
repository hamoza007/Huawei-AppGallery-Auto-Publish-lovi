"use client";
import { useEffect, useState } from "react";

interface AppInfoTemplate {
  defaultLang?: string;
  categoryId?: string;
  subCategoryId?: string;
  contentRating?: number;
  ageRating?: number;
  privacyPolicy?: string;
  publishCountry?: string;
  csEmail?: string;
  csPhone?: string;
  csUrl?: string;
}

interface Category {
  id: number;
  label: string;
}

const CONTENT_RATINGS = [
  { value: "", label: "—" },
  { value: "1", label: "1 · Everyone" },
  { value: "2", label: "2 · Pre-teen" },
  { value: "3", label: "3 · Teen" },
  { value: "4", label: "4 · Mature" },
];

const AGE_RATINGS = ["", "3", "7", "12", "16", "18"];

export function AppTemplateForm({ categories }: { categories: Category[] }) {
  const [t, setT] = useState<AppInfoTemplate>({});
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

  async function save() {
    setBusy(true);
    setError(null);
    setStatus(null);
    const res = await fetch("/api/app-template", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(t),
    });
    setBusy(false);
    if (res.ok) {
      const d = (await res.json()) as { template: AppInfoTemplate };
      setT(d.template ?? {});
      setStatus("Saved. These values are applied automatically after every upload.");
    } else {
      setError(await res.text());
    }
  }

  if (!loaded) return <p className="text-sm text-neutral-500">Loading template…</p>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Category</label>
          <select
            className="select"
            value={t.categoryId ?? ""}
            onChange={(e) => set("categoryId", e.target.value || undefined)}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Sub-category ID (optional)</label>
          <input
            className="input"
            value={t.subCategoryId ?? ""}
            onChange={(e) => set("subCategoryId", e.target.value || undefined)}
            placeholder="e.g. 142"
          />
        </div>
        <div>
          <label className="label">Content rating</label>
          <select
            className="select"
            value={t.contentRating != null ? String(t.contentRating) : ""}
            onChange={(e) => set("contentRating", e.target.value ? Number(e.target.value) : undefined)}
          >
            {CONTENT_RATINGS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Age rating</label>
          <select
            className="select"
            value={t.ageRating != null ? String(t.ageRating) : ""}
            onChange={(e) => set("ageRating", e.target.value ? Number(e.target.value) : undefined)}
          >
            {AGE_RATINGS.map((a) => (
              <option key={a} value={a}>
                {a === "" ? "—" : `${a}+`}
              </option>
            ))}
          </select>
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
        <label className="label">Distribution countries (comma-separated ISO codes)</label>
        <input
          className="input"
          value={t.publishCountry ?? ""}
          onChange={(e) => set("publishCountry", e.target.value || undefined)}
          placeholder="US,GB,DE,FR,AE,SA  (or leave blank to set once in console)"
        />
        <p className="mt-1 text-xs text-neutral-500">
          Tip: paste the full list you always use. Once set, Huawei reuses it for every release.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">Support email</label>
          <input
            className="input"
            value={t.csEmail ?? ""}
            onChange={(e) => set("csEmail", e.target.value || undefined)}
            placeholder="support@example.com"
          />
        </div>
        <div>
          <label className="label">Support phone</label>
          <input
            className="input"
            value={t.csPhone ?? ""}
            onChange={(e) => set("csPhone", e.target.value || undefined)}
          />
        </div>
        <div>
          <label className="label">Support URL</label>
          <input
            className="input"
            value={t.csUrl ?? ""}
            onChange={(e) => set("csUrl", e.target.value || undefined)}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save template"}
        </button>
        {status && <span className="text-sm text-green-600">{status}</span>}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
