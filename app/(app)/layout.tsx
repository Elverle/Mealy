import { connection } from "next/server";
import { redirect } from "next/navigation";
import { BottomNav } from "@/components/navigation/bottom-nav";
import { getSettings } from "@/lib/settings/service";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  const settings = await getSettings();
  if (!settings.onboarded) redirect("/benvenuto");

  return (
    <>
      <div className="flex-1 pb-24">{children}</div>
      <BottomNav />
    </>
  );
}
