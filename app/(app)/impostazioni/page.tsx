import { connection } from "next/server";
import { SettingsEditor } from "@/components/settings/settings-editor";
import { listIngredientPrefs } from "@/lib/prefs/service";
import { getSettings } from "@/lib/settings/service";

export default async function SettingsPage() {
  await connection();
  const [settings, ingredientPrefs] = await Promise.all([getSettings(), listIngredientPrefs()]);
  return <SettingsEditor initialSettings={settings} initialIngredientPrefs={ingredientPrefs} />;
}
