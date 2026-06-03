// Applies a fixed "app info" template (category, content/age rating, privacy
// policy, distribution countries, support contacts) to an AppGallery app.
//
// The Fastlane plugin used for upload/submit does NOT expose these fields, so we
// call the documented AppGallery Connect Publishing API directly:
//   POST /api/oauth2/v1/token        -> access token
//   PUT  /api/publish/v2/app-info    -> update app basic information
// This is the same Connect API client_id/secret used everywhere else; no console
// login is required.
import { huaweiCredsFromEnv, type FastlaneCredentials } from "./fastlane";

const CONNECT_BASE = "https://connect-api.cloud.huawei.com/api";

export interface AppInfoTemplate {
  defaultLang?: string;
  categoryId?: string;
  subCategoryId?: string;
  // 1=Everyone, 2=Pre-teen, 3=Teen, 4=Mature (Huawei contentRating codes).
  contentRating?: number;
  // Minimum age, e.g. 3, 7, 12, 16, 18.
  ageRating?: number;
  privacyPolicy?: string;
  // Comma-separated ISO country/region codes, e.g. "US,GB,DE,FR".
  publishCountry?: string;
  csEmail?: string;
  csPhone?: string;
  csUrl?: string;
}

type RetEnvelope = { ret?: { code?: number; msg?: string } };

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

// Map our template to the API's camelCase body, omitting unset fields.
function buildPayload(t: AppInfoTemplate): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (t.defaultLang) p.defaultLang = t.defaultLang;
  if (t.categoryId) p.categoryId = t.categoryId;
  if (t.subCategoryId) p.subCategoryId = t.subCategoryId;
  if (typeof t.contentRating === "number") p.contentRating = t.contentRating;
  if (typeof t.ageRating === "number") p.ageRating = t.ageRating;
  if (t.privacyPolicy) p.privacyPolicy = t.privacyPolicy;
  if (t.publishCountry) p.publishCountry = t.publishCountry;
  if (t.csEmail) p.csEmail = t.csEmail;
  if (t.csPhone) p.csPhone = t.csPhone;
  if (t.csUrl) p.csUrl = t.csUrl;
  return p;
}

export function templateIsEmpty(t: AppInfoTemplate): boolean {
  return Object.keys(buildPayload(t)).length === 0;
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
