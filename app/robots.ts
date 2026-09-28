import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Everything but the API may be crawled; the sitemap lists what is worth it. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
