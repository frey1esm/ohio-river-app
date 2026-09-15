import RiverDashboard from "@/components/RiverDashboard";
import { getRiverData } from "@/lib/river-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const data = await getRiverData();
  return <RiverDashboard initialData={data} />;
}
