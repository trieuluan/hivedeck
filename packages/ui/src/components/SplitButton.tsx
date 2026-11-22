import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { CaretDownIcon, CheckIcon, type Icon } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./Dropdown";

export interface SplitButtonOption<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
}

interface SplitButtonProps<T extends string = string> {
  options: SplitButtonOption<T>[];
  selectedValue: T;
  onSelectionChange: (value: T) => void;
  onAction: (value: T) => void;
  className?: string;
}

export function SplitButton<T extends string>({
  options,
  selectedValue,
  onSelectionChange,
  onAction,
  className,
}: SplitButtonProps<T>) {
  const selectedOption = options.find((opt) => opt.value === selectedValue);
  const label = selectedOption?.label ?? "";

  return (
    <div className={cn("flex w-full", className)}>
      <div className="flex w-full items-stretch">
        {/* Primary CTA button */}
        <button
          type="button"
          onClick={() => onAction(selectedValue)}
          className={cn(
            "inline-flex h-8 flex-1 items-center justify-center truncate whitespace-nowrap rounded-l border border-border bg-panel px-2",
            "text-xs font-medium text-normal transition-colors hover:bg-tertiary hover:text-high",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-brand focus-visible:ring-inset",
          )}
        >
          {label}
        </button>

        {/* Dropdown trigger */}
        <DropdownMenu>
          <DropdownMenuPrimitive.Trigger
            className={cn(
              "inline-flex h-8 items-center justify-center rounded-r border border-l-0 border-border bg-panel px-1.5",
              "text-low transition-colors hover:bg-tertiary hover:text-high",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-brand focus-visible:ring-inset",
            )}
          >
            <CaretDownIcon className="size-3" weight="bold" />
          </DropdownMenuPrimitive.Trigger>
          <DropdownMenuContent align="end">
            {options.map((option) => (
              <DropdownMenuItem
                disabled={option.value === selectedValue}
                key={option.value}
                onClick={() => onSelectionChange(option.value)}
                icon={option.value === selectedValue ? CheckIcon : option.icon}
              >
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
