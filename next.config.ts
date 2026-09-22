import type { NextConfig } from "next";

const mobileBuild = process.env.MOBILE_BUILD === "1";

const nextConfig: NextConfig = mobileBuild
  ? {
      output: "export",
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {};

export default nextConfig;
