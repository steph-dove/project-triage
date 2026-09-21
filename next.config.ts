import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // The e2e suite builds into its own directory so it can run beside `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
