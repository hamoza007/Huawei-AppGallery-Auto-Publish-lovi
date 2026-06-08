// Parse an APK to extract metadata (package name, version, permissions, icon,
// app label). Uses `app-info-parser` which is a pure-JS parser.
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";
import sharp from "sharp";

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

// Extract the largest launcher icon PNG directly from the APK zip. This is a
// fallback for when app-info-parser fails to surface the icon as base64 (some
// APKs store the icon in a way the parser can't decode). We scan the zip for
// mipmap/drawable PNGs whose name looks like a launcher icon and pick the one
// with the highest pixel area.
async function extractIconFromZip(apkPath: string, outDir: string): Promise<string | null> {
  try {
    const AdmZip = (await import("adm-zip")).default;
    const zip = new AdmZip(apkPath);
    const entries = zip.getEntries();

    // The launcher icon is conventionally a mipmap/drawable PNG named
    // ic_launcher.png / icon.png / app_icon.png. We avoid round variants,
    // adaptive-icon layers (foreground/background) and unrelated assets like
    // notification or third-party SDK icons.
    const isLauncherName = (basename: string): boolean => {
      return (
        basename === "ic_launcher.png" ||
        basename === "icon.png" ||
        basename === "app_icon.png" ||
        basename === "ic_launcher_foreground.png"
      );
    };

    const candidates = entries.filter((e) => {
      const n = e.entryName.toLowerCase();
      const base = n.split("/").pop() ?? n;
      return (
        !e.isDirectory &&
        n.endsWith(".png") &&
        (n.includes("mipmap") || n.includes("drawable")) &&
        isLauncherName(base) &&
        !n.includes("round")
      );
    });

    // Decode each candidate and keep the one with the largest pixel area — this
    // reliably picks the real high-density launcher icon over tiny noise PNGs.
    let best: { raw: Buffer; w: number; h: number } | null = null;
    for (const entry of candidates) {
      const raw = entry.getData();
      try {
        const meta = await sharp(raw).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w === 0 || h === 0) continue;
        if (!best || w * h > best.w * best.h) best = { raw, w, h };
      } catch {
        continue;
      }
    }

    if (!best) return null;

    const pngPath = path.join(outDir, "icon.png");
    if (best.w < REQUIRED_ICON_SIZE || best.h < REQUIRED_ICON_SIZE) {
      await sharp(best.raw)
        .resize(REQUIRED_ICON_SIZE, REQUIRED_ICON_SIZE, {
          fit: "contain",
          background: { r: 255, g: 255, b: 255, alpha: 0 },
        })
        .png()
        .toFile(pngPath);
    } else {
      await sharp(best.raw)
        .resize(REQUIRED_ICON_SIZE, REQUIRED_ICON_SIZE, { fit: "cover" })
        .png()
        .toFile(pngPath);
    }
    return pngPath;
  } catch {
    return null;
  }
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
    const pngPath = path.join(outDir, "icon.png");
    try {
      const raw = Buffer.from(stripped, "base64");
      // Resize the icon up to 512x512 if it is smaller, so it always meets the
      // Huawei AppGallery requirement. Larger icons are passed through as-is.
      try {
        const meta = await sharp(raw).metadata();
        const w = meta.width ?? 0;
        const h = meta.height ?? 0;
        if (w < REQUIRED_ICON_SIZE || h < REQUIRED_ICON_SIZE) {
          await sharp(raw)
            .resize(REQUIRED_ICON_SIZE, REQUIRED_ICON_SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
            .png()
            .toFile(pngPath);
        } else {
          await sharp(raw).png().toFile(pngPath);
        }
      } catch {
        // sharp couldn't decode it — fall back to writing the raw bytes.
        await fs.writeFile(pngPath, raw);
      }
      iconPngPath = pngPath;
    } catch {
      iconPngPath = null;
    }
  }

  // Fallback: if the parser couldn't give us a usable icon, pull it straight
  // out of the APK zip's mipmap/drawable resources.
  if (!iconPngPath) {
    iconPngPath = await extractIconFromZip(apkPath, outDir);
  }

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
