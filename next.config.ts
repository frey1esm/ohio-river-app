import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Produces a self-contained `.next/standalone` build (a trimmed
  // node_modules plus a generated server.js) for the Docker image — so the
  // runtime image only needs that folder plus `public/` and `.next/static`,
  // not the full dependency tree.
  output: "standalone",
  // The dev-only route indicator badge isn't part of the app's design and
  // was overlapping card content on short viewports during design review;
  // it never appears in production builds either way.
  devIndicators: false,
  // Next dev blocks cross-origin requests to its own JS bundles/HMR socket
  // by default — loading the app from a phone on the LAN via this Mac's IP
  // counts as cross-origin relative to "localhost", so the page's HTML
  // loads but the client bundle (and with it the chart, which only renders
  // client-side) never does. This allowlists this machine's current LAN
  // IP; it will need updating here if that IP changes (e.g. after
  // reconnecting to Wi-Fi).
  allowedDevOrigins: ["192.168.0.117"],
};

export default nextConfig;
