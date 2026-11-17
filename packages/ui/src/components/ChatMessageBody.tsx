import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CaretDownIcon } from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/cn";

const MAX_COLLAPSED_HEIGHT = 320;

/** Relative send time ("2 min ago"); the full date is in the tooltip. */
export function ChatTimestamp({
  timestamp,
  className,
}: {
  timestamp?: string | null;
  className?: string;
}) {
  const { i18n } = useTranslation("tasks");
  const date = timestamp ? new Date(timestamp) : null;
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const seconds = date ? (date.getTime() - Date.now()) / 1000 : NaN;
  const unit =
    Math.abs(seconds) < 60
      ? "second"
      : Math.abs(seconds) < 3600
        ? "minute"
        : Math.abs(seconds) < 86400
          ? "hour"
          : "day";
  const divisor = { second: 1, minute: 60, hour: 3600, day: 86400 }[unit];
  if (!date || !Number.isFinite(seconds)) return null;
  return (
    <time
      dateTime={date.toISOString()}
      title={new Intl.DateTimeFormat(locale, {
        dateStyle: "full",
        timeStyle: "long",
      }).format(date)}
      className={cn("px-1 text-[11px] text-low", className)}
    >
      {new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(
        Math.round(seconds / divisor),
        unit,
      )}
    </time>
  );
}

export function ChatMessageBody({
  children,
  timestamp,
  timestampAlign = "end",
}: {
  children: ReactNode;
  /** Shown under the body on hover (inside a `group/msg`). */
  timestamp?: string | null;
  timestampAlign?: "start" | "end";
}) {
  const { t } = useTranslation("tasks");
  const bodyId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    // Observe the unrestricted body, not the clipped viewport, as tokens arrive.
    const measure = () =>
      setOverflows(
        element.getBoundingClientRect().height > MAX_COLLAPSED_HEIGHT,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);

  const collapsed = overflows && !expanded;
  return (
    <div className="min-w-0 max-w-full">
      <div
        id={bodyId}
        className={cn(
          "min-w-0 max-w-full overflow-x-auto rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current",
          collapsed &&
            "max-h-[320px] overflow-y-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]",
        )}
      >
        <div
          ref={contentRef}
          className="ship-message-body flow-root min-w-0 max-w-full font-ibm-plex-sans text-[14px] leading-[1.55] [overflow-wrap:anywhere] [&>div]:text-[length:inherit] [&_.wysiwyg]:text-[length:inherit] [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_table]:text-[length:inherit] [&_a]:text-inherit [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:text-inherit"
        >
          {children}
        </div>
      </div>
      {overflows && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 inline-flex min-h-8 items-center gap-1 rounded-sm text-[12px] font-medium text-current underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        >
          {expanded ? t("conversation.showLess") : t("conversation.showMore")}
          <CaretDownIcon
            aria-hidden="true"
            className={cn("size-icon-xs", expanded && "rotate-180")}
          />
        </button>
      )}
      {timestamp && (
        <div
          className={cn(
            "mt-1 flex opacity-0 transition-opacity group-hover/msg:opacity-100 motion-reduce:transition-none",
            timestampAlign === "end" ? "justify-end" : "justify-start",
          )}
        >
          <ChatTimestamp timestamp={timestamp} className="px-0" />
        </div>
      )}
    </div>
  );
}
