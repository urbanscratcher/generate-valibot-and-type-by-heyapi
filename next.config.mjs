/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@hey-api/openapi-ts"],
  outputFileTracingIncludes: {
    "/api/**": [
      "node_modules/@hey-api/**",
      "node_modules/.pnpm/**/node_modules/@hey-api/**"
    ]
  }
};

export default nextConfig;
