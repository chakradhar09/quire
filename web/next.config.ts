import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // Pasted drafts can be up to 2 MB (checked in submitText); the default action body limit is 1 MB.
    serverActions: { bodySizeLimit: "3mb" },
    // proxy.ts runs on every path, and Next buffers request bodies for it only up to 10 MB by default,
    // silently cutting off anything longer. Uploads are up to 50 MB plus multipart overhead.
    proxyClientMaxBodySize: "52mb",
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
