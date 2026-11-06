/**
 * Generated product illustrations: a flat object silhouette on a tinted
 * ground with a postal cancellation mark carrying the origin country code.
 * Pure and deterministic, so the seed can point image_url at /api/art and the
 * picture never depends on a remote host.
 */

export const ART_MOTIFS = [
  "board",
  "cap",
  "clock",
  "notebook",
  "bottle",
  "jar",
  "bowl",
  "mug",
  "bag",
  "textile",
  "soap",
  "candle",
  "spoon",
  "box",
  "plate",
  "teapot",
  "wallet",
  "basket",
  "tile",
] as const;
export type ArtMotif = (typeof ART_MOTIFS)[number];

/** Ground / ink pairs. Inks reach at least 4.5:1 on their ground. */
const TONES = [
  { ground: "#F2E6C6", ink: "#5E440A" }, // deep gold
  { ground: "#F1E6C8", ink: "#6E5414" }, // gold leaf
  { ground: "#EFDCE6", ink: "#5A2440" }, // plum glaze
  { ground: "#E4DFDB", ink: "#2A2220" }, // lacquer black
  { ground: "#DFE3EC", ink: "#2B3A5C" }, // indigo slate
  { ground: "#F2E2D3", ink: "#7A3B12" }, // persimmon
] as const;
export const ART_TONE_COUNT = TONES.length;

function shape(motif: ArtMotif, ink: string, ground: string): string {
  const s = `fill="${ink}"`;
  const soft = `fill="${ink}" fill-opacity="0.22"`;
  const line = `fill="none" stroke="${ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"`;
  switch (motif) {
    case "board":
      return `<rect x="52" y="104" width="128" height="72" rx="14" ${s}/><rect x="176" y="128" width="30" height="24" rx="10" ${s}/><circle cx="194" cy="140" r="5" fill="${ground}"/><path d="M70 124h70M70 140h88M70 156h56" stroke="${ground}" stroke-opacity="0.35" stroke-width="4" stroke-linecap="round"/>`;
    case "cap":
      return `<path d="M60 150c0-38 26-62 60-62s60 24 60 62z" ${s}/><path d="M48 150h144c0 12-10 18-22 18H70c-12 0-22-6-22-18z" ${soft}/><circle cx="120" cy="86" r="8" ${s}/>`;
    case "clock":
      return `<path d="M120 60l58 44v88H62v-88z" ${s}/><circle cx="120" cy="138" r="26" fill="${ground}"/><path d="M120 138v-16M120 138l12 8" ${line}/><path d="M104 192v22M136 192v22" ${line}/>`;
    case "notebook":
      return `<rect x="72" y="70" width="100" height="128" rx="6" ${s}/><rect x="72" y="70" width="18" height="128" ${soft}/><path d="M104 104h52M104 122h40" stroke="${ground}" stroke-width="5" stroke-linecap="round"/><path d="M160 70v64l-8-8-8 8V70" fill="${ground}" fill-opacity="0.8"/>`;
    case "bottle":
      return `<rect x="108" y="56" width="24" height="26" rx="4" ${s}/><path d="M104 82h32v18c16 8 22 20 22 36v64H82v-64c0-16 6-28 22-36z" ${s}/><rect x="90" y="140" width="60" height="38" rx="4" fill="${ground}" fill-opacity="0.85"/>`;
    case "jar":
      return `<rect x="84" y="74" width="72" height="20" rx="6" ${s}/><path d="M78 98h84v84c0 10-8 18-18 18H96c-10 0-18-8-18-18z" ${s}/><rect x="92" y="126" width="56" height="40" rx="4" fill="${ground}" fill-opacity="0.85"/>`;
    case "bowl":
      return `<path d="M50 120h140c0 40-30 66-70 66s-70-26-70-66z" ${s}/><path d="M64 120c10-14 32-22 56-22s46 8 56 22" ${soft}/><rect x="96" y="184" width="48" height="10" rx="5" ${s}/>`;
    case "mug":
      return `<path d="M70 84h88v88c0 14-12 26-26 26H96c-14 0-26-12-26-26z" ${s}/><path d="M158 104h10c14 0 22 10 22 24s-8 24-22 24h-10" ${line}/><path d="M92 70c0-10 8-10 8-20M116 70c0-10 8-10 8-20" ${line} stroke-opacity="0.45"/>`;
    case "bag":
      return `<path d="M64 100h112l-10 100H74z" ${s}/><path d="M92 100V86c0-16 12-28 28-28s28 12 28 28v14" ${line}/><rect x="98" y="132" width="44" height="28" rx="3" fill="${ground}" fill-opacity="0.8"/>`;
    case "textile":
      return `<path d="M58 78h124v100c-20 10-42 10-62 0s-42-10-62 0z" ${s}/><path d="M58 104h124M58 128h124M58 152h124" stroke="${ground}" stroke-opacity="0.5" stroke-width="5"/><path d="M78 178v18M98 182v18M142 182v18M162 178v18" ${line}/>`;
    case "soap":
      return `<rect x="60" y="112" width="120" height="66" rx="22" ${s}/><rect x="78" y="128" width="84" height="34" rx="12" fill="${ground}" fill-opacity="0.35"/><circle cx="92" cy="94" r="10" ${soft}/><circle cx="114" cy="80" r="7" ${soft}/><circle cx="140" cy="92" r="12" ${soft}/>`;
    case "candle":
      return `<rect x="88" y="98" width="24" height="100" rx="4" ${s}/><rect x="128" y="112" width="24" height="86" rx="4" ${s}/><path d="M100 96c-10-12 0-24 0-30 8 10 12 18 0 30zM140 110c-10-12 0-24 0-30 8 10 12 18 0 30z" ${soft}/><rect x="76" y="194" width="88" height="8" rx="4" ${s}/>`;
    case "spoon":
      return `<ellipse cx="96" cy="88" rx="20" ry="28" ${s}/><rect x="91" y="112" width="10" height="92" rx="5" ${s}/><ellipse cx="146" cy="96" rx="16" ry="24" ${soft}/><rect x="141" y="116" width="10" height="88" rx="5" ${s}/>`;
    case "box":
      return `<path d="M60 104l60-26 60 26v74l-60 26-60-26z" ${s}/><path d="M60 104l60 26 60-26M120 130v74" stroke="${ground}" stroke-opacity="0.6" stroke-width="5" fill="none"/>`;
    case "plate":
      return `<circle cx="120" cy="134" r="68" ${s}/><circle cx="120" cy="134" r="46" fill="${ground}" fill-opacity="0.85"/><circle cx="120" cy="134" r="22" ${soft}/><path d="M120 92v84M78 134h84" stroke="${ink}" stroke-opacity="0.35" stroke-width="4"/>`;
    case "teapot":
      return `<path d="M72 118c0-22 22-36 48-36s48 14 48 36v44c0 18-14 30-32 30h-32c-18 0-32-12-32-30z" ${s}/><path d="M168 126l26-14-6 34-20 10" ${s}/><path d="M72 128c-18 0-24 14-24 24s10 20 24 20" ${line}/><path d="M96 82c0-18 48-18 48 0" ${line}/>`;
    case "wallet":
      return `<rect x="56" y="92" width="128" height="88" rx="10" ${s}/><path d="M140 118h44v36h-44c-10 0-18-8-18-18s8-18 18-18z" fill="${ground}" fill-opacity="0.35"/><circle cx="144" cy="136" r="6" fill="${ground}"/>`;
    case "basket":
      return `<path d="M56 114h128l-14 80H70z" ${s}/><path d="M74 132h92M78 154h84M82 176h76" stroke="${ground}" stroke-opacity="0.45" stroke-width="5"/><path d="M84 114c0-30 72-30 72 0" ${line}/>`;
    case "tile":
      return `<rect x="62" y="76" width="56" height="56" ${s}/><rect x="122" y="76" width="56" height="56" ${soft}/><rect x="62" y="136" width="56" height="56" ${soft}/><rect x="122" y="136" width="56" height="56" ${s}/><circle cx="90" cy="104" r="14" fill="${ground}" fill-opacity="0.7"/><circle cx="150" cy="164" r="14" fill="${ground}" fill-opacity="0.7"/>`;
  }
}

export function isArtMotif(v: string): v is ArtMotif {
  return (ART_MOTIFS as readonly string[]).includes(v);
}

/** A complete SVG document. `cc` must be two uppercase letters (validated by the caller). */
export function productArtSvg(input: { motif: ArtMotif; tone: number; cc: string }): string {
  const tone = TONES[((input.tone % TONES.length) + TONES.length) % TONES.length]!;
  const cc = /^[A-Z]{2}$/.test(input.cc) ? input.cc : "XX";
  const { ground, ink } = tone;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240" role="img" aria-label="${input.motif}">`,
    `<rect width="240" height="240" fill="${ground}"/>`,
    // perforated edge along the bottom, like a stamp
    `<path d="M0 226h240" stroke="${ink}" stroke-opacity="0.25" stroke-width="2" stroke-dasharray="2 6"/>`,
    shape(input.motif, ink, ground),
    // cancellation mark
    `<g transform="translate(186 50) rotate(-14)" fill="none" stroke="${ink}" stroke-opacity="0.55" stroke-width="2.5">`,
    `<circle r="26"/><circle r="19" stroke-width="1.5"/>`,
    `<path d="M30 -8c10 -6 20 6 30 0s20 6 30 0M30 4c10 -6 20 6 30 0s20 6 30 0M30 16c10 -6 20 6 30 0s20 6 30 0"/>`,
    `</g>`,
    `<text x="186" y="56" transform="rotate(-14 186 50)" text-anchor="middle" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="${ink}" fill-opacity="0.75">${cc}</text>`,
    `</svg>`,
  ].join("");
}

/** Relative URL served by GET /api/art. */
export function productArtUrl(motif: ArtMotif, tone: number, cc: string): string {
  return `/api/art?motif=${motif}&tone=${tone}&cc=${cc}`;
}
