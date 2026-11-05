import Link from "next/link";
import { LogoutButton } from "./LogoutButton";

export function Nav({ links, who, children }: { links: { href: string; label: string }[]; who: string; children?: React.ReactNode }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <nav className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
        <span className="font-bold text-blue-700">GlobalCart</span>
        {links.map((l) => (
          <Link key={l.href} href={l.href} className="text-sm text-slate-700 hover:text-blue-700">
            {l.label}
          </Link>
        ))}
        <span className="ml-auto flex items-center gap-4">
          {children}
          <span className="text-sm text-slate-500">{who}</span>
          <LogoutButton />
        </span>
      </nav>
    </header>
  );
}
