import { useEffect, useState } from "react";
import { ChevronDown, Dot, LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Link } from "@tanstack/react-router";
import { Submenu } from "@/lib/layout";

interface CollapseMenuButtonProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  submenus: Submenu[];
  isOpen: boolean | undefined;
  closeSheetMenu?: () => void;
}

// Matches the purple active / hover treatment of the flat menu items in menu.tsx so
// the Recommendations group looks native rather than the old grey "secondary" pill.
const triggerClasses = (active: boolean) =>
  cn(
    "pointer-events-auto! mb-1 h-11 w-full rounded-xl transition-colors",
    active ? "bg-primary text-white hover:bg-primary hover:text-white" : "hover:bg-transparent hover:text-primary",
  );

export function CollapseMenuButton({ icon: Icon, label, active, submenus, isOpen, closeSheetMenu }: CollapseMenuButtonProps) {
  const isSubmenuActive = submenus.some((submenu) => submenu.active);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(isSubmenuActive);
  // The desktop sidebar never remounts, so the initial value alone would leave the
  // group closed when the user navigates into one of its pages from page content.
  useEffect(() => {
    if (isSubmenuActive) setIsCollapsed(true);
  }, [isSubmenuActive]);

  return isOpen ? (
    <Collapsible open={isCollapsed} onOpenChange={setIsCollapsed} className="w-full">
      <CollapsibleTrigger className="mb-1 w-full" asChild>
        <Button type="button" variant="ghost" className={cn(triggerClasses(active), "justify-start")}>
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center">
              <span className="mr-4">
                <Icon size={18} />
              </span>
              <p className="max-w-[150px] truncate">{label}</p>
            </div>
            <ChevronDown size={18} className={cn("transition-transform duration-200", isCollapsed && "rotate-180")} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        {submenus.map(({ href, label, active }, index) => (
          <Button
            key={index}
            variant="ghost"
            className={cn(
              "mb-1 h-9 w-full justify-start rounded-xl pl-3 transition-colors",
              active ? "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary font-medium" : "text-muted-foreground hover:bg-transparent hover:text-primary",
            )}
            asChild
          >
            <Link to={href} onClick={() => closeSheetMenu?.()}>
              <span className="mr-2 ml-1">
                <Dot size={18} className={cn(active && "text-primary")} />
              </span>
              <p className="max-w-[170px] truncate">{label}</p>
            </Link>
          </Button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  ) : (
    <DropdownMenu>
      <TooltipProvider disableHoverableContent>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className={cn(triggerClasses(active), "justify-center")}>
                <Icon size={18} className="shrink-0" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right" align="start" alignOffset={2}>
            {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenuContent side="right" sideOffset={18} align="start" className="min-w-48 rounded-xl">
        <DropdownMenuLabel className="max-w-[190px] truncate">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {submenus.map(({ href, label, active }, index) => (
          <DropdownMenuItem
            key={index}
            asChild
            className={cn("cursor-pointer rounded-lg", active ? "bg-primary/15 text-primary focus:bg-primary/20 focus:text-primary font-medium" : "focus:text-primary")}
          >
            <Link to={href} onClick={() => closeSheetMenu?.()}>
              <p className="max-w-[180px] truncate">{label}</p>
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
