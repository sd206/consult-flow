import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    // Bank statements (4 MB; Vercel caps requests at 4.5 MB) and logos (2 MB), with headroom so an oversize file reaches its validator. Payment files never pass
    // through server actions: the browser uploads them straight to storage with signed upload URLs.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
