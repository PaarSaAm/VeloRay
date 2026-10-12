import { useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import { t, localeName, useLocale } from "@/lib/i18n";
import { smoothPath } from "@/lib/chart";

type Range = [number, number];
export function ChartRange({
  points,
  value,
  onChange,
}: {
  points: { at: string; bytes: number }[];
  value: Range;
  onChange: (value: Range) => void;
}) {
  useLocale();
  const track = useRef<HTMLDivElement>(null),
    drag = useRef<{ mode: 0 | 1 | "window"; x: number; value: Range } | null>(
      null,
    );
  const available = points.length > 1;
  const path = useMemo(() => {
    const samples = points.filter(
      (_, i) =>
        i % Math.max(1, Math.ceil(points.length / 240)) === 0 ||
        i === points.length - 1,
    );
    const max = Math.max(1, ...samples.map((p) => p.bytes));
    return smoothPath(
      samples.map((p, i) => ({
        x: (i / Math.max(1, samples.length - 1)) * 1000,
        y: 30 - (Math.max(0, p.bytes) / max) * 24,
      })),
    );
  }, [points]);
  const time = (percent: number) => {
    const first = new Date(points[0]?.at || 0).getTime(),
      last = new Date(points.at(-1)?.at || 0).getTime();
    return new Date(
      first + ((last - first) * percent) / 100,
    ).toLocaleTimeString(localeName(), { hour: "2-digit", minute: "2-digit" });
  };
  const adjust = (index: 0 | 1, percent: number): Range =>
    index === 0
      ? [Math.max(0, Math.min(percent, value[1] - 1)), value[1]]
      : [value[0], Math.min(100, Math.max(percent, value[0] + 1))];
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!available || event.button !== 0 || !track.current) return;
    const rect = track.current.getBoundingClientRect(),
      percent = Math.max(
        0,
        Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
      );
    const handle = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-handle]",
    )?.dataset.handle;
    const mode =
      handle === "0"
        ? 0
        : handle === "1"
          ? 1
          : percent >= value[0] && percent <= value[1]
            ? "window"
            : Math.abs(percent - value[0]) < Math.abs(percent - value[1])
              ? 0
              : 1;
    const next = mode !== "window" && !handle ? adjust(mode, percent) : value;
    drag.current = { mode, x: event.clientX, value: next };
    event.currentTarget.setPointerCapture(event.pointerId);
    onChange(next);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !track.current) return;
    const current = drag.current,
      delta =
        ((event.clientX - current.x) /
          track.current.getBoundingClientRect().width) *
        100;
    const [start, end] = current.value;
    if (current.mode === "window") {
      const offset = Math.max(-start, Math.min(100 - end, delta));
      onChange([start + offset, end + offset]);
    } else if (current.mode === 0)
      onChange([Math.max(0, Math.min(end - 1, start + delta)), end]);
    else onChange([start, Math.min(100, Math.max(start + 1, end + delta))]);
  };
  const key = (event: KeyboardEvent<HTMLButtonElement>, index: 0 | 1) => {
    if (
      ![
        "ArrowLeft",
        "ArrowRight",
        "ArrowDown",
        "ArrowUp",
        "PageDown",
        "PageUp",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const delta = ["ArrowLeft", "ArrowDown"].includes(event.key)
      ? -1
      : ["ArrowRight", "ArrowUp"].includes(event.key)
        ? 1
        : event.key === "PageDown"
          ? -10
          : 10;
    onChange(
      adjust(
        index,
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? 100
            : value[index] + delta,
      ),
    );
  };
  return (
    <div className="chart-window-control">
      <div
        ref={track}
        className="chart-window-track"
        dir="ltr"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <svg
          viewBox="0 0 1000 36"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d={path ? `${path} L 1000 36 L 0 36 Z` : ""}
            fill="currentColor"
            fillOpacity=".10"
          />
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          className="chart-window-selection"
          style={{ left: `${value[0]}%`, width: `${value[1] - value[0]}%` }}
        />
        {([0, 1] as const).map((index) => (
          <button
            key={index}
            type="button"
            data-handle={index}
            disabled={!available}
            role="slider"
            aria-label={index === 0 ? t("Chart start") : t("Chart end")}
            aria-orientation="horizontal"
            aria-valuemin={index === 0 ? 0 : Math.ceil(value[0] + 1)}
            aria-valuemax={index === 0 ? Math.floor(value[1] - 1) : 100}
            aria-valuenow={Math.round(value[index])}
            aria-valuetext={available ? time(value[index]) : "—"}
            className="chart-window-handle"
            style={{ left: `${value[index]}%` }}
            onKeyDown={(event) => key(event, index)}
          >
            <span />
            <span />
          </button>
        ))}
      </div>
      <div className="chart-window-caption">
        <span dir="ltr">
          {available ? `${time(value[0])} — ${time(value[1])}` : "—"}
        </span>
        <button
          type="button"
          disabled={!available || (value[0] === 0 && value[1] === 100)}
          onClick={() => onChange([0, 100])}
        >
          <RotateCcw size={12} />
          {t("Full range")}
        </button>
      </div>
    </div>
  );
}
