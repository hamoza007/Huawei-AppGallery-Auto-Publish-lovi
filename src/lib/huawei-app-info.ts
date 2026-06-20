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
import { promises as fs } from "fs";
import path from "path";
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
  // Device compatibility: 1 = Mobile Phone, 2 = Tablet (comma-separated IDs).
  deviceTypes?: string;
  // Payment: true = free app.
  isFree?: boolean;
  // Privacy declarations.
  collectPersonalData?: boolean;
  // AI function declaration: true = "Not involved".
  genAiNotInvolved?: boolean;
  // Release timing: true = "Immediately once approved".
  releaseImmediately?: boolean;
  // Auto-submit for review after upload.
  autoSubmitForReview?: boolean;
  // Auto-answer content-rating questionnaire with all "No".
  autoContentRating?: boolean;
  // Casual game sub-tag (relevant when category is Games).
  isGameCasual?: boolean;
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
  if (t.deviceTypes) {
    const ids = t.deviceTypes.split(",").map((s) => Number(s.trim())).filter(Number.isFinite);
    if (ids.length > 0) p.deviceTypes = ids;
  }
  if (typeof t.isFree === "boolean") p.isFree = t.isFree ? 1 : 0;
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
  deviceTypes?: number[];
  isFree?: number;
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
    deviceTypes: Array.isArray(info.deviceTypes) ? info.deviceTypes.join(",") : undefined,
    isFree: typeof info.isFree === "number" ? info.isFree === 1 : undefined,
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

// ---------------------- App Icon Upload ----------------------

// Upload the app icon to Huawei AppGallery Connect via the Publishing API.
// This is required before submit-for-review — the API returns error 204144660
// ("AppIcon is necessary!") if no icon has been uploaded.
//
// Flow:
//   1) GET /api/publish/v2/upload-url/for-obs?appId=X&fileName=icon.png&contentLength=Y&suffix=png
//   2) PUT the icon bytes to the returned OBS URL
//   3) PUT /api/publish/v2/app-file-info with fileType=1 (icon)
export async function uploadAppIcon(
  appId: string,
  iconPath: string,
  lang: string = "en-US",
  opts: ApplyOptions = {},
): Promise<void> {
  const creds = opts.creds ?? huaweiCredsFromEnv();
  const token = await getConnectToken(creds);

  // Read the icon file
  const iconBuffer = await fs.readFile(iconPath);
  const fileName = path.basename(iconPath);
  const fileSize = iconBuffer.byteLength;

  await opts.onLog?.(`Uploading app icon (${fileName}, ${fileSize} bytes)`);

  // 1) Get upload URL for the icon (suffix = png)
  const suffix = path.extname(iconPath).replace(".", "") || "png";
  const uploadUrlEndpoint =
    `${CONNECT_BASE}/publish/v2/upload-url/for-obs?appId=${encodeURIComponent(appId)}` +
    `&fileName=${encodeURIComponent(fileName)}&contentLength=${fileSize}&suffix=${suffix}`;

  const urlRes = await fetch(uploadUrlEndpoint, {
    headers: {
      Authorization: `Bearer ${token}`,
      client_id: creds.clientId,
    },
  });
  if (!urlRes.ok) {
    throw new Error(`Failed to get icon upload URL (HTTP ${urlRes.status}): ${await urlRes.text()}`);
  }
  const urlData = (await urlRes.json()) as {
    urlInfo?: { url?: string; objectId?: string; headers?: Record<string, string> };
    ret?: { code?: number; msg?: string };
  };
  if ((urlData.ret?.code ?? 0) !== 0) {
    throw new Error(`Failed to get icon upload URL (code ${urlData.ret?.code}): ${urlData.ret?.msg}`);
  }
  if (!urlData.urlInfo?.url || !urlData.urlInfo?.objectId) {
    throw new Error("No upload URL returned for icon");
  }

  // 2) Upload the icon to OBS
  const obsUrl = urlData.urlInfo.url;
  const obsHeaders: Record<string, string> = {};
  if (urlData.urlInfo.headers) {
    for (const [k, v] of Object.entries(urlData.urlInfo.headers)) {
      obsHeaders[k] = v;
    }
  }
  obsHeaders["Content-Type"] = "application/octet-stream";

  const obsRes = await fetch(obsUrl, {
    method: "PUT",
    headers: obsHeaders,
    body: iconBuffer,
  });
  if (!obsRes.ok) {
    throw new Error(`Failed to upload icon to OBS (HTTP ${obsRes.status}): ${await obsRes.text()}`);
  }
  await opts.onLog?.("Icon uploaded to OBS storage");

  // 3) Register the uploaded icon file with fileType=0 (app icon)
  //    Note: fileType 0 = icon, 1 = video/poster, 2 = screenshot, 5 = APK/RPK
  const fileInfoUrl = `${CONNECT_BASE}/publish/v2/app-file-info?appId=${encodeURIComponent(appId)}`;
  const fileInfoRes = await fetch(fileInfoUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      client_id: creds.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileType: 0,
      lang,
      files: [{ fileName, fileDestUrl: urlData.urlInfo.objectId }],
    }),
  });
  const fileInfoText = await fileInfoRes.text();
  if (!fileInfoRes.ok) {
    throw new Error(`Failed to register icon file (HTTP ${fileInfoRes.status}): ${fileInfoText}`);
  }
  let fileInfoBody: RetEnvelope = {};
  try {
    fileInfoBody = JSON.parse(fileInfoText) as RetEnvelope;
  } catch {
    // Non-JSON 2xx is success
  }
  const code = fileInfoBody.ret?.code ?? 0;
  if (code !== 0) {
    throw new Error(`Failed to register icon file (code ${code}): ${fileInfoBody.ret?.msg ?? fileInfoText}`);
  }
  await opts.onLog?.("App icon registered successfully");
}

/**
 * Upload screenshots to Huawei AppGallery Connect.
 * fileType 2 = screenshots. Requires at least 3 images.
 */
export async function uploadScreenshots(
  appId: string,
  screenshotPaths: string[],
  lang: string = "en-US",
  opts: ApplyOptions = {},
): Promise<void> {
  if (screenshotPaths.length < 3) {
    throw new Error(`Huawei requires at least 3 screenshots, got ${screenshotPaths.length}`);
  }
  const creds = opts.creds ?? huaweiCredsFromEnv();
  const token = await getConnectToken(creds);

  await opts.onLog?.(`Uploading ${screenshotPaths.length} screenshots for locale ${lang}`);

  const uploadedFiles: { fileName: string; fileDestUrl: string }[] = [];

  for (let i = 0; i < screenshotPaths.length; i++) {
    const ssPath = screenshotPaths[i];
    const buffer = await fs.readFile(ssPath);
    const fileName = path.basename(ssPath);
    const fileSize = buffer.byteLength;
    const suffix = path.extname(ssPath).replace(".", "") || "png";

    // Get upload URL
    const uploadUrlEndpoint =
      `${CONNECT_BASE}/publish/v2/upload-url/for-obs?appId=${encodeURIComponent(appId)}` +
      `&fileName=${encodeURIComponent(fileName)}&contentLength=${fileSize}&suffix=${suffix}`;

    const urlRes = await fetch(uploadUrlEndpoint, {
      headers: {
        Authorization: `Bearer ${token}`,
        client_id: creds.clientId,
      },
    });
    if (!urlRes.ok) {
      throw new Error(`Failed to get screenshot upload URL (HTTP ${urlRes.status})`);
    }
    const urlData = (await urlRes.json()) as {
      urlInfo?: { url?: string; objectId?: string; headers?: Record<string, string> };
      ret?: { code?: number; msg?: string };
    };
    if ((urlData.ret?.code ?? 0) !== 0 || !urlData.urlInfo?.url || !urlData.urlInfo?.objectId) {
      throw new Error(`Failed to get upload URL for screenshot ${i + 1}`);
    }

    // Upload to OBS
    const obsHeaders: Record<string, string> = {};
    if (urlData.urlInfo.headers) {
      for (const [k, v] of Object.entries(urlData.urlInfo.headers)) {
        obsHeaders[k] = v;
      }
    }
    obsHeaders["Content-Type"] = "application/octet-stream";

    const obsRes = await fetch(urlData.urlInfo.url, {
      method: "PUT",
      headers: obsHeaders,
      body: buffer,
    });
    if (!obsRes.ok) {
      throw new Error(`Failed to upload screenshot ${i + 1} to OBS (HTTP ${obsRes.status})`);
    }

    uploadedFiles.push({ fileName, fileDestUrl: urlData.urlInfo.objectId });
    await opts.onLog?.(`Screenshot ${i + 1}/${screenshotPaths.length} uploaded to OBS`);
  }

  // Register all screenshots with fileType=2
  const fileInfoUrl = `${CONNECT_BASE}/publish/v2/app-file-info?appId=${encodeURIComponent(appId)}`;
  const fileInfoRes = await fetch(fileInfoUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      client_id: creds.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fileType: 2,
      lang,
      files: uploadedFiles,
    }),
  });
  const fileInfoText = await fileInfoRes.text();
  if (!fileInfoRes.ok) {
    throw new Error(`Failed to register screenshots (HTTP ${fileInfoRes.status}): ${fileInfoText}`);
  }
  let fileInfoBody: RetEnvelope = {};
  try {
    fileInfoBody = JSON.parse(fileInfoText) as RetEnvelope;
  } catch {
    // Non-JSON 2xx is success
  }
  const code = fileInfoBody.ret?.code ?? 0;
  if (code !== 0) {
    throw new Error(`Failed to register screenshots (code ${code}): ${fileInfoBody.ret?.msg ?? fileInfoText}`);
  }
  await opts.onLog?.(`${uploadedFiles.length} screenshots registered successfully`);
}

// ---------------------- Content Rating (IARC questionnaire) ----------------------

// The Huawei Connect Publishing API exposes two age-rating endpoints:
//   GET  /api/publish/v2/age-rating/questionnaire?appId=X  -> get questions
//   POST /api/publish/v2/age-rating/submit?appId=X         -> submit answers
//
// The questionnaire has 11 categories. Each category has one or more questions.
// For "answer all No" we fetch the questions, map every answer to the "No"
// option, and submit.

interface AgeRatingQuestion {
  questionId: string;
  options: { optionId: string; optionName: string }[];
}

interface AgeRatingCategory {
  categoryId: string;
  categoryName: string;
  questions: AgeRatingQuestion[];
}

interface AgeRatingQuestionnaire {
  categories: AgeRatingCategory[];
  templateId?: string;
}

export async function fetchAgeRatingQuestionnaire(
  appId: string,
  opts: ApplyOptions = {},
): Promise<AgeRatingQuestionnaire> {
  const creds = opts.creds ?? huaweiCredsFromEnv();
  const token = await getConnectToken(creds);
  const url = `${CONNECT_BASE}/publish/v2/age-rating/questionnaire?appId=${encodeURIComponent(appId)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, client_id: creds.clientId },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`age-rating questionnaire fetch failed (HTTP ${res.status}): ${text}`);
  const body = JSON.parse(text) as RetEnvelope & AgeRatingQuestionnaire;
  if ((body.ret?.code ?? 0) !== 0) {
    throw new Error(`age-rating questionnaire failed (code ${body.ret?.code}): ${body.ret?.msg ?? text}`);
  }
  return body;
}

export async function submitAgeRatingAllNo(
  appId: string,
  opts: ApplyOptions = {},
): Promise<void> {
  await opts.onLog?.("Fetching age-rating questionnaire");
  const questionnaire = await fetchAgeRatingQuestionnaire(appId, opts);

  const answers: { questionId: string; optionId: string }[] = [];
  for (const cat of questionnaire.categories ?? []) {
    for (const q of cat.questions ?? []) {
      const noOpt = q.options.find(
        (o) => o.optionName.toLowerCase() === "no",
      );
      if (noOpt) {
        answers.push({ questionId: q.questionId, optionId: noOpt.optionId });
      } else if (q.options.length > 0) {
        answers.push({ questionId: q.questionId, optionId: q.options[q.options.length - 1].optionId });
      }
    }
  }

  await opts.onLog?.(`Submitting ${answers.length} answers (all "No")`);
  const creds = opts.creds ?? huaweiCredsFromEnv();
  const token = await getConnectToken(creds);
  const url = `${CONNECT_BASE}/publish/v2/age-rating/submit?appId=${encodeURIComponent(appId)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      client_id: creds.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateId: questionnaire.templateId,
      answers,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`age-rating submit failed (HTTP ${res.status}): ${text}`);
  }
  let body: RetEnvelope = {};
  try {
    body = JSON.parse(text) as RetEnvelope;
  } catch {
    // Non-JSON 2xx is success
  }
  const code = body.ret?.code ?? 0;
  if (code !== 0) {
    throw new Error(`age-rating submit failed (code ${code}): ${body.ret?.msg ?? text}`);
  }
  await opts.onLog?.("Content rating (all No) submitted successfully");
}
