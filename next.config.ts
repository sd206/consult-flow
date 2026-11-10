import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    // Logos (2 MB) with headroom so an oversize logo reaches the validator. Payment files never pass
    // through server actions: the browser uploads them straight to storage with signed upload URLs.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
