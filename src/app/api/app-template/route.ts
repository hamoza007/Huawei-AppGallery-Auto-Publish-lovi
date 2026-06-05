import { NextResponse } from "next/server";
import { resolveAppTemplate, saveAppTemplate, captureTemplateFromApp } from "@/lib/app-template";
import type { AppInfoTemplate } from "@/lib/huawei-app-info";

export const runtime = "nodejs";

export async function GET() {
  const template = await resolveAppTemplate();
  return NextResponse.json({ template });
}

interface SaveBody {
  // When set, capture the template from an existing, configured app instead of
  // saving the posted fields.
  captureAppId?: string;
  defaultLang?: string;
  parentType?: number | string;
  childType?: number | string;
  grandChildType?: number | string;
  privacyPolicy?: string;
  publishCountry?: string;
}

function num(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as SaveBody;

  if (body.captureAppId && body.captureAppId.trim()) {
    try {
      await captureTemplateFromApp(body.captureAppId.trim());
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
    const saved = await resolveAppTemplate();
    return NextResponse.json({ template: saved });
  }

  const template: AppInfoTemplate = {
    defaultLang: body.defaultLang?.trim() || undefined,
    parentType: num(body.parentType),
    childType: num(body.childType),
    grandChildType: num(body.grandChildType),
    privacyPolicy: body.privacyPolicy?.trim() || undefined,
    publishCountry: body.publishCountry || undefined,
  };
  await saveAppTemplate(template);
  const saved = await resolveAppTemplate();
  return NextResponse.json({ template: saved });
}
