import { Children, ButtonHTMLAttributes } from "react";

import { cn } from "@/utils/cn";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "tertiary" | "playground" | "destructive";
  size?: "default" | "large";
  disabled?: boolean;
  loading?: boolean;
}

export default function Button({
  variant = "primary",
  size = "default",
  disabled,
  loading,
  ...attrs
}: Props) {
  const children = handleChildren(attrs.children);

  return (
    <button
      {...attrs}
      type={attrs.type ?? "button"}
      className={cn(
        attrs.className,
        "[&>span]:px-6 flex items-center justify-center button relative [&>*]:relative transition-all duration-300",
        "text-label-medium lg-max:[&_svg]:size-24",
        `button-${variant} group/button`,
        {
          "rounded-8 p-6 transform hover:scale-105 active:scale-[0.995]": size === "default",
          "rounded-10 p-8 gap-2 transform hover:scale-[1.02] active:scale-[0.995]": size === "large",

          "text-accent-white shadow-lg hover:shadow-xl": variant === "primary",
          "text-accent-black active:[scale:0.99] active:bg-black-alpha-7": [
            "secondary",
            "tertiary",
            "playground",
          ].includes(variant),
          "bg-black-alpha-4 hover:bg-black-alpha-6 hover:shadow-md": variant === "secondary",
          "hover:bg-black-alpha-4 hover:shadow-sm": variant === "tertiary",
          "opacity-70 cursor-not-allowed pointer-events-none transform-none": disabled || loading,
        },
        variant === "playground" && [
          "inside-border before:border-black-alpha-4",
          disabled
            ? "before:opacity-0 bg-black-alpha-4 text-black-alpha-24"
            : "hover:bg-black-alpha-4 hover:before:opacity-0 active:before:opacity-0",
        ],
      )}
      disabled={disabled || loading}
    >
      {variant === "primary" && (
        <div className="overlay button-background !absolute animate-glow-pulse" />
      )}
      
      {loading ? (
        <div className="flex items-center justify-center">
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading...
        </div>
      ) : (
        children
      )}
    </button>
  );
}

const handleChildren = (children: React.ReactNode) => {
  return Children.toArray(children).map((child) => {
    if (typeof child === "string") {
      return <span key={child}>{child}</span>;
    }

    return child;
  });
};
