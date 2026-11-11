import type { Lang } from "./people";

/**
 * Seed services: 4 per freelancer, 40 in all. The first service of each
 * freelancer is the "hero": written in every language, so it has a page in
 * every market. The others are written in English and, for non-English
 * freelancers, in their own language, so they have pages in the English
 * markets and in the markets of that language.
 *
 * Package prices are not written here: the seed derives them from the
 * freelancer's hourly floor x estimated hours (never below the floor), then
 * converts them into each market currency at reference rates.
 */

type Text = { title: string; description: string };

export type SeedServiceSpec = {
  code: string;
  category: string;
  tags: string[];
  hero: boolean;
  model: "PACKAGES" | "HOURLY";
  /** Estimated hours per Basic / Standard / Premium package. */
  hours?: [number, number, number];
  days?: [number, number, number];
  scopes?: [string, string, string];
  t: Partial<Record<Lang, Text>>;
};

const pk = (hours: [number, number, number], days: [number, number, number], scopes: [string, string, string]) => ({ model: "PACKAGES" as const, hours, days, scopes });

export const SERVICES: Record<string, SeedServiceSpec[]> = {
  priya: [
    {
      code: "LOGO",
      category: "Design",
      tags: ["logo", "branding", "vector"],
      hero: true,
      ...pk([4, 8, 16], [3, 5, 8], ["2 logo concepts, PNG and SVG files", "4 concepts, colour palette, all file formats", "6 concepts, brand mark, palette, typography and a one-page guide"]),
      t: {
        en: { title: "Logo design for your business", description: "A distinctive logo drawn for your brand, delivered as vector files ready for print, web and social media." },
        de: { title: "Logodesign für Ihr Unternehmen", description: "Ein unverwechselbares Logo für Ihre Marke, geliefert als Vektordateien für Druck, Web und soziale Medien." },
        fr: { title: "Création de logo pour votre entreprise", description: "Un logo unique dessiné pour votre marque, livré en fichiers vectoriels prêts pour l'impression, le web et les réseaux sociaux." },
        es: { title: "Diseño de logotipo para tu negocio", description: "Un logotipo único dibujado para tu marca, entregado en archivos vectoriales listos para imprenta, web y redes sociales." },
        it: { title: "Design del logo per la tua attività", description: "Un logo unico disegnato per il tuo marchio, consegnato in file vettoriali pronti per stampa, web e social." },
        ja: { title: "ビジネス向けロゴデザイン", description: "ブランドのために描き下ろす個性的なロゴ。印刷・Web・SNSですぐ使えるベクターデータで納品します。" },
        hi: { title: "आपके व्यवसाय के लिए लोगो डिज़ाइन", description: "आपके ब्रांड के लिए बनाया गया अनोखा लोगो, प्रिंट, वेब और सोशल मीडिया के लिए वेक्टर फ़ाइलों में।" },
      },
    },
    {
      code: "BRAND-KIT",
      category: "Design",
      tags: ["brand identity", "style guide"],
      hero: false,
      ...pk([10, 18, 30], [5, 8, 14], ["Logo refresh and colour palette", "Logo, palette, fonts and business card", "Full identity: logo system, stationery, social templates and brand book"]),
      t: {
        en: { title: "Brand identity kit", description: "Logo, colours, fonts and templates that make your business look the same everywhere." },
        hi: { title: "ब्रांड आइडेंटिटी किट", description: "लोगो, रंग, फ़ॉन्ट और टेम्पलेट, ताकि आपका व्यवसाय हर जगह एक जैसा दिखे।" },
      },
    },
    {
      code: "PACKAGING",
      category: "Design",
      tags: ["packaging", "label design"],
      hero: false,
      ...pk([6, 12, 20], [4, 7, 12], ["One label design", "Label and box for one product", "Packaging range for up to 4 products"]),
      t: {
        en: { title: "Product packaging and label design", description: "Print-ready labels and boxes for food, cosmetics and small-batch products." },
        hi: { title: "उत्पाद पैकेजिंग और लेबल डिज़ाइन", description: "खाद्य, कॉस्मेटिक और छोटे बैच के उत्पादों के लिए प्रिंट के लिए तैयार लेबल और बॉक्स।" },
      },
    },
    {
      code: "SOCIAL-KIT",
      category: "Design",
      tags: ["social media", "templates", "canva"],
      hero: false,
      ...pk([3, 6, 10], [2, 4, 6], ["10 post templates", "20 post and story templates", "40 templates, highlight covers and a Canva brand kit"]),
      t: {
        en: { title: "Social media graphics pack", description: "On-brand templates for Instagram, LinkedIn and Facebook that you can edit yourself in Canva." },
        hi: { title: "सोशल मीडिया ग्राफ़िक्स पैक", description: "Instagram, LinkedIn और Facebook के लिए आपके ब्रांड जैसे टेम्पलेट, जिन्हें आप Canva में खुद बदल सकते हैं।" },
      },
    },
  ],
  jonas: [
    {
      code: "DE-EN-TECH",
      category: "Translation",
      tags: ["german", "english", "technical translation", "manuals"],
      hero: true,
      ...pk([4, 10, 24], [3, 6, 12], ["Up to 1,500 words", "Up to 4,000 words with a terminology list", "Up to 10,000 words, terminology list and second-pass review"]),
      t: {
        en: { title: "German to English technical translation", description: "Manuals, datasheets and specifications translated by an engineer, with consistent terminology." },
        de: { title: "Technische Übersetzung Deutsch-Englisch", description: "Handbücher, Datenblätter und Spezifikationen, übersetzt von einem Ingenieur, mit einheitlicher Terminologie." },
        fr: { title: "Traduction technique allemand-anglais", description: "Manuels, fiches techniques et cahiers des charges traduits par un ingénieur, avec une terminologie cohérente." },
        es: { title: "Traducción técnica de alemán a inglés", description: "Manuales, fichas técnicas y especificaciones traducidos por un ingeniero, con terminología coherente." },
        it: { title: "Traduzione tecnica dal tedesco all'inglese", description: "Manuali, schede tecniche e specifiche tradotti da un ingegnere, con terminologia coerente." },
        ja: { title: "ドイツ語→英語 技術翻訳", description: "マニュアル、データシート、仕様書をエンジニアが翻訳。用語を統一して仕上げます。" },
        hi: { title: "जर्मन से अंग्रेज़ी तकनीकी अनुवाद", description: "मैनुअल, डेटाशीट और स्पेसिफ़िकेशन का अनुवाद एक इंजीनियर द्वारा, एक जैसी शब्दावली के साथ।" },
      },
    },
    {
      code: "EN-DE-UI",
      category: "Translation",
      tags: ["software localization", "german", "ui strings"],
      hero: false,
      ...pk([3, 8, 16], [2, 5, 9], ["Up to 500 UI strings", "Up to 1,500 strings with a glossary", "Up to 4,000 strings, glossary and in-context review"]),
      t: {
        en: { title: "English to German software localization", description: "App and website strings localized into natural German, delivered in your JSON, XLIFF or PO files." },
        de: { title: "Software-Lokalisierung Englisch-Deutsch", description: "App- und Website-Texte in natürliches Deutsch lokalisiert, geliefert in Ihren JSON-, XLIFF- oder PO-Dateien." },
      },
    },
    {
      code: "TERM-REVIEW",
      category: "Translation",
      tags: ["review", "terminology", "proofreading"],
      hero: false,
      model: "HOURLY",
      t: {
        en: { title: "Translation review and terminology, by the hour", description: "An engineer checks existing translations and builds the terminology list your team keeps using." },
        de: { title: "Übersetzungsprüfung und Terminologie, stundenweise", description: "Ein Ingenieur prüft vorhandene Übersetzungen und erstellt die Terminologieliste, mit der Ihr Team weiterarbeitet." },
      },
    },
    {
      code: "DE-EN-MARKETING",
      category: "Translation",
      tags: ["marketing translation", "transcreation", "german"],
      hero: false,
      ...pk([3, 7, 14], [2, 4, 8], ["One web page or brochure, up to 800 words", "Up to 2,500 words, two headline options", "Website or catalogue up to 6,000 words with SEO keywords"]),
      t: {
        en: { title: "German to English marketing translation", description: "Websites and brochures that read as if they were written in English, keywords included." },
        de: { title: "Marketing-Übersetzung Deutsch-Englisch", description: "Websites und Broschüren, die sich lesen, als wären sie auf Englisch geschrieben, inklusive Keywords." },
      },
    },
  ],
  lucas: [
    {
      code: "REACT-APP",
      category: "Development",
      tags: ["react", "next.js", "typescript", "web app"],
      hero: true,
      ...pk([16, 40, 90], [5, 12, 25], ["One page or component, responsive", "Up to 5 pages with API integration", "Full app: up to 12 pages, auth, API, tests and deployment"]),
      t: {
        en: { title: "React and Next.js web app development", description: "Fast, accessible React and Next.js apps built in TypeScript, from one component to a full product." },
        de: { title: "Webentwicklung mit React und Next.js", description: "Schnelle, barrierearme Apps mit React und Next.js in TypeScript, von einer Komponente bis zum fertigen Produkt." },
        fr: { title: "Développement d'applications web React et Next.js", description: "Des applications React et Next.js rapides et accessibles en TypeScript, d'un composant à un produit complet." },
        es: { title: "Desarrollo de aplicaciones web con React y Next.js", description: "Aplicaciones rápidas y accesibles con React y Next.js en TypeScript, desde un componente hasta un producto completo." },
        it: { title: "Sviluppo di web app con React e Next.js", description: "App React e Next.js veloci e accessibili in TypeScript, da un singolo componente a un prodotto completo." },
        ja: { title: "React・Next.js Webアプリ開発", description: "TypeScriptで高速かつアクセシブルなReact・Next.jsアプリを開発。コンポーネント1つから製品全体まで対応します。" },
        hi: { title: "React और Next.js वेब ऐप डेवलपमेंट", description: "TypeScript में तेज़ और सुलभ React व Next.js ऐप, एक कंपोनेंट से लेकर पूरे प्रोडक्ट तक।" },
      },
    },
    {
      code: "LANDING-BUILD",
      category: "Development",
      tags: ["landing page", "next.js", "tailwind"],
      hero: false,
      ...pk([8, 16, 28], [3, 6, 10], ["One landing page from your design", "Landing page with CMS and analytics", "Landing page, CMS, A/B test setup and Lighthouse 95+"]),
      t: { en: { title: "Landing page built in Next.js", description: "Your design turned into a fast, responsive landing page with analytics and an editable CMS." } },
    },
    {
      code: "REACT-HOURLY",
      category: "Development",
      tags: ["react", "consulting", "bug fixing"],
      hero: false,
      model: "HOURLY",
      t: { en: { title: "React development and bug fixing, by the hour", description: "Extra hands for your React codebase: features, bug fixes, reviews and performance work." } },
    },
    {
      code: "DESIGN-SYSTEM",
      category: "Development",
      tags: ["design system", "storybook", "components"],
      hero: false,
      ...pk([20, 45, 80], [7, 14, 25], ["10 components in Storybook", "25 components with tests and docs", "Full component library, theming, tests and npm package"]),
      t: { en: { title: "React component library and design system", description: "Reusable, documented components in Storybook that match your Figma design." } },
    },
  ],
  maria: [
    {
      code: "YT-EDIT",
      category: "Video",
      tags: ["youtube", "video editing", "captions"],
      hero: true,
      ...pk([4, 8, 14], [2, 4, 6], ["Up to 8 minutes, cuts and captions", "Up to 15 minutes, captions, music and colour", "Up to 25 minutes, motion graphics, thumbnails and 3 Shorts"]),
      t: {
        en: { title: "YouTube video editing with captions", description: "Tight cuts, captions, music and colour so your videos keep viewers watching." },
        de: { title: "YouTube-Videoschnitt mit Untertiteln", description: "Präzise Schnitte, Untertitel, Musik und Farbkorrektur, damit Zuschauer dranbleiben." },
        fr: { title: "Montage vidéo YouTube avec sous-titres", description: "Coupes nettes, sous-titres, musique et étalonnage pour que vos spectateurs restent jusqu'au bout." },
        es: { title: "Edición de videos de YouTube con subtítulos", description: "Cortes precisos, subtítulos, música y color para que tu audiencia siga viendo." },
        it: { title: "Montaggio video YouTube con sottotitoli", description: "Tagli precisi, sottotitoli, musica e colore perché i tuoi spettatori restino fino alla fine." },
        ja: { title: "字幕付きYouTube動画編集", description: "テンポの良いカット、字幕、BGM、カラー調整で、最後まで見てもらえる動画に仕上げます。" },
        hi: { title: "कैप्शन के साथ YouTube वीडियो एडिटिंग", description: "सटीक कट, कैप्शन, संगीत और रंग, ताकि दर्शक आपका वीडियो अंत तक देखें।" },
      },
    },
    {
      code: "SHORTS",
      category: "Video",
      tags: ["reels", "shorts", "tiktok"],
      hero: false,
      ...pk([3, 6, 12], [2, 3, 5], ["3 short clips from your footage", "8 clips with captions and hooks", "20 clips, captions, hooks and a posting calendar"]),
      t: { en: { title: "Reels, Shorts and TikTok edits", description: "Vertical clips cut from your long videos, with captions and hooks for each platform." } },
    },
    {
      code: "PRODUCT-AD",
      category: "Video",
      tags: ["video ads", "motion graphics", "e-commerce"],
      hero: false,
      ...pk([5, 10, 18], [3, 5, 8], ["One 15-second ad", "Two 30-second ads with motion text", "Ad set: 3 lengths, 2 formats, music licensing"]),
      t: { en: { title: "Product video ads for social media", description: "Short ads from your product footage, sized for Meta, TikTok and YouTube." } },
    },
    {
      code: "PODCAST-EDIT",
      category: "Video",
      tags: ["podcast", "audio", "video podcast"],
      hero: false,
      ...pk([3, 5, 9], [2, 3, 5], ["One audio episode up to 45 minutes", "Video episode with 2 cameras", "Video episode, 3 clips and show notes"]),
      t: { en: { title: "Podcast editing, audio and video", description: "Clean audio, multi-camera video and clips ready to post for each episode." } },
    },
  ],
  emily: [
    {
      code: "LANDING-COPY",
      category: "Writing",
      tags: ["copywriting", "landing page", "saas"],
      hero: true,
      ...pk([4, 8, 14], [3, 5, 8], ["One landing page section set", "Full landing page with two headline tests", "Landing page, 3 ad variations and a 3-email follow-up"]),
      t: {
        en: { title: "Landing page copywriting that converts", description: "Clear, persuasive landing page copy built on research into your customers' own words." },
        de: { title: "Landingpage-Texte, die konvertieren", description: "Klare, überzeugende Texte für Ihre Landingpage, aufgebaut auf den Worten Ihrer Kunden." },
        fr: { title: "Rédaction de landing pages qui convertissent", description: "Des textes clairs et persuasifs pour votre landing page, fondés sur les mots de vos clients." },
        es: { title: "Textos para landing pages que convierten", description: "Textos claros y persuasivos para tu landing page, basados en las palabras de tus clientes." },
        it: { title: "Copywriting per landing page che convertono", description: "Testi chiari e persuasivi per la tua landing page, basati sulle parole dei tuoi clienti." },
        ja: { title: "成果につながるランディングページのコピーライティング", description: "顧客の言葉をもとに、わかりやすく説得力のあるランディングページの文章を書きます。" },
        hi: { title: "कन्वर्ट करने वाली लैंडिंग पेज कॉपीराइटिंग", description: "आपके ग्राहकों के अपने शब्दों पर आधारित, साफ़ और असरदार लैंडिंग पेज कॉपी।" },
      },
    },
    {
      code: "EMAIL-SEQ",
      category: "Writing",
      tags: ["email marketing", "onboarding", "newsletters"],
      hero: false,
      ...pk([4, 9, 16], [3, 6, 10], ["3-email welcome sequence", "7-email onboarding or launch sequence", "12 emails across onboarding and win-back"]),
      t: { en: { title: "Email sequences for onboarding and launches", description: "Welcome, onboarding and launch emails that get opened and clicked." } },
    },
    {
      code: "PRODUCT-DESC",
      category: "Writing",
      tags: ["product descriptions", "e-commerce", "seo"],
      hero: false,
      ...pk([3, 6, 12], [2, 4, 7], ["10 product descriptions", "25 descriptions with SEO titles", "60 descriptions, SEO titles and category pages"]),
      t: { en: { title: "E-commerce product descriptions", description: "Product descriptions with SEO titles that help shoppers decide." } },
    },
    {
      code: "BLOG-SEO",
      category: "Writing",
      tags: ["blog", "seo", "content"],
      hero: false,
      ...pk([3, 7, 14], [3, 7, 14], ["One 1,200-word article", "Three articles with keyword research", "Six articles and a content plan"]),
      t: { en: { title: "SEO blog articles for B2B and SaaS", description: "Researched articles that rank and that your sales team will want to share." } },
    },
  ],
  haruka: [
    {
      code: "PRODUCT-3D",
      category: "3D",
      tags: ["3d rendering", "product visualization", "blender"],
      hero: true,
      ...pk([6, 14, 28], [4, 7, 12], ["One product, 3 white-background renders", "One product, 6 renders and a lifestyle scene", "Up to 3 products, 12 renders and a 360° turntable"]),
      t: {
        en: { title: "Photoreal 3D product renders", description: "Studio-quality product images from your CAD files or photos, ready for your shop and ads." },
        de: { title: "Fotorealistische 3D-Produktrenderings", description: "Produktbilder in Studioqualität aus Ihren CAD-Dateien oder Fotos, bereit für Shop und Werbung." },
        fr: { title: "Rendus 3D photoréalistes de produits", description: "Des visuels produits dignes d'un studio, à partir de vos fichiers CAO ou photos, prêts pour votre boutique et vos publicités." },
        es: { title: "Renders 3D fotorrealistas de productos", description: "Imágenes de producto con calidad de estudio a partir de tus archivos CAD o fotos, listas para tu tienda y anuncios." },
        it: { title: "Render 3D fotorealistici di prodotto", description: "Immagini di prodotto da studio a partire dai tuoi file CAD o dalle foto, pronte per shop e pubblicità." },
        ja: { title: "フォトリアルな3D製品レンダリング", description: "CADデータや写真から、ECサイトや広告にそのまま使えるスタジオ品質の製品画像を制作します。" },
        hi: { title: "फ़ोटोरियल 3D प्रोडक्ट रेंडर", description: "आपकी CAD फ़ाइलों या फ़ोटो से स्टूडियो जैसी प्रोडक्ट तस्वीरें, शॉप और विज्ञापनों के लिए तैयार।" },
      },
    },
    {
      code: "CHARACTER-3D",
      category: "3D",
      tags: ["character design", "zbrush", "game art"],
      hero: false,
      ...pk([12, 28, 56], [7, 14, 25], ["Character sculpt, one pose", "Textured character, 3 poses", "Game-ready character: retopology, rig and textures"]),
      t: {
        en: { title: "Stylised 3D character modeling", description: "Anime and game characters sculpted, textured and ready to pose or rig." },
        ja: { title: "デフォルメ3Dキャラクターモデリング", description: "アニメやゲーム向けのキャラクターを造形・テクスチャまで仕上げ、ポーズやリグに対応します。" },
      },
    },
    {
      code: "INTERIOR-3D",
      category: "3D",
      tags: ["architectural visualization", "interior"],
      hero: false,
      ...pk([10, 20, 36], [5, 9, 15], ["One room, 2 views", "One room, 5 views and day/night lighting", "Up to 3 rooms, 10 views and a walkthrough video"]),
      t: {
        en: { title: "3D interior visualization", description: "Realistic interior renders for designers, shops and property listings." },
        ja: { title: "3Dインテリアパース", description: "設計事務所、店舗、不動産向けのリアルな室内パースを制作します。" },
      },
    },
    {
      code: "TURNTABLE",
      category: "3D",
      tags: ["animation", "360 product"],
      hero: false,
      ...pk([5, 10, 18], [3, 5, 8], ["10-second 360° turntable", "20-second turntable with exploded view", "30-second animation with music and captions"]),
      t: {
        en: { title: "360° product turntable animation", description: "Spinning product animations and exploded views for product pages and launches." },
        ja: { title: "360°製品ターンテーブルアニメーション", description: "商品ページや発表用に、回転アニメーションや分解図を制作します。" },
      },
    },
  ],
  camille: [
    {
      code: "APP-UX",
      category: "Design",
      tags: ["ux", "ui", "figma", "mobile app"],
      hero: true,
      ...pk([10, 25, 50], [5, 10, 20], ["3 key screens in Figma", "Up to 12 screens with a clickable prototype", "Full app: user flows, 25+ screens, prototype and user testing"]),
      t: {
        en: { title: "UX/UI design for your mobile app", description: "User flows, screens and a clickable Figma prototype your developers can build from." },
        de: { title: "UX/UI-Design für Ihre mobile App", description: "User Flows, Screens und ein klickbarer Figma-Prototyp, mit dem Ihre Entwickler direkt arbeiten können." },
        fr: { title: "Design UX/UI pour votre application mobile", description: "Parcours utilisateurs, écrans et prototype Figma cliquable, prêts pour vos développeurs." },
        es: { title: "Diseño UX/UI para tu aplicación móvil", description: "Flujos de usuario, pantallas y un prototipo clicable en Figma listo para tus desarrolladores." },
        it: { title: "Design UX/UI per la tua app mobile", description: "Flussi utente, schermate e un prototipo Figma cliccabile pronto per i tuoi sviluppatori." },
        ja: { title: "モバイルアプリのUX/UIデザイン", description: "ユーザーフロー、画面設計、開発者がそのまま使えるFigmaのクリック可能なプロトタイプを作成します。" },
        hi: { title: "आपके मोबाइल ऐप के लिए UX/UI डिज़ाइन", description: "यूज़र फ़्लो, स्क्रीन और Figma में क्लिक करने योग्य प्रोटोटाइप, जिससे आपके डेवलपर सीधे काम कर सकें।" },
      },
    },
    {
      code: "UX-AUDIT",
      category: "Design",
      tags: ["ux audit", "usability"],
      hero: false,
      ...pk([5, 10, 18], [3, 5, 8], ["Audit of one key flow", "Audit of 3 flows with prioritised fixes", "Full audit, 5 user interviews and redesign of the worst flow"]),
      t: {
        en: { title: "UX audit of your website or app", description: "A clear list of what confuses your users, ranked by impact, with fixes." },
        fr: { title: "Audit UX de votre site ou application", description: "Une liste claire de ce qui gêne vos utilisateurs, classée par impact, avec des solutions." },
      },
    },
    {
      code: "WEB-UI",
      category: "Design",
      tags: ["web design", "figma", "responsive"],
      hero: false,
      ...pk([8, 18, 35], [4, 8, 14], ["Home page design, desktop and mobile", "Up to 5 pages, desktop and mobile", "Up to 12 pages, design system and prototype"]),
      t: {
        en: { title: "Website UI design in Figma", description: "Responsive page designs with a small design system, ready for development." },
        fr: { title: "Design d'interface de site web sur Figma", description: "Des maquettes responsives avec un mini design system, prêtes pour le développement." },
      },
    },
    {
      code: "FIGMA-DS",
      category: "Design",
      tags: ["design system", "figma", "components"],
      hero: false,
      ...pk([12, 26, 48], [6, 12, 20], ["Foundations: colours, type, spacing", "Foundations and 20 components", "Full library with variants, tokens and documentation"]),
      t: {
        en: { title: "Figma design system setup", description: "Tokens, components and documentation so your team designs faster and more consistently." },
        fr: { title: "Mise en place d'un design system Figma", description: "Tokens, composants et documentation pour une équipe qui conçoit plus vite et de façon cohérente." },
      },
    },
  ],
  sofia: [
    {
      code: "ES-LOC",
      category: "Translation",
      tags: ["spanish", "localization", "apps", "websites"],
      hero: true,
      ...pk([4, 10, 22], [3, 6, 12], ["Up to 1,500 words or 400 strings", "Up to 4,000 words, Latin American and Spain variants", "Up to 10,000 words, both variants, glossary and in-context QA"]),
      t: {
        en: { title: "Spanish localization for apps and websites", description: "Your product in natural Spanish for Mexico, Latin America or Spain, with the right tone for each." },
        de: { title: "Spanische Lokalisierung für Apps und Websites", description: "Ihr Produkt in natürlichem Spanisch für Mexiko, Lateinamerika oder Spanien, im passenden Ton." },
        fr: { title: "Localisation en espagnol pour apps et sites web", description: "Votre produit dans un espagnol naturel pour le Mexique, l'Amérique latine ou l'Espagne, avec le bon ton." },
        es: { title: "Localización al español para apps y sitios web", description: "Tu producto en un español natural para México, Latinoamérica o España, con el tono adecuado para cada uno." },
        it: { title: "Localizzazione in spagnolo per app e siti web", description: "Il tuo prodotto in uno spagnolo naturale per Messico, America Latina o Spagna, con il tono giusto." },
        ja: { title: "アプリ・Webサイトのスペイン語ローカライズ", description: "メキシコ、中南米、スペイン向けに、それぞれに合ったトーンの自然なスペイン語にローカライズします。" },
        hi: { title: "ऐप और वेबसाइट के लिए स्पैनिश लोकलाइज़ेशन", description: "मेक्सिको, लैटिन अमेरिका या स्पेन के लिए स्वाभाविक स्पैनिश में आपका प्रोडक्ट, सही लहजे के साथ।" },
      },
    },
    {
      code: "SUBTITLES",
      category: "Translation",
      tags: ["subtitles", "srt", "video"],
      hero: false,
      ...pk([3, 6, 12], [2, 4, 7], ["Up to 10 minutes of video", "Up to 30 minutes, translated and timed", "Up to 90 minutes, two Spanish variants and burned-in versions"]),
      t: {
        en: { title: "Spanish subtitles for video", description: "Translated, frame-timed subtitles delivered as SRT or VTT, or burned in." },
        es: { title: "Subtítulos en español para video", description: "Subtítulos traducidos y sincronizados al cuadro, en SRT o VTT, o incrustados en el video." },
      },
    },
    {
      code: "TRANSCREATION",
      category: "Translation",
      tags: ["transcreation", "marketing", "spanish"],
      hero: false,
      ...pk([3, 6, 12], [2, 4, 7], ["One campaign, up to 300 words", "Campaign with 3 headline options per market", "Full campaign for Mexico and Spain with cultural review"]),
      t: {
        en: { title: "Spanish transcreation for marketing campaigns", description: "Slogans and campaigns rewritten for Spanish-speaking audiences, not just translated." },
        es: { title: "Transcreación al español para campañas", description: "Eslóganes y campañas reescritos para el público hispanohablante, no solo traducidos." },
      },
    },
    {
      code: "ES-REVIEW",
      category: "Translation",
      tags: ["proofreading", "spanish"],
      hero: false,
      ...pk([2, 5, 10], [2, 3, 6], ["Review of up to 2,000 words", "Up to 6,000 words with style notes", "Up to 15,000 words and a style guide"]),
      t: {
        en: { title: "Spanish proofreading and review", description: "A native check of your Spanish texts for errors, tone and consistency." },
        es: { title: "Revisión y corrección de textos en español", description: "Revisión nativa de tus textos en español: errores, tono y coherencia." },
      },
    },
  ],
  giulia: [
    {
      code: "BOOK-ILLUS",
      category: "Illustration",
      tags: ["children's books", "watercolor", "illustration"],
      hero: true,
      ...pk([8, 20, 45], [7, 14, 30], ["Cover illustration", "Cover and 6 interior spreads", "Cover and up to 16 spreads, print-ready"]),
      t: {
        en: { title: "Children's book illustration", description: "Warm watercolour and digital illustrations for picture books, from character sketches to print-ready spreads." },
        de: { title: "Illustration von Kinderbüchern", description: "Warme Aquarell- und Digitalillustrationen für Bilderbücher, von Figurenskizzen bis zu druckfertigen Doppelseiten." },
        fr: { title: "Illustration de livres pour enfants", description: "Des illustrations à l'aquarelle et numériques pour albums jeunesse, des croquis de personnages aux doubles pages prêtes à imprimer." },
        es: { title: "Ilustración de libros infantiles", description: "Ilustraciones cálidas en acuarela y digitales para álbumes ilustrados, de los bocetos a las páginas listas para imprenta." },
        it: { title: "Illustrazione di libri per bambini", description: "Illustrazioni calde ad acquerello e digitali per albi illustrati, dagli schizzi dei personaggi alle tavole pronte per la stampa." },
        ja: { title: "子ども向け絵本のイラスト", description: "水彩とデジタルのあたたかいイラストで、キャラクターのラフから入稿用の見開きまで制作します。" },
        hi: { title: "बच्चों की किताबों के लिए चित्रांकन", description: "चित्र-पुस्तकों के लिए वॉटरकलर और डिजिटल चित्र, पात्रों के स्केच से लेकर प्रिंट के लिए तैयार पन्नों तक।" },
      },
    },
    {
      code: "PACK-ILLUS",
      category: "Illustration",
      tags: ["packaging", "food illustration"],
      hero: false,
      ...pk([6, 12, 24], [5, 9, 15], ["One illustration for a label", "Illustration set for one product line", "Illustrated packaging range up to 5 products"]),
      t: {
        en: { title: "Illustrated packaging for food and drink", description: "Hand-drawn illustrations that make your labels and boxes stand out on the shelf." },
        it: { title: "Packaging illustrato per cibo e bevande", description: "Illustrazioni disegnate a mano che fanno risaltare etichette e scatole sullo scaffale." },
      },
    },
    {
      code: "EDITORIAL",
      category: "Illustration",
      tags: ["editorial", "magazine"],
      hero: false,
      ...pk([3, 6, 12], [3, 5, 8], ["One spot illustration", "One full-page illustration", "Cover illustration and 3 spots"]),
      t: {
        en: { title: "Editorial illustration for magazines and blogs", description: "Illustrations that explain an idea at a glance, for print and online articles." },
        it: { title: "Illustrazione editoriale per riviste e blog", description: "Illustrazioni che spiegano un'idea a colpo d'occhio, per articoli stampati e online." },
      },
    },
    {
      code: "PORTRAIT",
      category: "Illustration",
      tags: ["portrait", "gift", "watercolor"],
      hero: false,
      ...pk([2, 4, 7], [3, 5, 7], ["One person, digital file", "Up to 3 people with background", "Up to 6 people, background and a printed copy"]),
      t: {
        en: { title: "Watercolour portrait from your photo", description: "A personal watercolour portrait of people or pets, painted from your photos." },
        it: { title: "Ritratto ad acquerello dalla tua foto", description: "Un ritratto personale ad acquerello di persone o animali, dipinto dalle tue foto." },
      },
    },
  ],
  oliver: [
    {
      code: "DASHBOARD",
      category: "Data",
      tags: ["dashboards", "power bi", "python", "sql"],
      hero: true,
      ...pk([8, 20, 40], [4, 8, 15], ["One dashboard from one data source", "Up to 3 dashboards, 3 sources, scheduled refresh", "Data model, 6 dashboards, alerts and team training"]),
      t: {
        en: { title: "Business dashboards from your data", description: "Your sales, marketing or ops data in clear dashboards that refresh themselves." },
        de: { title: "Business-Dashboards aus Ihren Daten", description: "Ihre Vertriebs-, Marketing- oder Betriebsdaten in klaren Dashboards, die sich selbst aktualisieren." },
        fr: { title: "Tableaux de bord à partir de vos données", description: "Vos données commerciales, marketing ou opérationnelles dans des tableaux de bord clairs, mis à jour automatiquement." },
        es: { title: "Dashboards de negocio con tus datos", description: "Tus datos de ventas, marketing u operaciones en dashboards claros que se actualizan solos." },
        it: { title: "Dashboard aziendali dai tuoi dati", description: "I tuoi dati di vendite, marketing o operations in dashboard chiare che si aggiornano da sole." },
        ja: { title: "データから作るビジネスダッシュボード", description: "営業・マーケティング・業務データを、自動更新されるわかりやすいダッシュボードにまとめます。" },
        hi: { title: "आपके डेटा से बिज़नेस डैशबोर्ड", description: "आपकी सेल्स, मार्केटिंग या ऑपरेशंस डेटा को साफ़ डैशबोर्ड में, जो अपने आप अपडेट होते हैं।" },
      },
    },
    {
      code: "DATA-CLEAN",
      category: "Data",
      tags: ["data cleaning", "pandas", "etl"],
      hero: false,
      ...pk([4, 10, 20], [2, 5, 10], ["Clean one spreadsheet or table", "Clean and merge up to 5 sources", "Automated pipeline with tests and documentation"]),
      t: { en: { title: "Data cleaning and pipelines in Python", description: "Messy spreadsheets and exports turned into clean, documented, repeatable pipelines." } },
    },
    {
      code: "DATA-HOURLY",
      category: "Data",
      tags: ["data analysis", "sql", "consulting"],
      hero: false,
      model: "HOURLY",
      t: { en: { title: "Data analysis and SQL help, by the hour", description: "Ad-hoc analysis, SQL queries and a second pair of eyes on your numbers." } },
    },
    {
      code: "FORECAST",
      category: "Data",
      tags: ["forecasting", "statistics"],
      hero: false,
      ...pk([8, 18, 32], [5, 9, 15], ["Sales forecast for one product line", "Forecast with seasonality and scenarios", "Forecasting model, dashboard and monthly refresh"]),
      t: { en: { title: "Sales and demand forecasting", description: "Forecasts you can explain to your board, with the assumptions written down." } },
    },
  ],
};

/** Hourly rates are the floor times this. */
export const HOURLY_MARKUP = 1.4;
/** Package prices are hours x floor x this (always above the floor). */
export const PACKAGE_MARKUP = 1.35;
