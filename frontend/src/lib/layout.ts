import { FileRouteTypes } from "@/routeTree.gen";
import { LucideIcon, Library, BookMarked, Settings, Search, Wand2, Users, BookUp, Award } from "lucide-react";
import { RECOMMENDATION_LISTS } from "@/lib/recommendation-lists";

export type Submenu = {
  href: FileRouteTypes["fullPaths"];
  label: string;
  active: boolean;
};

type Menu = {
  href: FileRouteTypes["fullPaths"];
  label: string;
  active: boolean;
  icon: LucideIcon;
  submenus: Submenu[];
  disabled?: boolean;
};

type Group = {
  groupLabel: string;
  menus: Menu[];
};

export function getMenuList(pathname: FileRouteTypes["fullPaths"] | string): Group[] {
  return [
    {
      groupLabel: "General",
      menus: [
        {
          href: "/",
          label: "Search",
          // The root route id is normalised to "" (trailing slash stripped), so match both.
          active: pathname === "/" || pathname === "",
          icon: Search,
          submenus: [],
        },
        {
          href: "/library",
          label: "Library",
          active: pathname === "/library",
          icon: Library,
          submenus: [],
        },
        {
          href: "/nonfiction",
          label: "Nonfiction",
          active: pathname === "/nonfiction",
          icon: Award,
          submenus: [],
        },
        {
          // Collapsible dropdown of curated recommendation lists, driven by the shared
          // config so adding a list is a one-line entry there (+ a route file).
          href: "/recommendations/tgb",
          label: "Recommendations",
          active: pathname.startsWith("/recommendations"),
          icon: Wand2,
          submenus: RECOMMENDATION_LISTS.map((list) => ({
            href: list.href,
            label: list.label,
            active: pathname === list.href,
          })),
        },
      ],
    },
    {
      groupLabel: "Community",
      menus: [
        {
          href: "/community",
          label: "Community",
          active: pathname === "/community",
          icon: Users,
          submenus: [],
        },
        {
          href: "/upload",
          label: "Upload",
          active: pathname === "/upload",
          icon: BookUp,
          submenus: [],
        },
      ],
    },
    {
      groupLabel: "Personal",
      menus: [
        {
          href: "/lists",
          label: "Bookshelf",
          active: pathname === "/lists",
          icon: BookMarked,
          submenus: [],
        },
        {
          href: "/settings",
          label: "Settings",
          active: pathname === "/settings",
          icon: Settings,
          submenus: [],
        },
      ],
    },
  ];
}
