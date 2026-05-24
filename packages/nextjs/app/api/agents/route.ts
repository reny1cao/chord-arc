import { NextResponse } from "next/server";
import agentsRegistry from "../../../../daemon/agents.json";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(agentsRegistry, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
