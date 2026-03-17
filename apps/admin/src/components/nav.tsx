"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "Pipeline" },
  { href: "/markets", label: "Markets" },
  { href: "/discovery", label: "Discovery" },
  { href: "/approvals", label: "Approvals" },
  { href: "/outreach", label: "Outreach" },
  { href: "/suppression", label: "Suppression" },
  { href: "/analytics", label: "Analytics" },
  { href: "/checkout", label: "Checkout" },
  { href: "/queues", label: "Queues" },
] as const;

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <h1 className="text-lg font-semibold text-gray-900">SiteForge</h1>
        <p className="text-xs text-gray-500">Admin Dashboard</p>
      </div>
      <ul className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map(({ href, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                className={`block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-gray-100 text-gray-900"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-gray-200 p-3">
        <button
          onClick={handleLogout}
          className="block w-full rounded-md px-3 py-2 text-left text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
