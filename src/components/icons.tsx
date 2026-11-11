/** Inline stroke icons (24px grid). Decorative: always paired with a visible text label. */

type P = { className?: string };
const base = (className?: string) => ({
  className: className ?? "h-[18px] w-[18px]",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const IconOverview = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
  </svg>
);
export const IconLedger = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M3 9h18M3 14h18M9 9v11" />
  </svg>
);
export const IconMessages = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 5h16v11H9l-5 4z" />
    <path d="M8 9.5h8M8 12.5h5" />
  </svg>
);
export const IconBox = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z" />
    <path d="M3 7.5 12 12l9-4.5M12 12v9" />
  </svg>
);
export const IconCoins = ({ className }: P) => (
  <svg {...base(className)}>
    <ellipse cx="9" cy="7" rx="6" ry="2.5" />
    <path d="M3 7v5c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7" />
    <path d="M9 17c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5v-5c0-1.4-2.7-2.5-6-2.5" />
  </svg>
);
export const IconCheck = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);
export const IconPulse = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M2 12h4l3-7 4 14 3-7h6" />
  </svg>
);
export const IconSpark = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
  </svg>
);
export const IconBag = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M5 8h14l-1 12H6z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);
export const IconReceipt = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
);
export const IconJournal = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M5 17a3 3 0 0 1 3-3h11M9 8h6" />
  </svg>
);
export const IconSun = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const IconMoon = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </svg>
);
export const IconMenu = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
);
export const IconClose = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
export const IconDownload = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
);
export const IconColumns = ({ className }: P) => (
  <svg {...base(className)}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    <path d="M9 4v16M15 4v16" />
  </svg>
);
export const IconSearch = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);
export const IconArrowUp = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const IconArrowDown = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);
export const IconSend = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M4 12 20 4l-6 16-3-7z" />
  </svg>
);
export const IconBack = ({ className }: P) => (
  <svg {...base(className)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconGlobe = ({ className }: P) => (
  <svg {...base(className)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" />
  </svg>
);
