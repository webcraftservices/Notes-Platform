import { NextResponse } from "next/server";

/**
 * Liveness probe (Phase 9.4): "is this process running and able to answer
 * an HTTP request?" — and nothing else. Deliberately touches no database,
 * Redis, storage or AI provider, so an outage of any of them can never make
 * an orchestrator restart an otherwise healthy process. Use /api/health for
 * readiness (dependency-aware).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: "alive" });
}
