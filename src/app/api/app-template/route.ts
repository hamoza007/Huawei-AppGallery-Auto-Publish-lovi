import { NextResponse } from "next/server";
import { resolveAppTemplate, saveAppTemplate } from "@/lib/app-template";
import type { AppInfoTemplate } from "@/lib/huawei-app-info";

export const runtime = "nodejs";

export async function GET() {
  const template = await resolveAppTemplate();
  return NextResponse.json({ template });
}

interface SaveBody {
  defaultLang?: string;
  categoryId?: string;
  subCategoryId?: string;
  contentRating?: number | string;
  ageRating?: number | string;
  privacyPolicy?: string;
  publishCountry?: string;
  csEmail?: string;
  csPhone?: string;
  csUrl?: string;
}

function num(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SaveBody;
  const template: AppInfoTemplate = {
    defaultLang: body.defaultLang?.trim() || undefined,
    categoryId: body.categoryId?.toString().trim() || undefined,
    subCategoryId: body.subCategoryId?.toString().trim() || undefined,
    contentRating: num(body.contentRating),
    ageRating: num(body.ageRating),
    privacyPolicy: body.privacyPolicy?.trim() || undefined,
    publishCountry: body.publishCountry?.replace(/\s+/g, "").toUpperCase() || undefined,
    csEmail: body.csEmail?.trim() || undefined,
    csPhone: body.csPhone?.trim() || undefined,
    csUrl: body.csUrl?.trim() || undefined,
  };
  await saveAppTemplate(template);
  const saved = await resolveAppTemplate();
  return NextResponse.json({ template: saved });
}
