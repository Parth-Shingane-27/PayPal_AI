import type { MetadataRoute } from "next";

const SITE_URL = process.env.APP_URL ?? "http://localhost:3000";

/** Only the public pages; the signed-in workspace is not indexed. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
  ];
}
