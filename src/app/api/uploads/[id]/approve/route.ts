import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const PUBLISHABLE_STATUSES = new Set([
  "PENDING_REVIEW",
  "FAILED",
  "UPLOADED",
]);

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const upload = await prisma.upload.findUnique({ where: { id } });
  if (!upload) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!PUBLISHABLE_STATUSES.has(upload.status)) {
    return NextResponse.json(
      { error: `Upload is in ${upload.status}; can only publish from PENDING_REVIEW, FAILED, or UPLOADED` },
      { status: 409 },
    );
  }
  const isRetry = upload.status === "FAILED" || upload.status === "UPLOADED";
  await prisma.upload.update({
    where: { id },
    data: {
      approvedAt: upload.approvedAt ?? new Date(),
      status: "UPLOADING_TO_HUAWEI",
      currentStep: "publish:start",
      errorMessage: null,
    },
  });
  await prisma.job.create({
    data: { uploadId: id, kind: "PUBLISH_TO_HUAWEI", status: "QUEUED" },
  });
  await prisma.uploadEvent.create({
    data: {
      uploadId: id,
      level: "info",
      message: isRetry
        ? "Retry publish initiated; queued for Huawei submission"
        : "Approved by user; queued for Huawei submission",
    },
  });
  return NextResponse.json({ ok: true, retry: isRetry });
}
