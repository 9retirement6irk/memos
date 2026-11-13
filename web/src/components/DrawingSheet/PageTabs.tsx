import { Toggle, ToggleGroup } from "@usememos/ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import { FloatingBar } from "./DrawingFrame";

/**
 * The pages of a memo's drawings, numbered in the memo's order, as one choice among peers on a
 * floating bar. `children` follow the numbers on the same bar (the sheet's Add page).
 */
export const PageTabs = ({
  keys,
  active,
  onSelect,
  size,
  disabled,
  className,
  children,
}: {
  keys: readonly string[];
  active: string;
  onSelect: (key: string) => void;
  size?: "sm";
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) => {
  const t = useTranslate();
  return (
    <FloatingBar className={cn("max-w-full", className)}>
      <ToggleGroup
        aria-label={t("editor.drawing.pages")}
        size={size}
        className="min-w-0 overflow-x-auto"
        value={[active]}
        disabled={disabled}
        onValueChange={([next]) => next && onSelect(next)}
      >
        {keys.map((key, index) => (
          <Toggle key={key} value={key} aria-label={t("editor.drawing.page", { number: index + 1 })}>
            {index + 1}
          </Toggle>
        ))}
      </ToggleGroup>
      {children}
    </FloatingBar>
  );
};
