import type { Availability } from "../../src/generated/prisma/client";

/**
 * Seed people: 10 freelancers in different countries and 10 clients in
 * different markets. There is no real auth: the demo login lets you click any
 * of them. Hourly floors are in each freelancer's home currency, minor units.
 */

export type Lang = "en" | "de" | "fr" | "es" | "it" | "ja" | "hi";
export const LANGS: readonly Lang[] = ["en", "de", "fr", "es", "it", "ja", "hi"];
export const langOf = (locale: string): Lang => locale.slice(0, 2) as Lang;

export type SeedFreelancerSpec = {
  slug: string;
  name: string;
  country: string;
  currency: string;
  /** UI and agent language. */
  locale: string;
  timezone: string;
  headline: string;
  bio: string;
  skills: string[];
  languages: string[];
  hourly_floor_minor: number;
  availability: Availability;
  /** Relative weight of how much work this freelancer gets. */
  demand: number;
};

export const FREELANCERS: SeedFreelancerSpec[] = [
  {
    slug: "priya",
    name: "Priya Raman Krishnan",
    country: "IN",
    currency: "USD", // PayPal pays India in USD; PayPal converts to INR on withdrawal.
    locale: "hi-IN",
    timezone: "Asia/Kolkata",
    headline: "Logo and brand identity designer for small businesses",
    bio: "Ten years of logos, brand marks and packaging for cafés, clinics and start-ups in India, Europe and the US.",
    skills: ["logo design", "brand identity", "illustrator", "packaging", "typography"],
    languages: ["hi", "en", "ta"],
    hourly_floor_minor: 2_500,
    availability: "AVAILABLE",
    demand: 1.5,
  },
  {
    slug: "jonas",
    name: "Jonas Becker",
    country: "DE",
    currency: "EUR",
    locale: "de-DE",
    timezone: "Europe/Berlin",
    headline: "Technical translator, German and English",
    bio: "Former mechanical engineer. I translate manuals, datasheets and software UIs between German and English, with terminology lists you keep.",
    skills: ["translation", "german", "english", "technical writing", "localization"],
    languages: ["de", "en"],
    hourly_floor_minor: 5_500,
    availability: "AVAILABLE",
    demand: 1.2,
  },
  {
    slug: "lucas",
    name: "Lucas Oliveira",
    country: "BR",
    currency: "BRL",
    locale: "en-US",
    timezone: "America/Sao_Paulo",
    headline: "React and Next.js developer",
    bio: "Front-end developer building fast React and Next.js apps, dashboards and design systems for teams in the US and Europe.",
    skills: ["react", "next.js", "typescript", "tailwind", "web performance"],
    languages: ["pt", "en", "es"],
    hourly_floor_minor: 15_000,
    availability: "LIMITED",
    demand: 1.3,
  },
  {
    slug: "maria",
    name: "Maria Santos",
    country: "PH",
    currency: "PHP",
    locale: "en-US",
    timezone: "Asia/Manila",
    headline: "Video editor for YouTube, ads and short-form",
    bio: "I edit YouTube videos, product ads and Reels/Shorts with captions, colour and sound design. Fast turnaround across time zones.",
    skills: ["video editing", "premiere pro", "after effects", "captions", "color grading"],
    languages: ["en", "fil"],
    hourly_floor_minor: 120_000,
    availability: "AVAILABLE",
    demand: 1.1,
  },
  {
    slug: "emily",
    name: "Emily Carter",
    country: "US",
    currency: "USD",
    locale: "en-US",
    timezone: "America/Chicago",
    headline: "Conversion copywriter for SaaS and e-commerce",
    bio: "Landing pages, email sequences and product descriptions that sell. Previously in-house at two SaaS companies.",
    skills: ["copywriting", "email marketing", "seo", "landing pages", "content strategy"],
    languages: ["en", "es"],
    hourly_floor_minor: 7_000,
    availability: "AVAILABLE",
    demand: 1.0,
  },
  {
    slug: "haruka",
    name: "Haruka Sato",
    country: "JP",
    currency: "JPY",
    locale: "ja-JP",
    timezone: "Asia/Tokyo",
    headline: "3D artist: product renders and stylised characters",
    bio: "Blender and ZBrush artist. Photoreal product renders for shops and stylised characters for games and anime projects.",
    skills: ["3d modeling", "blender", "zbrush", "product rendering", "character design"],
    languages: ["ja", "en"],
    hourly_floor_minor: 6_000,
    availability: "AVAILABLE",
    demand: 0.9,
  },
  {
    slug: "camille",
    name: "Camille Laurent",
    country: "FR",
    currency: "EUR",
    locale: "fr-FR",
    timezone: "Europe/Paris",
    headline: "UX/UI designer for web and mobile apps",
    bio: "I design clear interfaces in Figma, from user flows to tested prototypes and handover-ready design systems.",
    skills: ["ux design", "ui design", "figma", "prototyping", "design systems"],
    languages: ["fr", "en"],
    hourly_floor_minor: 6_000,
    availability: "LIMITED",
    demand: 0.9,
  },
  {
    slug: "sofia",
    name: "Sofía Ramírez",
    country: "MX",
    currency: "MXN",
    locale: "es-MX",
    timezone: "America/Mexico_City",
    headline: "Spanish localization and subtitles",
    bio: "I localize apps, websites and videos into Latin American and European Spanish, with subtitles timed to the frame.",
    skills: ["spanish", "localization", "subtitling", "translation", "transcreation"],
    languages: ["es", "en"],
    hourly_floor_minor: 60_000,
    availability: "AVAILABLE",
    demand: 0.8,
  },
  {
    slug: "giulia",
    name: "Giulia Romano",
    country: "IT",
    currency: "EUR",
    locale: "it-IT",
    timezone: "Europe/Rome",
    headline: "Illustrator for books, packaging and editorial",
    bio: "Watercolour and digital illustration for children's books, food packaging and magazines.",
    skills: ["illustration", "watercolor", "procreate", "children's books", "packaging illustration"],
    languages: ["it", "en"],
    hourly_floor_minor: 4_500,
    availability: "AVAILABLE",
    demand: 0.8,
  },
  {
    slug: "oliver",
    name: "Oliver Hughes",
    country: "GB",
    currency: "GBP",
    locale: "en-GB",
    timezone: "Europe/London",
    headline: "Data analyst: Python, SQL and dashboards",
    bio: "I turn messy spreadsheets and databases into clean pipelines and dashboards your team will actually open.",
    skills: ["python", "sql", "data analysis", "dashboards", "pandas"],
    languages: ["en"],
    hourly_floor_minor: 5_500,
    availability: "AVAILABLE",
    demand: 1.0,
  },
];

export type SeedClientSpec = {
  slug: string;
  name: string;
  locale: string;
  country: string;
  company_name: string | null;
  tax_id: string | null;
  /** Relative weight of how much work this client commissions. */
  demand: number;
};

export const CLIENTS: SeedClientSpec[] = [
  { slug: "ananya", name: "Ananya Iyer", locale: "en-US", country: "US", company_name: "Brightline Health Inc.", tax_id: null, demand: 1.3 },
  { slug: "priya-s", name: "Priya Sharma", locale: "hi-IN", country: "IN", company_name: null, tax_id: null, demand: 1.0 },
  { slug: "katrin", name: "Katrin Weber", locale: "de-DE", country: "DE", company_name: "Nordlicht GmbH", tax_id: "DE298765431", demand: 1.4 },
  { slug: "kenji", name: "Kenji Watanabe", locale: "ja-JP", country: "JP", company_name: "Sakura Robotics K.K.", tax_id: null, demand: 1.0 },
  { slug: "chloe", name: "Chloé Martin", locale: "fr-FR", country: "FR", company_name: "Maison Lumière SARL", tax_id: "FR40123456789", demand: 0.9 },
  { slug: "diego", name: "Diego Fernández", locale: "es-ES", country: "ES", company_name: null, tax_id: null, demand: 0.7 },
  { slug: "marco", name: "Marco Bianchi", locale: "it-IT", country: "IT", company_name: "Bianchi Design Srl", tax_id: "IT01234567890", demand: 0.8 },
  { slug: "olivia", name: "Olivia Brown", locale: "en-GB", country: "GB", company_name: "Brightwater Ltd", tax_id: "GB123456789", demand: 1.1 },
  { slug: "liam", name: "Liam Tremblay", locale: "en-CA", country: "CA", company_name: null, tax_id: null, demand: 0.7 },
  { slug: "ana", name: "Ana López", locale: "es-MX", country: "MX", company_name: "Café Tierra S.A. de C.V.", tax_id: null, demand: 0.8 },
];
