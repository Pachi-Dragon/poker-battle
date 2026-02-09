declare module "next-pwa" {
  const withPWA: (
    config: Record<string, unknown>
  ) => (nextConfig: import("next").NextConfig) => import("next").NextConfig;
  export default withPWA;
}
