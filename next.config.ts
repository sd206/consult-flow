import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    // Logos may be up to 2 MB; allow headroom so oversize files reach the validator.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
