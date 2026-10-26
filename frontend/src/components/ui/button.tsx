import { Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircleIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background hover:scale-[101%] transition-transform duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
        confirm: "bg-green-500 text-white hover:bg-green-600",
        blue: "bg-blue-500 text-primary-foreground hover:bg-blue-600",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg:not(.loading)]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg:not(.loading)]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg:not(.loading)]:px-4",
        icon: "size-9",
      },
      loading: {
        true: "text-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

function Button({
  className,
  variant,
  size,
  children,
  disabled,
  asChild = false,
  loading = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean }) {
  const Comp = asChild ? Slot.Slot : "button";

  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className, loading }))} disabled={disabled || loading} {...props}>
      {loading && (
        <LoaderCircleIcon
          className={cn(
            "text-muted absolute animate-spin",
            // Used for conditional styling when button is loading
            "loading",
          )}
        />
      )}
      <Slot.Slottable>{children}</Slot.Slottable>
    </Comp>
  );
}

export { Button, buttonVariants };
