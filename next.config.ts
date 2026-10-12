import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone solo quando lo chiede il Dockerfile (NEXT_OUTPUT=standalone): la copia dei file
  // tracciati crea symlink, che con pnpm su Windows possono fallire nella build locale.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
};

export default nextConfig;
