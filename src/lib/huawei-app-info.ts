// Applies a fixed "app info" template (category, privacy policy, distribution
// countries) to an AppGallery app via the documented Connect Publishing API.
//
// The Fastlane plugin used for upload/submit does NOT expose these fields, so we
// call the API directly:
//   POST /api/oauth2/v1/token        -> access token
//   GET  /api/publish/v2/app-info    -> read current app basic information
//   PUT  /api/publish/v2/app-info    -> update app basic information
// This is the same Connect API client_id/secret used everywhere else; no console
// login is required. Verified against a live app (appId 117918145).
//
// Schema notes (from the live API, not the older docs):
//  - Category is a 3-level numeric path: parentType / childType / grandChildType
//    (e.g. 2 / 20 / 10115 = Games / Role-playing / Incremental games).
//  - publishCountry is a comma-separated list of ISO codes. The GET response may
//    include a synthetic "ALL" token which the PUT rejects, so we always strip it.
//  - contentRate / age rating come from the console IARC questionnaire and are
//    NOT writable here, so they are intentionally omitted.
import { huaweiCredsFromEnv, type FastlaneCredentials } from "./fastlane";

const CONNECT_BASE = "https://connect-api.cloud.huawei.com/api";

export interface AppInfoTemplate {
  defaultLang?: string;
  // Category path. Huawei needs all three levels together.
  parentType?: number;
  childType?: number;
  grandChildType?: number;
  // Comma-separated ISO country/region codes (no "ALL" token).
  publishCountry?: string;
  privacyPolicy?: string;
}

type RetEnvelope = { ret?: { code?: number; msg?: string } };

// Keep only valid 2-letter ISO codes; drop Huawei's synthetic "ALL" token,
// blanks and duplicates while preserving order.
export function sanitizeCountries(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,\s]+/)) {
    const c = part.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(c) && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out.length ? out.join(",") : undefined;
}

export async function getConnectToken(creds?: FastlaneCredentials): Promise<string> {
  const { clientId, clientSecret } = creds ?? huaweiCredsFromEnv();
  const res = await fetch(`${CONNECT_BASE}/oauth2/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Huawei OAuth failed (HTTP ${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Huawei OAuth returned no access_token");
  return data.access_token;
}

// Map our template to the API's body, omitting unset fields.
function buildPayload(t: AppInfoTemplate): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (t.defaultLang) p.defaultLang = t.defaultLang;
  if (typeof t.parentType === "number") p.parentType = t.parentType;
  if (typeof t.childType === "number") p.childType = t.childType;
  if (typeof t.grandChildType === "number") p.grandChildType = t.grandChildType;
  const pc = sanitizeCountries(t.publishCountry);
  if (pc) p.publishCountry = pc;
  if (t.privacyPolicy) p.privacyPolicy = t.privacyPolicy;
  return p;
}

export function templateIsEmpty(t: AppInfoTemplate): boolean {
  return Object.keys(buildPayload(t)).length === 0;
}

export interface RawAppInfo {
  defaultLang?: string;
  parentType?: number;
  childType?: number;
  grandChildType?: number;
  publishCountry?: string;
  privacyPolicy?: string;
  [k: string]: unknown;
}

// Read the current app basic information.
export async function fetchAppInfo(
  appId: string,
  opts: { creds?: FastlaneCredentials; releaseType?: 1 | 3 } = {},
): Promise<RawAppInfo> {
  const creds = opts.creds ?? huaweiCredsFromEnv();
  const token = await getConnectToken(creds);
  const releaseType = opts.releaseType ?? 1;
  const url = `${CONNECT_BASE}/publish/v2/app-info?appId=${encodeURIComponent(appId)}&releaseType=${releaseType}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, client_id: creds.clientId },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`app-info query failed (HTTP ${res.status}): ${text}`);
  const body = JSON.parse(text) as RetEnvelope & { appInfo?: RawAppInfo };
  if ((body.ret?.code ?? 0) !== 0) {
    throw new Error(`app-info query failed (code ${body.ret?.code}): ${body.ret?.msg ?? text}`);
  }
  return body.appInfo ?? {};
}

// Build a reusable template by capturing the fixed fields from an existing,
// already-configured app. This is the most robust way to get the exact category
// IDs and country list without guessing.
export function templateFromAppInfo(info: RawAppInfo): AppInfoTemplate {
  return {
    defaultLang: info.defaultLang,
    parentType: typeof info.parentType === "number" ? info.parentType : undefined,
    childType: typeof info.childType === "number" ? info.childType : undefined,
    grandChildType: typeof info.grandChildType === "number" ? info.grandChildType : undefined,
    publishCountry: sanitizeCountries(info.publishCountry),
    privacyPolicy: info.privacyPolicy || undefined,
  };
}

export interface ApplyOptions {
  creds?: FastlaneCredentials;
  releaseType?: 1 | 3;
  onLog?: (line: string) => void | Promise<void>;
}

// PUT the template onto the app. Throws on auth/permission/validation errors.
export async function applyAppInfoTemplate(
  appId: string,
  template: AppInfoTemplate,
  opts: ApplyOptions = {},
): Promise<void> {
  const payload = buildPayload(template);
  if (Object.keys(payload).length === 0) {
    await opts.onLog?.("No app-info template fields configured; skipping");
    return;
  }
  const creds = opts.creds ?? huaweiCredsFromEnv();
  const token = await getConnectToken(creds);
  const releaseType = opts.releaseType ?? 1;
  await opts.onLog?.(`Applying app-info template: ${Object.keys(payload).join(", ")}`);

  const url = `${CONNECT_BASE}/publish/v2/app-info?appId=${encodeURIComponent(appId)}&releaseType=${releaseType}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      client_id: creds.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`app-info update failed (HTTP ${res.status}): ${text}`);
  }
  let body: RetEnvelope = {};
  try {
    body = JSON.parse(text) as RetEnvelope;
  } catch {
    // Some success responses are empty; treat non-JSON 2xx as success.
  }
  const code = body.ret?.code ?? 0;
  if (code !== 0) {
    throw new Error(`app-info update failed (code ${code}): ${body.ret?.msg ?? text}`);
  }
  await opts.onLog?.("App-info template applied successfully");
}
