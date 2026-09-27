import { Pin, Minimize2, Circle, RectangleHorizontal, Minus } from "lucide-react";
import type { ServerStatsRange, ServerStatsSnapshot } from "@zcode/shared";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Button } from "@/components/ui/button.js";
import { bytes, rate, percent, usage, tone, duration, chartPaths } from "./model.js";

export type StatsShape = "ball" | "capsule" | "mini";
interface Props {
  compact: boolean;
  snapshot: ServerStatsSnapshot;
  online: boolean;
  latency: number | null;
  now: number;
  range: ServerStatsRange;
  onRange: (range: ServerStatsRange) => void;
  shape: StatsShape;
  onShape: (shape: StatsShape) => void;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
}
const sectionClass = "space-y-2 border-b border-border px-4 py-3";
const detailClass = "font-mono text-ui-xs text-foreground-subtle leading-relaxed";
function Bar({ value }: { value: number | null }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-hover">
      <div
        className={`h-full rounded-full bg-current ${tone(value)}`}
        style={{ width: `${value ?? 0}%` }}
      />
    </div>
  );
}
export function StatsPanel({
  compact,
  snapshot,
  online,
  latency,
  now,
  range,
  onRange,
  shape,
  onShape,
  pinned,
  onPin,
  onClose,
}: Props) {
  const { intl } = useZCodeIntl();
  const text = (key: string, values?: Record<string, string | number>) =>
    intl.formatMessage({ id: `serverStats.${key}` }, values);
  const p = snapshot.latest;
  const points = snapshot.range === range ? snapshot.points : [];
  const cpu = p?.cpuPercent ?? null;
  const mem = usage(p?.memUsedBytes, p?.memTotalBytes);
  const disk = usage(p?.diskUsedBytes, p?.diskTotalBytes);
  const end = p?.t ?? now;
  const maxRx = Math.max(0, ...points.map((v) => v.rxPeak ?? 0));
  const maxTx = Math.max(0, ...points.map((v) => v.txPeak ?? 0));
  const netMax = Math.max(1, maxRx, maxTx);
  const cpuPaths = chartPaths(points, "cpuPercent", range, end, 100, 50, 48);
  const downPaths = chartPaths(points, "rxBytesPerSec", range, end, netMax, 32, 29);
  const upPaths = chartPaths(points, "txBytesPerSec", range, end, netMax, 34, -29);
  const stale = Math.max(0, Math.floor((now - end) / 1000));
  return (
    <>
      <header
        className={`flex items-center gap-2 border-b border-border ${compact ? "sticky top-0 z-10 bg-popover px-3 py-2" : "px-4 py-3"}`}
      >
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${online ? "bg-success" : "bg-foreground-subtlest"}`}
        />
        <div className="min-w-0 flex-1">
          <h2
            id="server-stats-title"
            className="truncate font-mono text-ui-caption font-semibold"
            title={snapshot.host.name}
          >
            {snapshot.host.name}
          </h2>
          <p className="text-ui-xs text-foreground-subtle">
            {online ? text("online") : text("offline", { seconds: stale })} ·{" "}
            {latency == null ? "—" : `${latency} ms HTTP`}
          </p>
          <p className={compact ? "hidden" : detailClass}>
            {snapshot.host.cores}C / {bytes(p?.memTotalBytes)} · {text("uptime")}{" "}
            {duration(p?.uptimeSec ?? 0)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={text("pin")}
          aria-pressed={pinned}
          onClick={onPin}
        >
          <Pin className={pinned ? "fill-current" : ""} />
        </Button>
        <Button variant="ghost" size="icon" aria-label={text("collapse")} onClick={onClose}>
          <Minimize2 />
        </Button>
      </header>
      {compact ? (
        <div
          className="space-y-2 border-b border-border px-3 py-2"
          data-testid="server-stats-summary"
        >
          {[
            { label: "CPU", value: cpu, detail: null },
            {
              label: text("memory"),
              value: mem,
              detail: `${bytes(p?.memUsedBytes)} / ${bytes(p?.memTotalBytes)}`,
            },
            {
              label: `${text("disk")} /`,
              value: disk,
              detail: `${bytes(p?.diskUsedBytes)} / ${bytes(p?.diskTotalBytes)}`,
            },
          ].map(({ label, value, detail }) => (
            <div
              key={label}
              className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 text-ui-sm"
            >
              <span className="text-foreground-subtle">{label}</span>
              <span className="flex flex-wrap items-baseline justify-end gap-x-2 font-mono">
                {detail ? (
                  <span className="text-ui-xs text-foreground-subtle">{detail}</span>
                ) : null}
                <span className={`font-semibold ${tone(value)}`}>{percent(value)}</span>
              </span>
            </div>
          ))}
          <div className="flex flex-wrap items-baseline justify-between gap-1 font-mono text-ui-sm">
            <span className="text-usage-chart-1">↓ {rate(p?.rxBytesPerSec)}</span>
            <span className="text-usage-chart-5">↑ {rate(p?.txBytesPerSec)}</span>
          </div>
        </div>
      ) : (
        <>
          <section className={sectionClass}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-ui-sm text-foreground-subtle">CPU</h3>
              <span className={`font-mono text-ui-xl font-semibold ${tone(cpu)}`}>
                {percent(cpu)}
              </span>
            </div>
            <svg
              className="h-14 w-full text-foreground"
              viewBox="0 0 300 54"
              preserveAspectRatio="none"
              role="img"
              aria-label={text("cpuChart")}
            >
              <path
                d="M0 26H300 M0 51H300"
                className="stroke-border"
                strokeDasharray="2 4"
                fill="none"
              />
              {cpuPaths.map((path, i) => (
                <g key={i}>
                  <path d={path.area} fill="currentColor" opacity=".08" />
                  <path
                    d={path.line}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                  <circle cx={path.last.x} cy={path.last.y} r="1.8" fill="currentColor" />
                </g>
              ))}
            </svg>
            <p className={detailClass}>
              {text("load")}{" "}
              {p ? [p.loadAvg1, p.loadAvg5, p.loadAvg15].map((v) => v.toFixed(2)).join(" · ") : "—"}
              　{text("peak")}{" "}
              {points.length ? percent(Math.max(...points.map((v) => v.cpuPeak ?? 0))) : "—"}
            </p>
          </section>
          <section className={sectionClass}>
            <div className="flex items-baseline justify-between">
              <h3 className="text-ui-sm text-foreground-subtle">{text("memory")}</h3>
              <span className={`font-mono text-ui-xl font-semibold ${tone(mem)}`}>
                {percent(mem)}
              </span>
            </div>
            <Bar value={mem} />
            <p className={detailClass}>
              {text("used")} {bytes(p?.memUsedBytes)} / {bytes(p?.memTotalBytes)}
            </p>
            <p className={detailClass}>
              {text("cache")} {bytes(p?.memCachedBytes)} · Swap {bytes(p?.swapUsedBytes)} /{" "}
              {bytes(p?.swapTotalBytes)}
              <br />
              {text("process")} {bytes(p?.rssBytes)}
            </p>
          </section>
          <section className={sectionClass}>
            <h3 className="text-ui-sm text-foreground-subtle">{text("network")}</h3>
            <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-ui-caption">
              <span className="text-usage-chart-1">↓ {rate(p?.rxBytesPerSec)}</span>
              <span className="text-usage-chart-5">↑ {rate(p?.txBytesPerSec)}</span>
            </div>
            <svg
              className="h-16 w-full"
              viewBox="0 0 300 66"
              preserveAspectRatio="none"
              role="img"
              aria-label={text("networkChart")}
            >
              {[
                [downPaths, "text-usage-chart-1"],
                [upPaths, "text-usage-chart-5"],
              ].map(([paths, color], index) => (
                <g key={index} className={color as string}>
                  {(paths as typeof downPaths).map((path, i) => (
                    <g key={i}>
                      <path d={path.area} fill="currentColor" opacity=".12" />
                      <path
                        d={path.line}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        vectorEffect="non-scaling-stroke"
                      />
                    </g>
                  ))}
                </g>
              ))}
              <path d="M0 33H300" className="stroke-border" />
            </svg>
            <p className={detailClass}>
              {text("peak")} ↓{rate(maxRx)} ↑{rate(maxTx)}
              <br />
              {text("today")} ↓{bytes(snapshot.traffic.rxBytes)} ↑{bytes(snapshot.traffic.txBytes)}
            </p>
            <p className="text-ui-xs text-foreground-subtlest">
              {text("trafficSince", {
                time: snapshot.traffic.since
                  ? new Date(snapshot.traffic.since).toISOString().slice(11, 19)
                  : "—",
              })}
            </p>
          </section>
          <section className={sectionClass}>
            <div className="flex justify-between text-ui-sm">
              <h3 className="text-foreground-subtle">{text("disk")} /</h3>
              <span className={`font-mono font-semibold ${tone(disk)}`}>{percent(disk)}</span>
            </div>
            <Bar value={disk} />
            <p className={detailClass}>
              {bytes(p?.diskUsedBytes)} / {bytes(p?.diskTotalBytes)}
              <br />
              {text("hostIo")} ↓{rate(p?.diskReadBytesPerSec)} ↑{rate(p?.diskWriteBytesPerSec)}
            </p>
          </section>
        </>
      )}
      <footer className={compact ? "px-3 py-1" : "space-y-2 px-3 py-3"}>
        {!compact ? (
          <div className="flex items-center justify-between gap-2">
            <div
              className="flex gap-0.5 rounded-lg bg-hover p-0.5"
              role="group"
              aria-label={text("range")}
            >
              {(["1m", "15m", "24h"] as const).map((r) => (
                <Button
                  key={r}
                  variant="ghost"
                  size="sm"
                  className={`text-ui-xs ${range === r ? "bg-popover shadow-sm" : "text-foreground-subtle"}`}
                  aria-pressed={range === r}
                  onClick={() => onRange(r)}
                >
                  {text(r)}
                </Button>
              ))}
            </div>
            <span className="text-ui-xs text-foreground-subtle">
              {text("resolution", { seconds: snapshot.stepMs / 1000 })}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="text-ui-xs text-foreground-subtle">{text("shape")}</span>
          <div className="flex gap-1" role="group" aria-label={text("shape")}>
            {(
              [
                ["ball", Circle],
                ["capsule", RectangleHorizontal],
                ["mini", Minus],
              ] as const
            ).map(([s, Icon]) => (
              <Button
                key={s}
                variant="ghost"
                size="icon"
                className={shape === s ? "bg-selected" : ""}
                aria-label={text(s)}
                aria-pressed={shape === s}
                onClick={() => onShape(s)}
              >
                <Icon />
              </Button>
            ))}
          </div>
        </div>
        <p className={compact ? "hidden" : "text-ui-xs text-foreground-subtlest"}>
          {text("historySince", {
            time: snapshot.startedAt
              ? new Date(snapshot.startedAt).toISOString().replace("T", " ").slice(0, 19)
              : "—",
          })}
        </p>
      </footer>
    </>
  );
}
