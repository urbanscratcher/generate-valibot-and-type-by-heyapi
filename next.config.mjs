/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    "/api/**": [
      "node_modules/@hey-api/openapi-ts/dist/**",
      "node_modules/.pnpm/**/node_modules/@hey-api/openapi-ts/dist/**"
    ]
  }
};

export default nextConfig;
