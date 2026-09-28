import { connection } from "next/server";
import { SettingsEditor } from "@/components/settings/settings-editor";
import { getSettings } from "@/lib/settings/service";

export default async function SettingsPage() {
  await connection();
  const settings = await getSettings();
  return <SettingsEditor initialSettings={settings} />;
}
