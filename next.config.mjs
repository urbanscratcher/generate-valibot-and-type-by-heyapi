/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig = {
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
  outputFileTracingIncludes: {
    "/api/openapi/refresh": [
      "./node_modules/@hey-api/openapi-ts/**/*",
    ],
  },
};

export default nextConfig;
