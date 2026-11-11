import { describe, expect, it } from "vitest";
import { isSafeHref, parseInline, parseMarkdown, type Block, type Inline } from "@/lib/markdown";

const plain = (nodes: Inline[]): string =>
  nodes
    .map((n) => (n.t === "text" ? n.v : n.t === "code" ? n.v : n.t === "br" ? "\n" : plain(n.c)))
    .join("");

describe("parseMarkdown", () => {
  it("turns the Listing Agent's pricing reply into a table, bold text and a bullet list", () => {
    const reply = `Here's a quick check of the pricing for **Quaderno in carta marmorizzata**:

| Market | Suggested Price | Profit | Margin | Check |
|--------|----------------|--------|--------|-------|
| en‑US | $26.99 | $8.62 | 31.9 % | – |
| en‑AU | $37.99 | $11.53 | 30.4 % | – |

**What this means**

- All of your current prices are **above** the suggested prices.
- Each market already beats your target 30 %.`;
    const blocks = parseMarkdown(reply);
    expect(blocks.map((b) => b.t)).toEqual(["p", "table", "p", "ul"]);
    const table = blocks[1] as Extract<Block, { t: "table" }>;
    expect(table.head.map(plain)).toEqual(["Market", "Suggested Price", "Profit", "Margin", "Check"]);
    expect(table.rows).toHaveLength(2);
    expect(plain(table.rows[1]![1]!)).toBe("$37.99");
    expect((blocks[3] as Extract<Block, { t: "ul" }>).items).toHaveLength(2);
    expect(parseInline("**What this means**")[0]).toMatchObject({ t: "strong" });
  });

  it("keeps table columns aligned and pads short rows", () => {
    const [t] = parseMarkdown("| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 |");
    const table = t as Extract<Block, { t: "table" }>;
    expect(table.align).toEqual(["left", "center", "right"]);
    expect(table.rows[0]).toHaveLength(3);
    expect(plain(table.rows[0]![2]!)).toBe("");
  });

  it("leaves a table header as plain text until its separator line has arrived (streaming)", () => {
    expect(parseMarkdown("| Market | Price |").map((b) => b.t)).toEqual(["p"]);
    expect(parseMarkdown("| Market | Price |\n|---|---|").map((b) => b.t)).toEqual(["table"]);
  });

  it("does not turn a stray dash line under text with a pipe into a table", () => {
    expect(parseMarkdown("either a | b\n-").map((b) => b.t)).not.toContain("table");
    expect(parseMarkdown("| a | b |\n|---|").map((b) => b.t)).not.toContain("table");
  });

  it("parses headings, numbered lists with their start, quotes, rules and code fences", () => {
    const blocks = parseMarkdown("# Title\n\n3. three\n4. four\n\n> quoted\n\n---\n\n```\nconst a = 1;\n```");
    expect(blocks.map((b) => b.t)).toEqual(["h", "ol", "quote", "hr", "code"]);
    expect(blocks[1]).toMatchObject({ t: "ol", start: 3 });
    expect(blocks[4]).toMatchObject({ t: "code", v: "const a = 1;" });
  });

  it("keeps an unfinished code fence as code while the reply is still arriving", () => {
    expect(parseMarkdown("```\nline 1\nline 2")).toEqual([{ t: "code", v: "line 1\nline 2" }]);
  });

  it("keeps single line breaks inside a paragraph", () => {
    const [p] = parseMarkdown("first line\nsecond line") as Extract<Block, { t: "p" }>[];
    expect(p!.c.map((n) => n.t)).toEqual(["text", "br", "text"]);
  });
});

describe("parseInline", () => {
  it("handles bold, italic, code and links", () => {
    expect(parseInline("a **b** and *c* and `d` and [e](https://x.test)").map((n) => n.t)).toEqual(["text", "strong", "text", "em", "text", "code", "text", "link"]);
  });

  it("leaves unclosed markers as literal text (streaming)", () => {
    expect(plain(parseInline("price is **26.9"))).toBe("price is **26.9");
    expect(plain(parseInline("a `code"))).toBe("a `code");
  });

  it("does not treat snake_case or multiplication as emphasis", () => {
    expect(plain(parseInline("the order_id and SKU_CODE are 3 * 4"))).toBe("the order_id and SKU_CODE are 3 * 4");
    expect(parseInline("the order_id and SKU_CODE").every((n) => n.t === "text")).toBe(true);
  });
});

describe("safety", () => {
  it("only allows web, mail and in-app links", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@b.co")).toBe(true);
    expect(isSafeHref("/seller/abc/approvals")).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.test", "vbscript:x"]) expect(isSafeHref(bad)).toBe(false);
  });

  it("renders an unsafe link as plain text and never produces HTML", () => {
    const nodes = parseInline("[click](javascript:alert(1)) <img src=x onerror=alert(1)>");
    expect(nodes.some((n) => n.t === "link")).toBe(false);
    expect(plain(nodes)).toContain("<img src=x onerror=alert(1)>");
  });
});
