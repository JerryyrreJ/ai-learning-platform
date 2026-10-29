import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the isolated auth fixture build separate from ordinary builds.
  distDir: process.env.DEVPATH_AUTH_E2E === "1" ? ".next-auth-e2e" : ".next",
};

export default nextConfig;
