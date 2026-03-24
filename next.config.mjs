/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/generate": [
      "node_modules/@hey-api/openapi-ts/**",
      "node_modules/.pnpm/**/node_modules/@hey-api/openapi-ts/**"
    ],
    "/api/generate-file": [
      "node_modules/@hey-api/openapi-ts/**",
      "node_modules/.pnpm/**/node_modules/@hey-api/openapi-ts/**"
    ],
    "/api/file": [
      "node_modules/@hey-api/openapi-ts/**",
      "node_modules/.pnpm/**/node_modules/@hey-api/openapi-ts/**"
    ]
  }
};

export default nextConfig;
