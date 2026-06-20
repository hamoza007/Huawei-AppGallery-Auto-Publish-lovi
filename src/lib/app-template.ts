// Resolves the fixed AppGallery "app info" template that is applied to every
// publish (category, privacy policy, distribution countries). Stored as a JSON
// blob in the Setting table so it is editable from the Settings page, with
// environment-variable fallback.
import { getSetting, setSetting } from "./settings";
import {
  fetchAppInfo,
  templateFromAppInfo,
  sanitizeCountries,
  type AppInfoTemplate,
} from "./huawei-app-info";

export const APP_TEMPLATE_KEY = "huawei.appTemplate";

function numOrUndef(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function boolOrUndef(v: string | undefined): boolean | undefined {
  if (!v) return undefined;
  return /^(1|true|yes)$/i.test(v);
}

function fromEnv(): AppInfoTemplate {
  return {
    defaultLang: process.env.HUAWEI_TPL_DEFAULT_LANG || undefined,
    parentType: numOrUndef(process.env.HUAWEI_TPL_PARENT_TYPE),
    childType: numOrUndef(process.env.HUAWEI_TPL_CHILD_TYPE),
    grandChildType: numOrUndef(process.env.HUAWEI_TPL_GRANDCHILD_TYPE),
    publishCountry: process.env.HUAWEI_TPL_PUBLISH_COUNTRY || undefined,
    privacyPolicy: process.env.HUAWEI_TPL_PRIVACY_POLICY || process.env.PRIVACY_POLICY_URL || undefined,
    deviceTypes: process.env.HUAWEI_TPL_DEVICE_TYPES || undefined,
    isFree: boolOrUndef(process.env.HUAWEI_TPL_IS_FREE),
    collectPersonalData: boolOrUndef(process.env.HUAWEI_TPL_COLLECT_PERSONAL_DATA),
    genAiNotInvolved: boolOrUndef(process.env.HUAWEI_TPL_GEN_AI_NOT_INVOLVED),
    releaseImmediately: boolOrUndef(process.env.HUAWEI_TPL_RELEASE_IMMEDIATELY),
    autoSubmitForReview: boolOrUndef(process.env.HUAWEI_TPL_AUTO_SUBMIT) ?? boolOrUndef(process.env.AUTO_SUBMIT_FOR_REVIEW),
    autoContentRating: boolOrUndef(process.env.HUAWEI_TPL_AUTO_CONTENT_RATING),
    isGameCasual: boolOrUndef(process.env.HUAWEI_TPL_IS_GAME_CASUAL),
  };
}

// Strip undefined/empty fields so callers only see configured values.
export function clean(t: AppInfoTemplate): AppInfoTemplate {
  const out: AppInfoTemplate = {};
  if (t.defaultLang) out.defaultLang = t.defaultLang;
  if (typeof t.parentType === "number") out.parentType = t.parentType;
  if (typeof t.childType === "number") out.childType = t.childType;
  if (typeof t.grandChildType === "number") out.grandChildType = t.grandChildType;
  const pc = sanitizeCountries(t.publishCountry);
  if (pc) out.publishCountry = pc;
  if (t.privacyPolicy) out.privacyPolicy = t.privacyPolicy;
  if (t.deviceTypes) out.deviceTypes = t.deviceTypes;
  if (typeof t.isFree === "boolean") out.isFree = t.isFree;
  if (typeof t.collectPersonalData === "boolean") out.collectPersonalData = t.collectPersonalData;
  if (typeof t.genAiNotInvolved === "boolean") out.genAiNotInvolved = t.genAiNotInvolved;
  if (typeof t.releaseImmediately === "boolean") out.releaseImmediately = t.releaseImmediately;
  if (typeof t.autoSubmitForReview === "boolean") out.autoSubmitForReview = t.autoSubmitForReview;
  if (typeof t.autoContentRating === "boolean") out.autoContentRating = t.autoContentRating;
  if (typeof t.isGameCasual === "boolean") out.isGameCasual = t.isGameCasual;
  return out;
}

// DB template takes precedence; any field left unset falls back to env.
export async function resolveAppTemplate(): Promise<AppInfoTemplate> {
  const env = fromEnv();
  const raw = await getSetting(APP_TEMPLATE_KEY);
  if (!raw) return clean(env);
  let db: AppInfoTemplate = {};
  try {
    db = JSON.parse(raw) as AppInfoTemplate;
  } catch {
    return clean(env);
  }
  return clean({ ...env, ...db });
}

export async function saveAppTemplate(t: AppInfoTemplate): Promise<void> {
  await setSetting(APP_TEMPLATE_KEY, JSON.stringify(clean(t)));
}

// Capture the fixed fields from an already-configured app and persist them as
// the template. Returns the captured template.
export async function captureTemplateFromApp(appId: string): Promise<AppInfoTemplate> {
  const info = await fetchAppInfo(appId);
  const template = clean(templateFromAppInfo(info));
  await saveAppTemplate(template);
  return template;
}
