import { NextResponse } from "next/server";
import { isValidHash, loadContract } from "~~/utils/contractStorage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ hash: string }>;
};

export async function GET(_req: Request, context: RouteContext) {
  const { hash } = await context.params;

  if (!isValidHash(hash)) {
    return NextResponse.json(
      { error: "hash must be 64 lowercase hex chars" },
      { status: 400 },
    );
  }

  const contract = await loadContract(hash);
  if (!contract) {
    return NextResponse.json({ error: "contract not found" }, { status: 404 });
  }

  return NextResponse.json(contract, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
