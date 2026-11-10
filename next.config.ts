import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  experimental: {
    // Logos (2 MB) and up to 5 payment attachments (10 MB each); headroom so oversize files reach the validators.
    serverActions: { bodySizeLimit: "55mb" },
  },
};

export default nextConfig;
