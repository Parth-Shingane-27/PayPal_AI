import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GlobalGig",
    short_name: "GlobalGig",
    description: "Freelance across borders: localized service pages, milestone payments through PayPal held until the work is accepted, payouts in your home currency.",
    start_url: "/",
    display: "standalone",
    background_color: "#fbf8f1",
    theme_color: "#c99a2e",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
