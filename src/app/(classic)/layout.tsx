import { NavBar } from "@/components/NavBar";

/**
 * The course platform keeps its paper surface, but shares DevPath's navigation,
 * logo and type so the two products read as one site.
 */
export default function ClassicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-stone-50 text-stone-900">
      <NavBar tone="light" />
      <main>{children}</main>
    </div>
  );
}
