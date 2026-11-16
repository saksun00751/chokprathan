/** Back-office menu data. Plain module so the server can read it to filter by permission. */
import {
  Ban,
  Banknote,
  BarChart3,
  CalendarClock,
  ClipboardCheck,
  Gamepad2,
  Gauge,
  Gift,
  Images,
  Landmark,
  LayoutDashboard,
  Newspaper,
  Palette,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/domain/permissions";

type ItemKey =
  | "dashboard"
  | "reports"
  | "rounds"
  | "results"
  | "risk"
  | "lottos"
  | "games"
  | "members"
  | "blocklist"
  | "finance"
  | "banks"
  | "promotions"
  | "activities"
  | "banners"
  | "news"
  | "theme"
  | "settings"
  | "staff"
  | "audit"
  | "security";
export type Item = { href: string; key: ItemKey; icon: LucideIcon; need: Permission | null; badge?: "finance" | "results" };

/** The back-office menu; labels come from the admin dictionary. `need: null` items are open to every staff member. */
export const NAV_GROUPS: { key: "overview" | "lotto" | "members" | "marketing" | "system"; items: Item[] }[] = [
  {
    key: "overview",
    items: [
      { href: "/admin", key: "dashboard", icon: LayoutDashboard, need: "dashboard.view" },
      { href: "/admin/reports", key: "reports", icon: BarChart3, need: "reports.view" },
    ],
  },
  {
    key: "lotto",
    items: [
      { href: "/admin/rounds", key: "rounds", icon: CalendarClock, need: "rounds.view" },
      { href: "/admin/results", key: "results", icon: ClipboardCheck, need: "rounds.result", badge: "results" },
      { href: "/admin/risk", key: "risk", icon: Gauge, need: "risk.manage" },
      { href: "/admin/lottos", key: "lottos", icon: Ticket, need: "lottos.manage" },
      { href: "/admin/games", key: "games", icon: Gamepad2, need: "games.manage" },
    ],
  },
  {
    key: "members",
    items: [
      { href: "/admin/members", key: "members", icon: Users, need: "members.view" },
      { href: "/admin/blocklist", key: "blocklist", icon: Ban, need: "members.block" },
      { href: "/admin/finance", key: "finance", icon: Banknote, need: "finance.view", badge: "finance" },
      { href: "/admin/banks", key: "banks", icon: Landmark, need: "banks.view" },
    ],
  },
  {
    key: "marketing",
    items: [
      { href: "/admin/promotions", key: "promotions", icon: Gift, need: "promotions.manage" },
      { href: "/admin/activities", key: "activities", icon: Sparkles, need: "promotions.manage" },
      { href: "/admin/banners", key: "banners", icon: Images, need: "content.manage" },
      { href: "/admin/news", key: "news", icon: Newspaper, need: "content.manage" },
    ],
  },
  {
    key: "system",
    items: [
      { href: "/admin/theme", key: "theme", icon: Palette, need: "theme.manage" },
      { href: "/admin/settings", key: "settings", icon: Settings, need: "settings.manage" },
      { href: "/admin/staff", key: "staff", icon: UserCog, need: "staff.manage" },
      { href: "/admin/audit", key: "audit", icon: ScrollText, need: "audit.view" },
      { href: "/admin/security", key: "security", icon: ShieldCheck, need: null },
    ],
  },
];
