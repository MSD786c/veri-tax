import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Entities became Projects (one case per building permit).
  redirects: async () => [{ source: "/entities", destination: "/projects", permanent: false }],
};

export default nextConfig;
