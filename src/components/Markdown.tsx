import type { Align, Block, Inline } from "@/lib/markdown";
import { parseMarkdown } from "@/lib/markdown";

/** Renders assistant text. Built from the parsed tree as React elements, so it can never inject markup. */

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return n.v;
          case "br":
            return <br key={i} />;
          case "strong":
            return (
              <strong key={i} className="font-semibold text-ink">
                <Inlines nodes={n.c} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inlines nodes={n.c} />
              </em>
            );
          case "code":
            return (
              <code key={i} className="rounded-[3px] bg-sheet px-1 py-0.5 font-mono text-[0.88em] text-ink">
                {n.v}
              </code>
            );
          case "link":
            return (
              <a key={i} href={n.href} target={n.href.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer" className="font-medium text-accent underline underline-offset-2 hover:brightness-90">
                <Inlines nodes={n.c} />
              </a>
            );
        }
      })}
    </>
  );
}

const ALIGN: Record<NonNullable<Align>, string> = { left: "text-left", right: "text-right", center: "text-center" };

function BlockView({ b }: { b: Block }) {
  switch (b.t) {
    case "p":
      return (
        <p className="mb-2 leading-relaxed last:mb-0">
          <Inlines nodes={b.c} />
        </p>
      );
    case "h": {
      const cls = b.level <= 2 ? "mt-3 mb-1.5 text-base font-semibold text-ink first:mt-0" : "mt-2 mb-1 font-semibold text-ink first:mt-0";
      return (
        <p role="heading" aria-level={b.level + 2} className={cls}>
          <Inlines nodes={b.c} />
        </p>
      );
    }
    case "ul":
    case "ol": {
      const Tag = b.t;
      return (
        <Tag className={`mb-2 space-y-1 pl-5 last:mb-0 ${b.t === "ul" ? "list-disc" : "list-decimal"} marker:text-ink-3`} start={b.t === "ol" ? b.start : undefined}>
          {b.items.map((it, i) => (
            <li key={i} className="leading-relaxed pl-0.5">
              <Inlines nodes={it} />
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre className="mb-2 overflow-x-auto rounded-md bg-sheet p-3 font-mono text-[0.85em] leading-relaxed text-ink last:mb-0">
          <code>{b.v}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="mb-2 border-l-[3px] border-rule-strong pl-3 text-ink-2 last:mb-0">
          {b.c.map((c, i) => (
            <BlockView key={i} b={c} />
          ))}
        </blockquote>
      );
    case "hr":
      return <hr className="my-3 border-rule" />;
    case "table":
      return (
        <div className="mb-2 overflow-x-auto rounded-md border border-rule bg-sheet last:mb-0">
          <table className="w-full border-collapse text-[0.9em]">
            <thead>
              <tr>
                {b.head.map((h, i) => (
                  <th key={i} scope="col" className={`border-b border-rule-strong bg-sheet-2 px-3 py-2 font-semibold whitespace-nowrap text-ink ${ALIGN[b.align[i] ?? "left"]}`}>
                    <Inlines nodes={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri} className="border-b border-rule last:border-b-0">
                  {r.map((c, ci) => (
                    <td key={ci} className={`px-3 py-2 align-top ${ALIGN[b.align[ci] ?? "left"]}`}>
                      <Inlines nodes={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function Markdown({ text, className = "" }: { text: string; className?: string }) {
  return (
    <div className={`break-words ${className}`}>
      {parseMarkdown(text).map((b, i) => (
        <BlockView key={i} b={b} />
      ))}
    </div>
  );
}
