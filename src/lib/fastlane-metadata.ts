// Materialize the fastlane/metadata/huawei/<locale>/ folder structure that the
// huawei_appgallery_connect plugin's update_app_localization action reads.
//
// Each locale folder contains plain-text files:
//   app_name          → Huawei "appName"
//   app_description    → Huawei "appDesc"
//   introduction       → Huawei "briefInfo" (brief introduction)
//   release_notes      → Huawei "newFeatures" (what's new)
import { promises as fs } from "fs";
import path from "path";
import { toHuaweiLocale } from "./locales";

export interface LocalizationLike {
  locale: string;
  title: string;
  description: string;
  shortDescription: string;
  whatsNew?: string | null;
}

// Huawei caps: appName 64, briefInfo 80, appDesc 8000, newFeatures 500.
function clamp(value: string, max: number): string {
  const v = (value ?? "").trim();
  return v.length > max ? v.slice(0, max) : v;
}

export async function writeFastlaneMetadata(
  baseDir: string,
  localizations: LocalizationLike[],
): Promise<string> {
  const metadataPath = path.join(baseDir, "fastlane", "metadata", "huawei");
  await fs.rm(metadataPath, { recursive: true, force: true });

  for (const loc of localizations) {
    const folder = path.join(metadataPath, toHuaweiLocale(loc.locale));
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(path.join(folder, "app_name"), clamp(loc.title, 64), "utf8");
    await fs.writeFile(path.join(folder, "introduction"), clamp(loc.shortDescription, 80), "utf8");
    await fs.writeFile(path.join(folder, "app_description"), clamp(loc.description, 8000), "utf8");
    if (loc.whatsNew && loc.whatsNew.trim()) {
      await fs.writeFile(path.join(folder, "release_notes"), clamp(loc.whatsNew, 500), "utf8");
    }
  }

  return metadataPath;
}

// Write a changelog file (release notes for the default locale) for the
// huawei_appgallery_connect upload action's `changelog_path`.
export async function writeChangelog(baseDir: string, whatsNew: string | null | undefined): Promise<string | null> {
  const text = (whatsNew ?? "").trim();
  if (!text) return null;
  const changelogPath = path.join(baseDir, "changelog.txt");
  await fs.writeFile(changelogPath, clamp(text, 500), "utf8");
  return changelogPath;
}
