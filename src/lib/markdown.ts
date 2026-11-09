/**
 * A small, safe Markdown parser for assistant replies: paragraphs, headings,
 * bold, italic, inline code, code blocks, bullet and numbered lists, quotes,
 * links and GFM tables. It produces a tree, never HTML, so nothing the model
 * (or text it was shown) writes can inject markup. Unfinished syntax, such as
 * half of a table or an unclosed `**` while a reply is still streaming, stays
 * as plain text until it is complete.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "br" };

export type Align = "left" | "right" | "center" | null;

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: 1 | 2 | 3 | 4; c: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; start: number; items: Inline[][] }
  | { t: "code"; v: string }
  | { t: "quote"; c: Block[] }
  | { t: "table"; head: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { t: "hr" };

/** Only web, mail and in-app links are clickable; anything else (javascript:, data:) stays as text. */
export function isSafeHref(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href) || (href.startsWith("/") && !href.startsWith("//"));
}

const isWordChar = (c: string | undefined) => c !== undefined && /[\p{L}\p{N}]/u.test(c);

function closing(s: string, from: number, marker: string): number {
  const at = s.indexOf(marker, from);
  return at;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (ch === "`") {
      const end = closing(src, i + 1, "`");
      if (end > i + 1) {
        flush();
        out.push({ t: "code", v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (src.startsWith("**", i) || src.startsWith("__", i)) {
      const marker = src.slice(i, i + 2);
      const end = closing(src, i + 2, marker);
      if (end > i + 2 && !/\s/.test(src[i + 2]!) && !/\s/.test(src[end - 1]!)) {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if (ch === "[") {
      const m = /^\[([^\]\n]+)\]\(([^)\s]+)\)/.exec(src.slice(i));
      if (m && isSafeHref(m[2]!)) {
        flush();
        out.push({ t: "link", href: m[2]!, c: parseInline(m[1]!) });
        i += m[0].length;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== ch && src[i + 1] !== undefined && !/\s/.test(src[i + 1]!)) {
      // `_` only opens at a word boundary, so snake_case words are left alone.
      const opens = ch === "*" || !isWordChar(src[i - 1]);
      if (opens) {
        let end = i + 1;
        for (;;) {
          end = closing(src, end, ch);
          if (end === -1) break;
          const okClose = !/\s/.test(src[end - 1]!) && (ch === "*" || !isWordChar(src[end + 1])) && src[end + 1] !== ch;
          if (okClose && end > i + 1) break;
          end++;
        }
        if (end !== -1) {
          flush();
          out.push({ t: "em", c: parseInline(src.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const FENCE = /^\s*```/;
const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const HR = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const UL = /^(\s*)[-*+]\s+(.*)$/;
const OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
// Each cell needs at least one dash (GFM); it only counts as a separator under a line that contains a pipe.
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

/** A header line followed by a separator line with the same number of columns. */
const isTableStart = (header: string, sep: string) => header.includes("|") && TABLE_SEP.test(sep) && splitRow(sep).length === splitRow(header).length;

const startsBlock = (line: string, next: string | undefined) =>
  FENCE.test(line) || HEADING.test(line) || HR.test(line) || UL.test(line) || OL.test(line) || QUOTE.test(line) || (next !== undefined && isTableStart(line, next));

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i]!)) body.push(lines[i++]!);
      i++; // the closing fence, if any (a stream may end before it)
      blocks.push({ t: "code", v: body.join("\n") });
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1]!.length as 1 | 2 | 3 | 4, c: parseInline(h[2]!) });
      i++;
      continue;
    }
    if (HR.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableStart(line, lines[i + 1]!)) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && lines[i]!.includes("|")) {
        const cells = splitRow(lines[i++]!);
        // Rows are padded or trimmed to the header's width so the table stays rectangular.
        rows.push(head.map((_, k) => parseInline(cells[k] ?? "")));
      }
      blocks.push({ t: "table", head: head.map(parseInline), align: head.map((_, k) => align[k] ?? null), rows });
      continue;
    }
    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) body.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push({ t: "quote", c: parseMarkdown(body.join("\n")) });
      continue;
    }
    const ul = UL.exec(line);
    const ol = OL.exec(line);
    if (ul || ol) {
      const ordered = Boolean(ol);
      const items: Inline[][] = [];
      const start = ol ? Number(ol[2]) : 1;
      while (i < lines.length) {
        const cur = lines[i]!;
        const m = ordered ? OL.exec(cur) : UL.exec(cur);
        if (m) {
          items.push(parseInline(ordered ? m[3]! : m[2]!));
          i++;
        } else if (cur.trim() !== "" && /^\s{2,}\S/.test(cur) && items.length > 0 && !startsBlock(cur.trim(), lines[i + 1])) {
          // A wrapped line of the previous item.
          items[items.length - 1]!.push({ t: "br" }, ...parseInline(cur.trim()));
          i++;
        } else break;
      }
      blocks.push(ordered ? { t: "ol", start, items } : { t: "ul", items });
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== "" && !startsBlock(lines[i]!, lines[i + 1])) para.push(lines[i++]!);
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}
