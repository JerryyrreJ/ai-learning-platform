"use client";

import { usePathname } from "next/navigation";
import { ColorBends } from "./ColorBends";

/** Keep the newer sign-in/project presentation on its original dark surface. */
export function PublicSurface({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const dark = path === "/login" || path.startsWith("/auth/") || path === "/projects";
  if (!dark) return <>{children}</>;
  return (
    <div className="public-shell relative isolate min-h-dvh text-white">
      <div className="fixed inset-0 -z-10 bg-black">
        <ColorBends colors={["#0F172A", "#1E3A8A", "#3730A3", "#6D28D9"]} />
      </div>
      {children}
    </div>
  );
}
