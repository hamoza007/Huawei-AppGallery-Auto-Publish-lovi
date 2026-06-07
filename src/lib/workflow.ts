// High-level workflow orchestration: turns a freshly-uploaded APK into a fully
// localized listing ready for user approval, then submits to Huawei.
import path from "path";
import { promises as fs } from "fs";
import { prisma } from "./db";
import { parseApk } from "./apk-parser";
import { generateMetadata, translateMetadata } from "./metadata-generator";
import { TARGET_LOCALES, DEFAULT_LOCALE } from "./locales";
import { generateScreenshots } from "./screenshots";
import { resolveAppId, publishApk, updateLocalization, submitForReview } from "./fastlane";
import { writeFastlaneMetadata, writeChangelog } from "./fastlane-metadata";
import { applyAppInfoTemplate, templateIsEmpty, uploadAppIcon, uploadScreenshots } from "./huawei-app-info";
import { resolveAppTemplate } from "./app-template";
import type { Upload } from "@prisma/client";

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), "uploads");

export function uploadAssetDir(uploadId: string) {
  return path.join(UPLOAD_DIR, uploadId);
}

async function logEvent(uploadId: string, level: string, message: string, data?: unknown) {
  await prisma.uploadEvent.create({
    data: { uploadId, level, message, data: (data ?? undefined) as never },
  });
}

async function setStatus(uploadId: string, patch: Partial<Pick<Upload, "status" | "currentStep" | "progress" | "errorMessage">>) {
  await prisma.upload.update({ where: { id: uploadId }, data: patch });
}

// ---------------------- Step 1: Parse APK ----------------------

export async function stepParseApk(uploadId: string) {
  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  await setStatus(uploadId, { status: "PARSING_APK", currentStep: "parse-apk", progress: 10 });
  await logEvent(uploadId, "info", "Parsing APK");

  const assetDir = uploadAssetDir(uploadId);
  const parsed = await parseApk(upload.apkPath, assetDir);

  await prisma.upload.update({
    where: { id: uploadId },
    data: {
      packageName: parsed.packageName,
      versionName: parsed.versionName,
      versionCode: parsed.versionCode,
      minSdkVersion: parsed.minSdkVersion,
      targetSdkVersion: parsed.targetSdkVersion,
      permissions: parsed.permissions,
      iconPath: parsed.iconPngPath,
      apkLabel: parsed.label,
      apkSha256: parsed.sha256,
    },
  });
  await logEvent(uploadId, "info", `APK parsed: ${parsed.packageName} v${parsed.versionName}`);
  return parsed;
}

// ---------------------- Step 1b: Auto-link AGC app ----------------------

// APK-only flow: if the upload isn't linked to a HuaweiApp yet, resolve the
// AGC appId from the parsed package name via Huawei's appid-list API and
// link/reuse a HuaweiApp record. If the package isn't registered in the
// account yet, we log actionable guidance and leave it unlinked (publish will
// then fail with a clear message rather than silently).
export async function stepAutoLinkApp(uploadId: string) {
  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  if (upload.huaweiAppId) return; // already linked
  const pkg = upload.packageName;
  if (!pkg) {
    await logEvent(uploadId, "warn", "No package name parsed; cannot auto-link AGC app");
    return;
  }

  await logEvent(uploadId, "info", `Resolving AGC appId for package ${pkg} (fastlane get_app_id)`);
  let agcAppId: string | undefined;
  try {
    const resolved = await resolveAppId(pkg, {
      onLog: (line) => logEvent(uploadId, "info", `[fastlane] ${line}`),
    });
    agcAppId = resolved ?? undefined;
  } catch (err) {
    await logEvent(uploadId, "warn", `get_app_id lookup failed: ${(err as Error).message}`);
  }

  if (!agcAppId) {
    await logEvent(
      uploadId,
      "warn",
      `No AGC app found for ${pkg}. Create the app once in AppGallery Connect (or link it in Settings); ` +
        `re-running will auto-link it. Huawei has no public API to create a new app.`,
    );
    return;
  }

  const app = await prisma.huaweiApp.upsert({
    where: { agcAppId },
    update: { packageName: pkg, displayName: upload.apkLabel ?? pkg },
    create: {
      agcAppId,
      packageName: pkg,
      displayName: upload.apkLabel ?? pkg,
      autoLinked: true,
    },
  });
  await prisma.upload.update({ where: { id: uploadId }, data: { huaweiAppId: app.id } });
  await logEvent(uploadId, "info", `Auto-linked to AGC app ${agcAppId}`);
}

// ---------------------- Step 2: Generate metadata ----------------------

export async function stepGenerateMetadata(uploadId: string) {
  await setStatus(uploadId, { status: "GENERATING_METADATA", currentStep: "metadata", progress: 25 });
  await logEvent(uploadId, "info", "Generating English metadata via GPT-4o");

  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const apk = {
    packageName: upload.packageName ?? "",
    versionName: upload.versionName ?? "1.0.0",
    versionCode: upload.versionCode ?? 1,
    minSdkVersion: upload.minSdkVersion ?? 21,
    targetSdkVersion: upload.targetSdkVersion ?? 33,
    permissions: upload.permissions,
    label: upload.apkLabel ?? upload.packageName ?? "App",
    iconPngPath: upload.iconPath,
    sha256: upload.apkSha256 ?? "",
  };

  const en = await generateMetadata(apk, DEFAULT_LOCALE, upload.metadataPrompt);
  await prisma.localization.upsert({
    where: { uploadId_locale: { uploadId, locale: DEFAULT_LOCALE } },
    update: en,
    create: { uploadId, locale: DEFAULT_LOCALE, ...en },
  });
  await logEvent(uploadId, "info", `English metadata generated: "${en.title}"`);
  return en;
}

// ---------------------- Step 3: Translate ----------------------

export async function stepTranslate(uploadId: string) {
  await setStatus(uploadId, { status: "TRANSLATING", currentStep: "translate", progress: 45 });
  const source = await prisma.localization.findUnique({
    where: { uploadId_locale: { uploadId, locale: DEFAULT_LOCALE } },
  });
  if (!source) throw new Error("Source English localization missing");

  for (const target of TARGET_LOCALES) {
    if (target.bcp47 === DEFAULT_LOCALE) continue;
    await logEvent(uploadId, "info", `Translating → ${target.bcp47}`);
    try {
      const translated = await translateMetadata(
        {
          title: source.title,
          shortDescription: source.shortDescription,
          description: source.description,
          keywords: source.keywords ?? "",
          whatsNew: source.whatsNew ?? "",
        },
        DEFAULT_LOCALE,
        target.bcp47,
      );
      await prisma.localization.upsert({
        where: { uploadId_locale: { uploadId, locale: target.bcp47 } },
        update: translated,
        create: { uploadId, locale: target.bcp47, ...translated },
      });
    } catch (err) {
      await logEvent(uploadId, "warn", `Translation to ${target.bcp47} failed: ${(err as Error).message}`);
    }
  }
}

// ---------------------- Step 4: Screenshots ----------------------

export async function stepGenerateScreenshots(uploadId: string) {
  await setStatus(uploadId, { status: "GENERATING_SCREENSHOTS", currentStep: "screenshots", progress: 70 });
  await logEvent(uploadId, "info", "Generating screenshots");

  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } });
  const en = await prisma.localization.findUnique({
    where: { uploadId_locale: { uploadId, locale: DEFAULT_LOCALE } },
  });

  const taglines = [
    en?.shortDescription ?? upload.apkLabel ?? "Discover something new",
    "Built for everyday use",
    "Beautifully simple",
    "Powerful features",
  ];

  const assetDir = path.join(uploadAssetDir(uploadId), "screenshots");
  const apk = {
    packageName: upload.packageName ?? "",
    versionName: upload.versionName ?? "1.0.0",
    versionCode: upload.versionCode ?? 1,
    minSdkVersion: upload.minSdkVersion ?? 21,
    targetSdkVersion: upload.targetSdkVersion ?? 33,
    permissions: upload.permissions,
    label: upload.apkLabel ?? "App",
    iconPngPath: upload.iconPath,
    sha256: upload.apkSha256 ?? "",
  };

  const source = (upload.screenshotSource ?? "vmos") as
    | "vmos"
    | "ai_openai"
    | "ai_gemini"
    | "template";
  await logEvent(uploadId, "info", `Screenshot source: ${source}`);
  const shots = await generateScreenshots(apk, upload.apkPath, assetDir, taglines, {
    uploadId,
    packageName: upload.packageName ?? undefined,
    source,
    customPrompt: upload.screenshotPrompt,
    onProgress: (msg) => logEvent(uploadId, "info", msg),
  });

  await prisma.screenshot.deleteMany({ where: { uploadId } });
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    await prisma.screenshot.create({
      data: {
        uploadId,
        locale: DEFAULT_LOCALE,
        path: s.path,
        width: s.width,
        height: s.height,
        ordering: i,
        source: s.source,
      },
    });
  }
  await logEvent(uploadId, "info", `Generated ${shots.length} screenshots (${shots[0]?.source ?? "n/a"})`);
}

// ---------------------- Step 5: Mark ready for review ----------------------

export async function stepReadyForReview(uploadId: string) {
  await setStatus(uploadId, { status: "PENDING_REVIEW", currentStep: "pending-review", progress: 85 });
  await logEvent(uploadId, "info", "Ready for user review");
}

// ---------------------- Step 6: Publish to Huawei ----------------------

export async function stepPublishToHuawei(uploadId: string) {
  const upload = await prisma.upload.findUniqueOrThrow({
    where: { id: uploadId },
    include: { huaweiApp: true, localizations: true, screenshots: true },
  });
  if (!upload.huaweiApp) throw new Error("HuaweiApp not linked to upload");
  if (!upload.approvedAt) throw new Error("Upload not approved by user");

  await setStatus(uploadId, { status: "UPLOADING_TO_HUAWEI", currentStep: "huawei-upload", progress: 88 });
  const appId = upload.huaweiApp.agcAppId;
  const onLog = (line: string) => logEvent(uploadId, "info", `[fastlane] ${line}`);

  const isAab = /\.aab$/i.test(upload.filename) || /\.aab$/i.test(upload.apkPath);
  const assetDir = uploadAssetDir(uploadId);

  // 1) Push localized metadata via the plugin's update_app_localization action.
  //    We materialize the fastlane/metadata/huawei/<locale>/ folder structure
  //    it expects, then point the lane at it.
  if (upload.localizations.length > 0) {
    await logEvent(uploadId, "info", `Writing localized metadata (${upload.localizations.length} locales)`);
    const metadataPath = await writeFastlaneMetadata(assetDir, upload.localizations);
    await logEvent(uploadId, "info", "Pushing localized metadata via update_app_localization");
    await updateLocalization(appId, metadataPath, { onLog });
    await prisma.localization.updateMany({
      where: { uploadId },
      data: { uploadedToHuaweiAt: new Date() },
    });
  }

  // 2) Upload the APK/AAB via the plugin's main action. We always upload
  //    WITHOUT submitting here, so the fixed app-info template (step 3) is
  //    applied before any review submission.
  const defaultLoc =
    upload.localizations.find((l) => l.locale === DEFAULT_LOCALE) ?? upload.localizations[0];
  const changelogPath = await writeChangelog(assetDir, defaultLoc?.whatsNew);
  const template = await resolveAppTemplate();
  const privacyPolicyUrl = template.privacyPolicy || process.env.PRIVACY_POLICY_URL || undefined;

  // Set AUTO_SUBMIT_FOR_REVIEW=1 to submit for review automatically after the
  // template is applied; default is to stop at UPLOADED so the user submits.
  const autoSubmit = /^(1|true|yes)$/i.test(process.env.AUTO_SUBMIT_FOR_REVIEW ?? "");

  await logEvent(
    uploadId,
    "info",
    `Uploading ${isAab ? "AAB" : "APK"} to AppGallery (app_id ${appId}) (no auto-submit)`,
  );
  await publishApk(
    {
      appId,
      apkPath: upload.apkPath,
      isAab,
      submitForReview: false,
      privacyPolicyUrl,
      changelogPath: changelogPath ?? undefined,
    },
    { onLog },
  );

  // 3) Apply the fixed app-info template (category, content/age rating, privacy
  //    policy, distribution countries, support contacts) via the Connect API.
  //    The Fastlane plugin does not cover these fields. This keeps every
  //    release consistent and is also required for submit ("Dist country").
  if (!templateIsEmpty(template)) {
    await logEvent(uploadId, "info", "Applying fixed app-info template (category/rating/countries/policy)");
    try {
      await applyAppInfoTemplate(appId, template, {
        onLog: (line) => logEvent(uploadId, "info", `[app-info] ${line}`),
      });
    } catch (err) {
      // Don't fail the whole upload if the template can't be applied (e.g. the
      // age-rating IARC questionnaire is console-only on this account). The
      // binary + metadata are already uploaded; surface the issue and let the
      // user finish in the console.
      await logEvent(
        uploadId,
        "error",
        `Could not fully apply app-info template: ${(err as Error).message}. Finish remaining fields in the console.`,
      );
    }
  } else {
    await logEvent(
      uploadId,
      "info",
      "No app-info template configured; set category/rating/countries/policy on the Settings page to automate them.",
    );
  }

  // 4) Upload the app icon — required before submit-for-review.
  //    Huawei returns error 204144660 ("AppIcon is necessary!") without this.
  if (upload.iconPath) {
    await logEvent(uploadId, "info", "Uploading app icon to Huawei");
    try {
      await uploadAppIcon(appId, upload.iconPath, "en-US", {
        onLog: (line) => logEvent(uploadId, "info", `[icon] ${line}`),
      });
    } catch (err) {
      await logEvent(
        uploadId,
        "error",
        `Icon upload failed: ${(err as Error).message}. Submit may fail with "AppIcon is necessary".`,
      );
    }
  } else {
    await logEvent(uploadId, "warn", "No icon extracted from APK; submit may fail with AppIcon error");
  }

  // 5) Upload screenshots — Huawei requires at least 3.
  if (upload.screenshots && upload.screenshots.length >= 3) {
    await logEvent(uploadId, "info", `Uploading ${upload.screenshots.length} screenshots to Huawei`);
    try {
      const screenshotPaths = upload.screenshots
        .sort((a, b) => a.ordering - b.ordering)
        .map((s) => s.path);
      await uploadScreenshots(appId, screenshotPaths, "en-US", {
        onLog: (line) => logEvent(uploadId, "info", `[screenshots] ${line}`),
      });
      await prisma.screenshot.updateMany({
        where: { uploadId },
        data: { uploadedToHuaweiAt: new Date() },
      });
    } catch (err) {
      await logEvent(
        uploadId,
        "error",
        `Screenshot upload failed: ${(err as Error).message}. Submit may fail with "ScreenShots is necessary".`,
      );
    }
  } else {
    await logEvent(
      uploadId,
      "warn",
      `Only ${upload.screenshots?.length ?? 0} screenshots available (need at least 3). Submit may fail.`,
    );
  }

  // 6) Optionally submit for review (off by default).
  if (autoSubmit) {
    await logEvent(uploadId, "info", "Submitting app for review");
    await submitForReview(appId, { onLog });
    await setStatus(uploadId, { status: "SUBMITTED", currentStep: "submitted", progress: 100 });
    await logEvent(uploadId, "info", "Successfully uploaded + submitted to Huawei AppGallery via Fastlane");
  } else {
    await setStatus(uploadId, { status: "UPLOADED", currentStep: "uploaded", progress: 100 });
    await logEvent(
      uploadId,
      "info",
      "APK + metadata + fixed template uploaded. Review in the console and submit for review.",
    );
  }
}

// ---------------------- Orchestrator (called by worker) ----------------------

export async function runPreparationPipeline(uploadId: string) {
  try {
    await stepParseApk(uploadId);
    await stepAutoLinkApp(uploadId);
    await stepGenerateMetadata(uploadId);
    await stepTranslate(uploadId);
    await stepGenerateScreenshots(uploadId);
    await stepReadyForReview(uploadId);
  } catch (err) {
    const message = (err as Error).message;
    await setStatus(uploadId, { status: "FAILED", errorMessage: message });
    await logEvent(uploadId, "error", `Pipeline failed: ${message}`);
    throw err;
  }
}

export async function publishApprovedUpload(uploadId: string) {
  try {
    await stepPublishToHuawei(uploadId);
  } catch (err) {
    const message = (err as Error).message;
    await setStatus(uploadId, { status: "FAILED", errorMessage: message });
    await logEvent(uploadId, "error", `Publish failed: ${message}`);
    throw err;
  }
}

// Touch fs import to avoid unused warning if reorganized later
void fs;
