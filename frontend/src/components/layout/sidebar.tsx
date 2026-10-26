import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useLayoutStore } from "@/stores/layout";
import { Link } from "@tanstack/react-router";
import { Menu } from "./menu";

import Logo from "@/assets/logo.svg";

interface SidebarToggleProps {
  isOpen: boolean | undefined;
  setIsOpen?: () => void;
}

function SidebarToggle({ isOpen, setIsOpen }: SidebarToggleProps) {
  return (
    <div className="invisible absolute top-[calc(16px+env(safe-area-inset-top))] -right-[14px] z-50 lg:visible">
      <Button onClick={() => setIsOpen?.()} className="bg-background h-8 w-8 rounded-full shadow-sm" variant="outline" size="icon" aria-label="Toggle sidebar">
        <ChevronLeft className={cn("h-4 w-4 transition-transform duration-700 ease-in-out", isOpen === false ? "rotate-180" : "rotate-0")} />
      </Button>
    </div>
  );
}

export function Sidebar() {
  const sidebar = useLayoutStore((state) => state.sidebar);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 h-screen -translate-x-full px-2 pt-[calc(0.5rem_+_env(safe-area-inset-top))] pb-[calc(0.5rem_+_env(safe-area-inset-bottom))] transition-[width] duration-300 ease-in-out lg:translate-x-0",
        sidebar?.isOpen === false ? "w-[90px]" : "w-72",
      )}
    >
      <SidebarToggle isOpen={sidebar.isOpen} setIsOpen={sidebar.setIsOpen} />
      <div className="glass relative flex h-full flex-col overflow-hidden rounded-2xl">
        <div className="flex flex-1 flex-col overflow-y-auto px-3 pt-4">
          <div className={cn("flex justify-center transition-transform duration-300 ease-in-out", sidebar?.isOpen === false ? "translate-x-1" : "translate-x-0")}>
            <Link to="/" className="group m-1 flex items-center gap-2" search={{ q: "" }}>
              <img src={Logo} className={cn("transition-transform duration-300 group-hover:scale-105", sidebar.isOpen ? "h-11" : "h-8")} alt="Bookracy" />
              {sidebar.isOpen && (
                <div className="ml-2 overflow-hidden text-ellipsis whitespace-nowrap">
                  <h3 className="text-secondary-foreground text-3xl font-semibold tracking-tight">Bookracy</h3>
                  <div className="text-muted-foreground text-xs">Why pay for knowledge?</div>
                </div>
              )}
            </Link>
          </div>
          <Menu isOpen={sidebar?.isOpen} />
        </div>
      </div>
    </aside>
  );
}
