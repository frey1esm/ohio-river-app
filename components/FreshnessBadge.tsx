import type { Freshness } from "@/lib/types";

/**
 * Renders the "Freshness unknown" qualifier. A plain "stale" reading gets no
 * badge — its own observation timestamp is already shown alongside it, so a
 * separate "Stale" label would just restate what the timestamp already
 * says. "Unknown" is different: it means there's no valid timestamp to show
 * in the first place, so it's the only case still worth a distinct label.
 */
export default function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  if (freshness !== "unknown") return null;
  return <span className="badge badge-unknown">Freshness unknown</span>;
}
