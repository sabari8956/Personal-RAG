import { CSSProperties, ElementType, ReactNode } from "react";

type TextShimmerProps = {
  children: ReactNode;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
};

export function TextShimmer({
  children,
  as: Component = "p",
  className,
  duration = 2.2,
  spread = 2,
}: TextShimmerProps) {
  const contentLength =
    typeof children === "string" ? children.length : String(children ?? "").length;

  const style = {
    "--shimmer-duration": `${duration}s`,
    "--shimmer-spread": `${Math.max(contentLength * spread, 80)}px`,
  } as CSSProperties;

  return (
    <Component className={["text-shimmer", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </Component>
  );
}
