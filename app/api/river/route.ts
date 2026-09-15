import { getRiverData } from "@/lib/river-data";

/**
 * Always fetch fresh at request time (our own per-source TTL cache in
 * lib/cache.ts governs actual re-fetch frequency, not Next's route cache).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getRiverData();
  return Response.json(data);
}
