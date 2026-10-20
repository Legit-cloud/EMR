import type { Icon } from "@phosphor-icons/react";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { type ButtonVariant, buttonClass } from "./button";

type Props = Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  icon?: Icon;
  children: ReactNode;
  className?: string;
};

/** A link that looks like a button of the same variant, for moving to another screen. */
export function LinkButton({
  variant = "primary",
  icon: Glyph,
  className,
  children,
  ...props
}: Props) {
  return (
    <Link className={buttonClass(variant, className)} {...props}>
      {Glyph && <Glyph aria-hidden size={variant === "ghost" ? 16 : 20} />}
      {children}
    </Link>
  );
}
