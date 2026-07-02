// Resolves the fixed AppGallery "app info" template that is applied to every
// publish (category, privacy policy, distribution countries). Stored as a JSON
// blob in the Setting table so it is editable from the Settings page, with
// environment-variable fallback.
import { getSetting, setSetting } from "./settings";
import {
  DEFAULT_APP_ADAPTERS,
  fetchAppInfo,
  templateFromAppInfo,
  sanitizeCountries,
  type AppInfoTemplate,
} from "./huawei-app-info";

export const APP_TEMPLATE_KEY = "huawei.appTemplate";
const DEFAULT_PRIVACY_POLICY_URL = "https://sites.google.com/view/makeuphanane";

function numOrUndef(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function fromEnv(): AppInfoTemplate {
  return {
    defaultLang: process.env.HUAWEI_TPL_DEFAULT_LANG || undefined,
    parentType: numOrUndef(process.env.HUAWEI_TPL_PARENT_TYPE),
    childType: numOrUndef(process.env.HUAWEI_TPL_CHILD_TYPE),
    grandChildType: numOrUndef(process.env.HUAWEI_TPL_GRANDCHILD_TYPE),
    publishCountry: process.env.HUAWEI_TPL_PUBLISH_COUNTRY || undefined,
    privacyPolicy: process.env.HUAWEI_TPL_PRIVACY_POLICY || process.env.PRIVACY_POLICY_URL || DEFAULT_PRIVACY_POLICY_URL,
    appAdapters: process.env.HUAWEI_TPL_APP_ADAPTERS || DEFAULT_APP_ADAPTERS,
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
  if (t.appAdapters) out.appAdapters = t.appAdapters;
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
