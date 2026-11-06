import type { ArtMotif } from "../../src/server/domain/product-art";

/**
 * Dummy catalogue for the dashboards. Legacy US/DE products live in seed.ts and
 * are not repeated here. "Hero" products are listed in every buyer market and
 * carry a title in each buyer language; the rest are listed in the seller's
 * home market plus the four English markets.
 *
 * Nothing here may be a wooden serving board or a cuckoo clock: the live eval
 * searches for those and expects the legacy listings.
 */

export type Lang = "en" | "de" | "fr" | "es" | "it" | "ja" | "hi";
export const langOf = (locale: string): Lang => locale.slice(0, 2) as Lang;

export type CatalogueProduct = {
  sku: string;
  motif: ArtMotif;
  category: string;
  /** Base price in US cents, before market rounding. */
  usd: number;
  stock: number;
  hero?: boolean;
  /** Titles by language. `en` and the seller's source language are required. */
  t: Partial<Record<Lang, string>> & { en: string };
  /** English description. */
  d: string;
  /** Source-language description when the seller does not write in English. */
  ds?: string;
  attributes?: Record<string, unknown>;
};

export const BUYER_MARKETS = ["en-US", "en-GB", "en-CA", "en-AU", "de-DE", "fr-FR", "es-ES", "es-MX", "ja-JP", "hi-IN"] as const;
export const ENGLISH_MARKETS = ["en-US", "en-GB", "en-CA", "en-AU"] as const;

export const COUNTRY_NAME: Record<string, Record<Lang, string>> = {
  US: { en: "the United States", de: "den USA", fr: "les États-Unis", es: "Estados Unidos", it: "Stati Uniti", ja: "アメリカ", hi: "अमेरिका" },
  DE: { en: "Germany", de: "Deutschland", fr: "l'Allemagne", es: "Alemania", it: "Germania", ja: "ドイツ", hi: "जर्मनी" },
  GB: { en: "the UK", de: "Großbritannien", fr: "le Royaume-Uni", es: "Reino Unido", it: "Regno Unito", ja: "イギリス", hi: "ब्रिटेन" },
  CA: { en: "Canada", de: "Kanada", fr: "le Canada", es: "Canadá", it: "Canada", ja: "カナダ", hi: "कनाडा" },
  AU: { en: "Australia", de: "Australien", fr: "l'Australie", es: "Australia", it: "Australia", ja: "オーストラリア", hi: "ऑस्ट्रेलिया" },
  FR: { en: "France", de: "Frankreich", fr: "la France", es: "Francia", it: "Francia", ja: "フランス", hi: "फ़्रांस" },
  ES: { en: "Spain", de: "Spanien", fr: "l'Espagne", es: "España", it: "Spagna", ja: "スペイン", hi: "स्पेन" },
  IT: { en: "Italy", de: "Italien", fr: "l'Italie", es: "Italia", it: "Italia", ja: "イタリア", hi: "इटली" },
  MX: { en: "Mexico", de: "Mexiko", fr: "le Mexique", es: "México", it: "Messico", ja: "メキシコ", hi: "मेक्सिको" },
  JP: { en: "Japan", de: "Japan", fr: "le Japon", es: "Japón", it: "Giappone", ja: "日本", hi: "जापान" },
  IN: { en: "India", de: "Indien", fr: "l'Inde", es: "India", it: "India", ja: "インド", hi: "भारत" },
};

/** Short localized description for markets without a hand-written one. */
export function templateDescription(lang: Lang, title: string, seller: string, sellerCountry: string, english: string): string {
  const from = COUNTRY_NAME[sellerCountry]?.[lang] ?? sellerCountry;
  switch (lang) {
    case "en":
      return english;
    case "de":
      return `${title}. In kleiner Auflage von ${seller} hergestellt und aus ${from} versendet. Versand mit Sendungsverfolgung.`;
    case "fr":
      return `${title}. Fabriqué en petite série par ${seller} et expédié depuis ${from}, avec suivi.`;
    case "es":
      return `${title}. Hecho en pequeñas tandas por ${seller} y enviado desde ${from} con seguimiento.`;
    case "it":
      return `${title}. Realizzato in piccoli lotti da ${seller} e spedito da ${from} con tracciamento.`;
    case "ja":
      return `${title}。${seller}が少量ずつ手作りし、${from}から追跡番号付きで発送します。`;
    case "hi":
      return `${title}। ${seller} द्वारा कम मात्रा में हाथ से बनाया गया और ${from} से ट्रैकिंग के साथ भेजा जाता है।`;
  }
}

/** Keyed by seller email slug ("us", "de", "gb", ...). */
export const CATALOGUE: Record<string, CatalogueProduct[]> = {
  us: [
    {
      sku: "STONEWARE-MUG", motif: "mug", category: "Kitchen", usd: 3200, stock: 46, hero: true,
      t: { en: "Speckled Stoneware Mug, 12 oz", de: "Gesprenkelter Steinzeugbecher, 350 ml", fr: "Mug en grès moucheté, 350 ml", es: "Taza de gres moteado, 350 ml", ja: "斑点模様のストーンウェア マグ 350ml", hi: "चित्तीदार स्टोनवेयर मग, 350 ml" },
      d: "Wheel-thrown in Vermont from speckled stoneware and glazed in a soft oatmeal white. Holds 12 oz. Dishwasher and microwave safe.",
    },
    {
      sku: "BEESWAX-TAPERS", motif: "candle", category: "Home", usd: 2400, stock: 80,
      t: { en: "Hand-Dipped Beeswax Taper Candles, Pair" },
      d: "A pair of 10-inch taper candles hand-dipped in pure Pennsylvania beeswax. Smokeless, dripless and lightly honey-scented. About 8 hours of burn each.",
    },
    {
      sku: "MAPLE-SPOONS", motif: "spoon", category: "Kitchen", usd: 3800, stock: 22,
      t: { en: "Carved Maple Cooking Spoon Set of 3" },
      d: "Three cooking spoons carved from hard maple offcuts: a stirrer, a flat sauté spoon and a small taster. Finished with food-safe oil.",
    },
    {
      sku: "WAXED-TOTE", motif: "bag", category: "Accessories", usd: 6400, stock: 9,
      t: { en: "Waxed Canvas Market Tote" },
      d: "A sturdy market tote in waxed cotton canvas with leather handles and copper rivets. Shrugs off rain and softens with age.",
    },
  ],
  de: [
    {
      sku: "LODENSCHAL", motif: "textile", category: "Textiles", usd: 6400, stock: 31, hero: true,
      t: { en: "Black Forest Loden Wool Scarf", de: "Lodenschal aus Schwarzwälder Schurwolle", fr: "Écharpe en laine bouillie de la Forêt-Noire", es: "Bufanda de lana loden de la Selva Negra", ja: "黒い森のローデンウール マフラー", hi: "ब्लैक फ़ॉरेस्ट लोडेन ऊन का स्कार्फ़" },
      d: "A warm, wind-resistant scarf in boiled loden wool, woven and fulled in the Black Forest. 180 x 30 cm.",
      ds: "Warmer, winddichter Schal aus gewalktem Loden, im Schwarzwald gewebt und gewalkt. 180 x 30 cm.",
    },
    {
      sku: "TANNENHONIG", motif: "jar", category: "Pantry", usd: 1800, stock: 64,
      t: { en: "Black Forest Fir Honey, 500 g", de: "Schwarzwälder Tannenhonig, 500 g" },
      d: "Dark, malty fir honey from beekeepers in the northern Black Forest. 500 g glass jar.",
      ds: "Dunkler, malziger Tannenhonig von Imkern aus dem Nordschwarzwald. 500-g-Glas.",
    },
    {
      sku: "ZIRBENKISSEN", motif: "box", category: "Home", usd: 4200, stock: 17,
      t: { en: "Swiss Pine Shavings Pillow", de: "Zirbenkissen mit Zirbenholzspänen" },
      d: "A small linen pillow filled with Swiss stone pine shavings. The resinous scent is said to calm a room. 30 x 20 cm.",
      ds: "Kleines Leinenkissen, gefüllt mit Zirbenholzspänen. Der harzige Duft beruhigt den Raum. 30 x 20 cm.",
    },
    {
      sku: "EMAILLE-BECHER", motif: "mug", category: "Kitchen", usd: 2100, stock: 0,
      t: { en: "Enamel Camp Mug", de: "Emaille-Becher" },
      d: "A hand-dipped enamel mug in forest green with a navy rim. Light, tough and made for the trail.",
      ds: "Handgetauchter Emaille-Becher in Waldgrün mit dunkelblauem Rand. Leicht, robust, für unterwegs.",
    },
  ],
  gb: [
    {
      sku: "TWEED-CAP", motif: "cap", category: "Accessories", usd: 5600, stock: 28, hero: true,
      t: { en: "Harris Tweed Flat Cap", de: "Schiebermütze aus Harris Tweed", fr: "Casquette plate en Harris Tweed", es: "Gorra plana de Harris Tweed", ja: "ハリスツイード ハンチング帽", hi: "हैरिस ट्वीड फ़्लैट कैप" },
      d: "A flat cap cut from authentic Harris tweed, lined in cotton. Made in small batches in Yorkshire.",
    },
    {
      sku: "EARL-GREY-TIN", motif: "box", category: "Pantry", usd: 1600, stock: 120, hero: true,
      t: { en: "Loose-Leaf Earl Grey Tea, 100 g Tin", de: "Earl Grey Blatttee, 100-g-Dose", fr: "Thé Earl Grey en vrac, boîte de 100 g", es: "Té Earl Grey a granel, lata de 100 g", ja: "アールグレイ リーフティー 100g缶", hi: "अर्ल ग्रे खुली पत्ती चाय, 100 ग्राम टिन" },
      d: "Ceylon black tea scented with cold-pressed bergamot oil, blended in London. 100 g reusable tin.",
    },
    {
      sku: "LAMBSWOOL-SCARF", motif: "textile", category: "Textiles", usd: 5200, stock: 19,
      t: { en: "Scottish Lambswool Check Scarf" },
      d: "A soft lambswool scarf in a muted heather check, woven in the Scottish Borders. 180 x 25 cm.",
    },
    {
      sku: "BRIDLE-CARD-WALLET", motif: "wallet", category: "Accessories", usd: 4800, stock: 36,
      t: { en: "Bridle Leather Card Wallet" },
      d: "A slim card wallet in English bridle leather, saddle-stitched by hand. Holds six cards.",
    },
    {
      sku: "WELSH-THROW", motif: "textile", category: "Home", usd: 14800, stock: 6,
      t: { en: "Welsh Wool Throw Blanket" },
      d: "A double-weave throw in pure new wool from a mill in mid-Wales. 130 x 180 cm.",
    },
  ],
  ca: [
    {
      sku: "MAPLE-SYRUP-SET", motif: "bottle", category: "Pantry", usd: 3400, stock: 75, hero: true,
      t: { en: "Maple Syrup Gift Set of 3", de: "Ahornsirup-Geschenkset, 3 Flaschen", fr: "Coffret de 3 sirops d'érable", es: "Set de regalo de 3 jarabes de arce", ja: "メープルシロップ 3本ギフトセット", hi: "मेपल सिरप गिफ़्ट सेट, 3 बोतलें" },
      d: "Three small bottles of Grade A maple syrup (golden, amber and dark) from a family sugar bush in Quebec.",
    },
    {
      sku: "MAPLE-BUTTER", motif: "jar", category: "Pantry", usd: 1500, stock: 90, hero: true,
      t: { en: "Whipped Maple Butter, 250 g", de: "Ahornbutter, 250 g", fr: "Beurre d'érable fouetté, 250 g", es: "Crema de arce batida, 250 g", ja: "ホイップ メープルバター 250g", hi: "व्हिप्ड मेपल बटर, 250 ग्राम" },
      d: "Pure maple syrup boiled and whipped until creamy. No dairy, nothing added. 250 g jar.",
    },
    {
      sku: "BLUEBERRY-JAM", motif: "jar", category: "Pantry", usd: 1200, stock: 54,
      t: { en: "Wild Blueberry Jam, 250 ml" },
      d: "Small-batch jam made from hand-raked wild blueberries from Nova Scotia. 250 ml jar.",
    },
    {
      sku: "CEDAR-CANDLE", motif: "candle", category: "Home", usd: 2800, stock: 33,
      t: { en: "Cedar and Woodsmoke Soy Candle" },
      d: "A soy wax candle scented with western red cedar and a hint of woodsmoke. Cotton wick, about 45 hours.",
    },
    {
      sku: "WOOL-MITTENS", motif: "textile", category: "Textiles", usd: 3900, stock: 12,
      t: { en: "Fleece-Lined Wool Mittens" },
      d: "Knitted wool mittens lined with soft fleece, made for prairie winters. One size fits most adults.",
    },
  ],
  au: [
    {
      sku: "KANGAROO-WALLET", motif: "wallet", category: "Accessories", usd: 4600, stock: 40, hero: true,
      t: { en: "Kangaroo Leather Bifold Wallet", de: "Klappbörse aus Känguruleder", fr: "Portefeuille en cuir de kangourou", es: "Cartera de piel de canguro", ja: "カンガルーレザー 二つ折り財布", hi: "कंगारू लेदर बाइफ़ोल्ड वॉलेट" },
      d: "A slim bifold wallet in soft kangaroo leather with six card slots and a coin pocket.",
    },
    {
      sku: "EUCALYPTUS-SOAP", motif: "soap", category: "Bath", usd: 1100, stock: 140, hero: true,
      t: { en: "Eucalyptus and Clay Soap Bar", de: "Seife mit Eukalyptus und Tonerde", fr: "Savon à l'eucalyptus et à l'argile", es: "Jabón de eucalipto y arcilla", ja: "ユーカリとクレイの石鹸", hi: "यूकेलिप्टस और क्ले साबुन" },
      d: "Cold-process soap with eucalyptus oil and pink Australian clay. 120 g bar, palm-oil free.",
    },
    {
      sku: "BUSH-HAT", motif: "cap", category: "Accessories", usd: 8900, stock: 14,
      t: { en: "Oiled Leather Bush Hat" },
      d: "A wide-brimmed bush hat in oiled leather with a plaited band. Water-resistant and packable.",
    },
    {
      sku: "MERINO-SOCKS", motif: "textile", category: "Textiles", usd: 2600, stock: 66,
      t: { en: "Merino Hiking Socks, 2 Pairs" },
      d: "Cushioned hiking socks knitted from Australian merino. Two pairs.",
    },
    {
      sku: "KEY-POUCH", motif: "wallet", category: "Accessories", usd: 2200, stock: 3,
      t: { en: "Leather Key Pouch" },
      d: "A small zipped pouch in vegetable-tanned leather for keys and coins.",
    },
  ],
  fr: [
    {
      sku: "SAVON-MARSEILLE", motif: "soap", category: "Bath", usd: 1400, stock: 150, hero: true,
      t: { fr: "Savons de Marseille artisanaux, lot de 3", en: "Artisan Marseille Soap, Set of 3", de: "Handgemachte Marseiller Seife, 3 Stück", es: "Jabón de Marsella artesanal, pack de 3", ja: "職人のマルセイユ石鹸 3個セット", hi: "हस्तनिर्मित मार्सेय साबुन, 3 का सेट" },
      d: "Three olive-oil Marseille soaps, cauldron-boiled and hand-cut in Provence. 3 x 100 g.",
      ds: "Trois savons de Marseille à l'huile d'olive, cuits au chaudron et coupés à la main en Provence. 3 x 100 g.",
    },
    {
      sku: "BOL-MOUSTIERS", motif: "bowl", category: "Kitchen", usd: 4400, stock: 21, hero: true,
      t: { fr: "Bol en faïence de Moustiers", en: "Moustiers Faience Bowl", de: "Fayence-Schale aus Moustiers", es: "Cuenco de loza de Moustiers", ja: "ムスティエ焼きのボウル", hi: "मुस्तिए फ़ायंस कटोरा" },
      d: "A hand-painted tin-glazed earthenware bowl from Moustiers-Sainte-Marie. 16 cm across.",
      ds: "Bol en faïence stannifère peint à la main à Moustiers-Sainte-Marie. 16 cm de diamètre.",
    },
    {
      sku: "MIEL-LAVANDE", motif: "jar", category: "Pantry", usd: 1700, stock: 48,
      t: { fr: "Miel de lavande de Haute-Provence, 250 g", en: "Provence Lavender Honey, 250 g" },
      d: "Pale, floral lavender honey from hives on the Valensole plateau. 250 g jar.",
      ds: "Miel de lavande clair et floral, récolté sur le plateau de Valensole. Pot de 250 g.",
    },
    {
      sku: "BOUGIE-FIGUIER", motif: "candle", category: "Home", usd: 3600, stock: 25,
      t: { fr: "Bougie parfumée au figuier", en: "Fig Tree Scented Candle" },
      d: "A vegetable-wax candle scented with fig leaf and green wood, poured in Grasse. About 40 hours.",
      ds: "Bougie en cire végétale parfumée à la feuille de figuier, coulée à Grasse. Environ 40 heures.",
    },
    {
      sku: "TORCHONS-LIN", motif: "textile", category: "Textiles", usd: 3000, stock: 0,
      t: { fr: "Torchons en lin lavé, lot de 2", en: "Washed Linen Tea Towels, Set of 2" },
      d: "Two stonewashed French linen tea towels with a red stripe. 50 x 70 cm.",
      ds: "Deux torchons en lin français lavé à la pierre, liseré rouge. 50 x 70 cm.",
    },
  ],
  es: [
    {
      sku: "AZULEJO-PLATO", motif: "plate", category: "Home", usd: 3600, stock: 18, hero: true,
      t: { es: "Plato de cerámica pintado a mano", en: "Hand-Painted Ceramic Plate", de: "Handbemalter Keramikteller", fr: "Assiette en céramique peinte à la main", ja: "手描きセラミックプレート", hi: "हाथ से रंगी सिरेमिक प्लेट" },
      d: "A decorative ceramic plate with Andalusian tile motifs, painted by hand in Seville. 25 cm across.",
      ds: "Plato decorativo de cerámica con motivos de azulejo andaluz, pintado a mano en Sevilla. 25 cm de diámetro.",
    },
    {
      sku: "CUENCO-TAPAS", motif: "bowl", category: "Kitchen", usd: 2600, stock: 44, hero: true,
      t: { es: "Juego de 4 cuencos de tapas", en: "Glazed Tapas Bowls, Set of 4", de: "Tapas-Schälchen, 4er-Set", fr: "Lot de 4 coupelles à tapas", ja: "タパス用ボウル 4個セット", hi: "तापस कटोरियाँ, 4 का सेट" },
      d: "Four small terracotta bowls glazed inside, for olives, almonds and tapas. 12 cm each.",
      ds: "Cuatro cuencos de barro vidriados por dentro, para aceitunas, almendras y tapas. 12 cm cada uno.",
    },
    {
      sku: "AZULEJOS-SET", motif: "tile", category: "Home", usd: 4800, stock: 15,
      t: { es: "Juego de 4 azulejos sevillanos", en: "Sevillian Tiles, Set of 4" },
      d: "Four hand-painted cuenca-seca tiles in cobalt and ochre. 15 x 15 cm each.",
      ds: "Cuatro azulejos de cuenca seca pintados a mano en cobalto y ocre. 15 x 15 cm cada uno.",
    },
    {
      sku: "ACEITERA", motif: "bottle", category: "Kitchen", usd: 3100, stock: 27,
      t: { es: "Aceitera de cerámica", en: "Ceramic Olive Oil Cruet" },
      d: "A glazed ceramic cruet with a drip-free spout. Holds 500 ml.",
      ds: "Aceitera de cerámica vidriada con pico antigoteo. Capacidad 500 ml.",
    },
    {
      sku: "TAZA-CAFE", motif: "mug", category: "Kitchen", usd: 1900, stock: 52,
      t: { es: "Taza de café de barro", en: "Terracotta Coffee Cup" },
      d: "A small terracotta cup for café solo or cortado, glazed in deep green. 150 ml.",
      ds: "Taza pequeña de barro para café solo o cortado, vidriada en verde intenso. 150 ml.",
    },
  ],
  it: [
    {
      sku: "OLIO-EVO-500", motif: "bottle", category: "Pantry", usd: 2400, stock: 70, hero: true,
      t: { it: "Olio extra vergine toscano, 500 ml", en: "Tuscan Extra Virgin Olive Oil, 500 ml", de: "Toskanisches Olivenöl extra vergine, 500 ml", fr: "Huile d'olive vierge extra de Toscane, 500 ml", es: "Aceite de oliva virgen extra toscano, 500 ml", ja: "トスカーナ産 エキストラバージンオリーブオイル 500ml", hi: "टस्कन एक्स्ट्रा वर्जिन ऑलिव ऑयल, 500 ml" },
      d: "Cold-pressed extra virgin olive oil from a family grove near Siena. Peppery and green. 500 ml bottle.",
      ds: "Olio extra vergine d'oliva spremuto a freddo da un uliveto di famiglia vicino a Siena. 500 ml.",
    },
    {
      sku: "ACETO-BALSAMICO", motif: "bottle", category: "Pantry", usd: 3200, stock: 38, hero: true,
      t: { it: "Aceto balsamico di Modena IGP, 250 ml", en: "Balsamic Vinegar of Modena, 250 ml", de: "Aceto Balsamico di Modena, 250 ml", fr: "Vinaigre balsamique de Modène, 250 ml", es: "Vinagre balsámico de Módena, 250 ml", ja: "モデナ産バルサミコ酢 250ml", hi: "मोडेना बाल्समिक सिरका, 250 ml" },
      d: "Barrel-aged balsamic vinegar of Modena PGI, thick and sweet. 250 ml bottle.",
      ds: "Aceto balsamico di Modena IGP invecchiato in botte, denso e dolce. Bottiglia da 250 ml.",
    },
    {
      sku: "CIOTOLA-ULIVO", motif: "bowl", category: "Kitchen", usd: 5200, stock: 11,
      t: { it: "Ciotola in legno d'ulivo", en: "Olive Wood Salad Bowl" },
      d: "A salad bowl turned from a single piece of Tuscan olive wood. Each grain pattern is unique. 24 cm.",
      ds: "Insalatiera tornita da un unico pezzo di legno d'ulivo toscano. Venature uniche. 24 cm.",
    },
    {
      sku: "SAPONE-OLIVA", motif: "soap", category: "Bath", usd: 1200, stock: 95,
      t: { it: "Sapone all'olio d'oliva", en: "Olive Oil Soap Bar" },
      d: "A gentle soap made with our own olive oil and a touch of rosemary. 150 g.",
      ds: "Sapone delicato con il nostro olio d'oliva e un tocco di rosmarino. 150 g.",
    },
    {
      sku: "QUADERNO-FIRENZE", motif: "notebook", category: "Stationery", usd: 2800, stock: 24,
      t: { it: "Quaderno in carta marmorizzata", en: "Florentine Marbled Paper Notebook" },
      d: "A hand-bound notebook covered in Florentine marbled paper. A5, 96 cream pages.",
      ds: "Quaderno rilegato a mano con copertina in carta marmorizzata fiorentina. A5, 96 pagine.",
    },
  ],
  mx: [
    {
      sku: "REBOZO-ALGODON", motif: "textile", category: "Textiles", usd: 5800, stock: 13, hero: true,
      t: { es: "Rebozo de algodón tejido a mano", en: "Hand-Woven Cotton Rebozo", de: "Handgewebter Rebozo aus Baumwolle", fr: "Rebozo en coton tissé main", ja: "手織りコットンのレボソ", hi: "हाथ से बुना सूती रेबोज़ो" },
      d: "A cotton rebozo woven on a pedal loom by artisans in Oaxaca. 2 metres long with hand-knotted fringe.",
      ds: "Rebozo de algodón tejido en telar de pedal por artesanos de Oaxaca. Mide 2 metros con rapacejo anudado a mano.",
    },
    {
      sku: "CHOCOLATE-MESA", motif: "box", category: "Pantry", usd: 1400, stock: 110, hero: true,
      t: { es: "Chocolate de mesa oaxaqueño", en: "Oaxacan Drinking Chocolate", de: "Trinkschokolade aus Oaxaca", fr: "Chocolat à boire de Oaxaca", ja: "オアハカのホットチョコレート", hi: "ओआहाका ड्रिंकिंग चॉकलेट" },
      d: "Stone-ground cacao with cinnamon and almond, made for frothing into hot chocolate. 400 g.",
      ds: "Cacao molido en metate con canela y almendra, para batir en chocolate caliente. 400 g.",
    },
    {
      sku: "BARRO-NEGRO", motif: "jar", category: "Home", usd: 4600, stock: 8,
      t: { es: "Jarrón de barro negro", en: "Black Clay Vase" },
      d: "A burnished black clay vase from San Bartolo Coyotepec, fired in an underground kiln. 22 cm tall.",
      ds: "Jarrón de barro negro bruñido de San Bartolo Coyotepec, cocido en horno de tierra. 22 cm de alto.",
    },
    {
      sku: "MOLINILLO", motif: "spoon", category: "Kitchen", usd: 1600, stock: 37,
      t: { es: "Molinillo de madera tallado", en: "Carved Wooden Chocolate Whisk" },
      d: "A hand-turned wooden molinillo for frothing chocolate, with loose carved rings.",
      ds: "Molinillo de madera torneado a mano para espumar chocolate, con anillos tallados sueltos.",
    },
    {
      sku: "BOLSA-PALMA", motif: "basket", category: "Accessories", usd: 3000, stock: 29,
      t: { es: "Bolsa de palma tejida", en: "Woven Palm Market Bag" },
      d: "A market bag woven from palm leaf by weavers in the Mixteca region, with leather handles.",
      ds: "Bolsa de mercado tejida en palma por artesanas de la Mixteca, con asas de piel.",
    },
  ],
  jp: [
    {
      sku: "TETSUBIN-S", motif: "teapot", category: "Kitchen", usd: 8900, stock: 10, hero: true,
      t: { ja: "南部鉄器の小さな急須", en: "Nanbu Cast Iron Teapot, Small", de: "Kleine Teekanne aus Nanbu-Gusseisen", fr: "Petite théière en fonte Nanbu", es: "Tetera pequeña de hierro fundido Nanbu", hi: "नानबू कास्ट आयरन छोटी चायदानी" },
      d: "A small cast iron teapot made by Nanbu tekki craftsmen in Iwate. About 400 ml, enamel-lined.",
      ds: "岩手県の職人が鋳造した南部鉄器の急須です。容量は約400ml、内側はホーロー仕上げです。",
    },
    {
      sku: "YUNOMI", motif: "mug", category: "Kitchen", usd: 2600, stock: 34, hero: true,
      t: { ja: "手びねりの湯呑み", en: "Hand-Built Yunomi Teacup", de: "Handgeformte Yunomi-Teeschale", fr: "Tasse à thé yunomi façonnée main", es: "Taza yunomi hecha a mano", hi: "हाथ से बना युनोमी चाय कप" },
      d: "A hand-built yunomi teacup from a Kyoto kiln, with an ash glaze that varies cup to cup.",
      ds: "京都の窯で手びねりで作った湯呑みです。灰釉の表情が一つずつ異なります。",
    },
    {
      sku: "FUROSHIKI", motif: "textile", category: "Textiles", usd: 2900, stock: 58,
      t: { ja: "綿の風呂敷 70cm", en: "Cotton Furoshiki Wrapping Cloth, 70 cm" },
      d: "A printed cotton furoshiki for wrapping gifts, bottles or a lunch box. 70 x 70 cm.",
      ds: "贈り物やボトル、お弁当を包める綿の風呂敷です。70×70cm。",
    },
    {
      sku: "CHASEN", motif: "spoon", category: "Kitchen", usd: 3400, stock: 20,
      t: { ja: "茶筅 百本立", en: "Bamboo Matcha Whisk (Chasen)" },
      d: "A 100-prong bamboo matcha whisk, hand-split in Takayama, Nara.",
      ds: "奈良・高山で一本ずつ手で割いた百本立の茶筅です。",
    },
    {
      sku: "UJI-MATCHA", motif: "jar", category: "Pantry", usd: 3000, stock: 0,
      t: { ja: "宇治抹茶 40g", en: "Uji Ceremonial Matcha, 40 g" },
      d: "Stone-milled ceremonial-grade matcha from Uji, Kyoto. 40 g tin.",
      ds: "京都・宇治の石臼挽き抹茶です。40g缶。",
    },
  ],
};

/** Art and catalogue facts for the legacy US/DE products created in seed.ts. */
export const LEGACY_PRODUCT_FACTS: Record<string, { motif: ArtMotif; category: string; stock: number }> = {
  "WALNUT-BOARD": { motif: "board", category: "Kitchen", stock: 14 },
  "MERINO-BEANIE": { motif: "cap", category: "Accessories", stock: 52 },
  "KUCKUCKSUHR-MINI": { motif: "clock", category: "Home", stock: 7 },
  "LEDER-A5": { motif: "notebook", category: "Stationery", stock: 30 },
};
