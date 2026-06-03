// Resolves the fixed AppGallery "app info" template that is applied to every
// publish (category, content/age rating, privacy policy, distribution
// countries, support contacts). Stored as a JSON blob in the Setting table so
// it is editable from the Settings page, with environment-variable fallback.
import { getSetting, setSetting } from "./settings";
import type { AppInfoTemplate } from "./huawei-app-info";

export const APP_TEMPLATE_KEY = "huawei.appTemplate";

function numOrUndef(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function fromEnv(): AppInfoTemplate {
  return {
    defaultLang: process.env.HUAWEI_TPL_DEFAULT_LANG || undefined,
    categoryId: process.env.HUAWEI_TPL_CATEGORY_ID || undefined,
    subCategoryId: process.env.HUAWEI_TPL_SUB_CATEGORY_ID || undefined,
    contentRating: numOrUndef(process.env.HUAWEI_TPL_CONTENT_RATING),
    ageRating: numOrUndef(process.env.HUAWEI_TPL_AGE_RATING),
    privacyPolicy: process.env.HUAWEI_TPL_PRIVACY_POLICY || process.env.PRIVACY_POLICY_URL || undefined,
    publishCountry: process.env.HUAWEI_TPL_PUBLISH_COUNTRY || undefined,
    csEmail: process.env.HUAWEI_TPL_CS_EMAIL || undefined,
    csPhone: process.env.HUAWEI_TPL_CS_PHONE || undefined,
    csUrl: process.env.HUAWEI_TPL_CS_URL || undefined,
  };
}

// Strip undefined/empty fields so callers only see configured values.
function clean(t: AppInfoTemplate): AppInfoTemplate {
  const out: AppInfoTemplate = {};
  if (t.defaultLang) out.defaultLang = t.defaultLang;
  if (t.categoryId) out.categoryId = String(t.categoryId);
  if (t.subCategoryId) out.subCategoryId = String(t.subCategoryId);
  if (typeof t.contentRating === "number") out.contentRating = t.contentRating;
  if (typeof t.ageRating === "number") out.ageRating = t.ageRating;
  if (t.privacyPolicy) out.privacyPolicy = t.privacyPolicy;
  if (t.publishCountry) out.publishCountry = t.publishCountry;
  if (t.csEmail) out.csEmail = t.csEmail;
  if (t.csPhone) out.csPhone = t.csPhone;
  if (t.csUrl) out.csUrl = t.csUrl;
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
