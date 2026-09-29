import { connection } from "next/server";
import { PlanScreen } from "@/components/plan/plan-screen";
import { getPlanScreen } from "@/lib/plans/service";

interface PlanPageProps {
  searchParams: Promise<{ settimana?: string | string[] }>;
}

export default async function PlanPage({ searchParams }: PlanPageProps) {
  await connection();
  const { settimana } = await searchParams;
  const week = Array.isArray(settimana) ? settimana[0] : settimana;
  const screen = await getPlanScreen({ week });
  // La key azzera lo stato locale del client quando cambia la settimana mostrata.
  return <PlanScreen key={screen.view.week.week_start} initialScreen={screen} />;
}
