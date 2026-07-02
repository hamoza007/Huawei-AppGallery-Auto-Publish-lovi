// Parse an APK to extract metadata (package name, version, permissions, icon,
// app label). Uses `app-info-parser` which is a pure-JS parser.
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import sharp from "sharp";
import AdmZip from "adm-zip";

// Huawei AppGallery requires a 512x512 app icon. If the icon extracted from the
// APK is smaller than this, upscale it to 512x512 so it always meets the store
// requirement ("upload an APK, we handle everything else").
const REQUIRED_ICON_SIZE = 512;

// app-info-parser is CJS; load via createRequire so we can keep ESM elsewhere.
import { createRequire } from "module";
const nodeRequire = createRequire(import.meta.url);
const ApkParser: new (file: string) => { parse(): Promise<ApkParseResult> } =
  nodeRequire("app-info-parser/src/apk");

type IconValue = string | { content?: string; base64?: string };

interface ApkParseResult {
  package?: string;
  versionName?: string;
  versionCode?: number;
  usesSdk?: {
    minSdkVersion?: number;
    targetSdkVersion?: number;
  };
  usesPermissions?: Array<{ name: string }>;
  application?: {
    label?: string | Array<string | Record<string, string>>;
    icon?: IconValue | IconValue[];
  };
  icon?: string;
}

export interface ParsedApk {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number;
  targetSdkVersion: number;
  permissions: string[];
  label: string;
  iconPngPath: string | null;
  sha256: string;
}

function extractLabel(labelField: unknown): string {
  if (!labelField) return "";
  if (typeof labelField === "string") return labelField;
  if (Array.isArray(labelField)) {
    for (const entry of labelField) {
      if (typeof entry === "string" && entry) return entry;
      if (entry && typeof entry === "object") {
        const obj = entry as Record<string, string>;
        for (const v of Object.values(obj)) if (typeof v === "string" && v) return v;
      }
    }
  }
  return "";
}

function pickBase64Icon(icon: unknown): string | null {
  const candidates: IconValue[] = Array.isArray(icon) ? (icon as IconValue[]) : icon ? [icon as IconValue] : [];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === "string") {
      if (c.startsWith("data:")) return c;
    } else if (typeof c === "object") {
      const obj = c as { base64?: string; content?: string };
      if (obj.base64) return obj.base64;
      if (obj.content) return obj.content;
    }
  }
  return null;
}

async function writeHuaweiIcon(raw: Buffer, outDir: string): Promise<string | null> {
  const pngPath = path.join(outDir, "icon.png");
  try {
    const meta = await sharp(raw).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w < REQUIRED_ICON_SIZE || h < REQUIRED_ICON_SIZE) {
      await sharp(raw)
        .resize(REQUIRED_ICON_SIZE, REQUIRED_ICON_SIZE, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
        .toFile(pngPath);
    } else {
      await sharp(raw).png().toFile(pngPath);
    }
    return pngPath;
  } catch {
    try {
      await fs.writeFile(pngPath, raw);
      return pngPath;
    } catch {
      return null;
    }
  }
}

export async function extractApkIcon(apkPath: string, outDir: string): Promise<string | null> {
  await fs.mkdir(outDir, { recursive: true });
  try {
    const zip = new AdmZip(apkPath);
    const densities = ["xxxhdpi", "xxhdpi", "xhdpi", "hdpi", "mdpi", "ldpi"];
    const entries = zip
      .getEntries()
      .filter((entry) => !entry.isDirectory && /res\/mipmap[^/]*\/icon\.png$/i.test(entry.entryName))
      .map((entry) => ({
        entry,
        rank: densities.findIndex((density) => entry.entryName.toLowerCase().includes(density)),
      }))
      .sort((a, b) => (a.rank < 0 ? 99 : a.rank) - (b.rank < 0 ? 99 : b.rank));

    const chosen = entries[0]?.entry;
    if (!chosen) return null;
    return await writeHuaweiIcon(chosen.getData(), outDir);
  } catch {
    return null;
  }
}

export async function parseApk(apkPath: string, outDir: string): Promise<ParsedApk> {
  await fs.mkdir(outDir, { recursive: true });

  const parser = new ApkParser(apkPath);
  const info = await parser.parse();

  const buf = await fs.readFile(apkPath);
  const sha256 = createHash("sha256").update(buf).digest("hex");

  let iconPngPath: string | null = null;
  const iconBase64 = pickBase64Icon(info.application?.icon ?? info.icon);
  if (iconBase64) {
    const stripped = iconBase64.replace(/^data:image\/\w+;base64,/, "");
    try {
      const raw = Buffer.from(stripped, "base64");
      iconPngPath = await writeHuaweiIcon(raw, outDir);
    } catch {
      iconPngPath = null;
    }
  }
  iconPngPath ??= await extractApkIcon(apkPath, outDir);

  return {
    packageName: info.package ?? "",
    versionName: info.versionName ?? "0.0.0",
    versionCode: info.versionCode ?? 1,
    minSdkVersion: info.usesSdk?.minSdkVersion ?? 21,
    targetSdkVersion: info.usesSdk?.targetSdkVersion ?? 33,
    permissions: (info.usesPermissions ?? []).map((p) => p.name).filter(Boolean),
    label: extractLabel(info.application?.label) || info.package || "Untitled app",
    iconPngPath,
    sha256,
  };
}
