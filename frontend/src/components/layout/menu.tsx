import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { useLayout } from "@/hooks/use-layout";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { Link } from "@tanstack/react-router";
import { CollapseMenuButton } from "./collapse-menu-button";

interface MenuProps {
  isOpen: boolean | undefined;
  closeSheetMenu?: () => void;
}

export function Menu({ isOpen, closeSheetMenu }: MenuProps) {
  const { menuList } = useLayout();

  return (
    <ScrollArea className="flex-1 [&>div>div[style]]:block!">
      <nav className="flex h-full w-full flex-col">
        <ul className="flex flex-1 flex-col items-start space-y-1 px-2">
          {menuList.map(({ groupLabel, menus }, index) => (
            <li className={cn("w-full", groupLabel ? "pt-5" : "")} key={index}>
              {isOpen && groupLabel && (
                <p className="text-muted-foreground flex max-w-[248px] items-center gap-1 truncate px-4 pb-2 text-sm font-medium">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                  {groupLabel}
                </p>
              )}
              {menus.map(({ href, label, icon: Icon, active, submenus, disabled }, index) =>
                submenus.length === 0 ? (
                  <div className="w-full" key={index}>
                    <TooltipProvider>
                      <Tooltip delayDuration={100}>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            className={cn(
                              "pointer-events-auto! mb-1 h-11 w-full rounded-xl transition-colors",
                              isOpen ? "justify-start" : "justify-center",
                              active ? "bg-primary hover:bg-primary text-white hover:text-white" : "hover:bg-transparent hover:text-primary",
                            )}
                            disabled={disabled}
                            asChild
                          >
                            <Link to={href} disabled={disabled} onClick={() => closeSheetMenu?.()} aria-label={isOpen ? undefined : label}>
                              <span className={cn(isOpen && "mr-4")}>
                                <Icon size={18} />
                              </span>
                              {isOpen && <p className="max-w-[200px] truncate">{label}</p>}
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        {isOpen === false && <TooltipContent side="right">{label}</TooltipContent>}
                        {disabled && <TooltipContent side="right">Coming soon</TooltipContent>}
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                ) : (
                  <div className="w-full" key={index}>
                    <CollapseMenuButton icon={Icon} label={label} active={active} submenus={submenus} isOpen={isOpen} closeSheetMenu={closeSheetMenu} />
                  </div>
                ),
              )}
            </li>
          ))}
        </ul>
      </nav>
    </ScrollArea>
  );
}
