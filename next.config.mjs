/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@hey-api/openapi-ts"],
  outputFileTracingIncludes: {
    "/api/**": [
      ".cache/openapi/**",
      "node_modules/@hey-api/**",
      "node_modules/.pnpm/**/node_modules/@hey-api/**"
    ]
  }
};

export default nextConfig;
