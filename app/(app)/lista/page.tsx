import { connection } from "next/server";
import { ShoppingScreen } from "@/components/shopping/shopping-screen";
import { getShoppingScreen } from "@/lib/shopping/service";

interface ShoppingListPageProps {
  searchParams: Promise<{ piano?: string | string[] }>;
}

export default async function ShoppingListPage({ searchParams }: ShoppingListPageProps) {
  await connection();
  const { piano } = await searchParams;
  const planId = Array.isArray(piano) ? piano[0] : piano;
  const screen = await getShoppingScreen({ planId });
  // La key azzera lo stato locale (e la coda delle spunte) quando cambia il piano mostrato.
  return <ShoppingScreen key={screen.selected?.plan.id ?? "none"} initialScreen={screen} />;
}
