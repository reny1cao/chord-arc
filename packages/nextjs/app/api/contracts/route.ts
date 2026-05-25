import { NextRequest, NextResponse } from "next/server";
import { storeContract } from "~~/utils/contractStorage";
import { type WorkContract, canonicalize, validateWorkContract } from "~~/types/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Total-size ceiling on the canonicalized JSON. Field-level limits
 * (`WORK_CONTRACT_FIELD_MAX = 2000`) already cap each string; this is a
 * defense-in-depth check against pathological input.
 */
const MAX_TOTAL_BYTES = 32 * 1024;

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { issues: [{ field: "schema", message: "request body must be valid JSON" }] },
      { status: 400 },
    );
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json(
      { issues: [{ field: "schema", message: "request body must be a JSON object" }] },
      { status: 400 },
    );
  }

  const contract = body as WorkContract;
  const issues = validateWorkContract(contract);
  if (issues.length > 0) {
    return NextResponse.json({ issues }, { status: 400 });
  }

  if (typeof contract.createdAt !== "number" || !Number.isFinite(contract.createdAt)) {
    return NextResponse.json(
      { issues: [{ field: "schema", message: "createdAt must be a finite number (unix ms)" }] },
      { status: 400 },
    );
  }

  const totalBytes = Buffer.byteLength(canonicalize(contract), "utf8");
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        issues: [
          {
            field: "schema",
            message: `contract exceeds ${MAX_TOTAL_BYTES} bytes (${totalBytes})`,
          },
        ],
      },
      { status: 413 },
    );
  }

  try {
    const response = await storeContract(contract);
    return NextResponse.json(response, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "failed to store contract";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
