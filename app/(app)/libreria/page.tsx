import { connection } from "next/server";
import { LibraryScreen } from "@/components/library/library-screen";
import { listLibraryCards } from "@/lib/library/service";
import { getSettings } from "@/lib/settings/service";

export default async function LibraryPage() {
  await connection();
  const [recipes, settings] = await Promise.all([listLibraryCards(), getSettings()]);
  return <LibraryScreen initialRecipes={recipes} persons={settings.persons} />;
}
