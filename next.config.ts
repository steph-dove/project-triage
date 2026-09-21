import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Docker image ships .next/standalone, which carries only the node_modules the server uses.
  output: "standalone",
};

export default nextConfig;
