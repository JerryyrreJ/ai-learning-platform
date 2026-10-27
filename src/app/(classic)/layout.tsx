import { ClassicNavBar } from "@/components/classic/NavBar";

/**
 * The course platform keeps its original light shell. DevPath's project pages
 * use the dark (learn) shell, so the two experiences do not fight over styles.
 */
export default function ClassicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <ClassicNavBar />
      <main>{children}</main>
    </div>
  );
}
