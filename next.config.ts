import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@react-pdf/renderer'],
  // pdfkit reads its standard fonts (Helvetica .afm files) from disk at runtime, which file tracing
  // misses, so Vercel's function bundle lacked them and every invoice PDF failed. Ship them with every
  // route: PDFs are built by the PDF route and by invoice server actions (issue, regenerate).
  outputFileTracingIncludes: {
    '/**': ['./node_modules/pdfkit/js/data/*.afm'],
  },
  experimental: {
    // Bank statements (4 MB; Vercel caps requests at 4.5 MB) and logos (2 MB), with headroom so an oversize file reaches its validator. Payment files never pass
    // through server actions: the browser uploads them straight to storage with signed upload URLs.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
