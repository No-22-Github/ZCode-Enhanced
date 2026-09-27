import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ServerStatsRange } from "@zcode/shared";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import { useServerStats } from "@/hooks/useServerStats.js";
import { useStatsPosition } from "@/hooks/useStatsPosition.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import { StatsPanel, type StatsShape } from "./server-stats/StatsPanel.js";
import { StatsTrigger } from "./server-stats/StatsTrigger.js";
import { usage } from "./server-stats/model.js";

const PREFERENCES_KEY = "zcode:server-stats-display";
function readPreferences(): { shape: StatsShape; pinned: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? "{}");
    return {
      shape: ["ball", "capsule", "mini"].includes(saved.shape) ? saved.shape : "ball",
      pinned: saved.pinned === true,
    };
  } catch {
    return { shape: "ball", pinned: false };
  }
}
export function ServerStatsBall() {
  const platform = useOptionalPlatform();
  return platform?.canSelectFilePath === false ? <WebStatsMonitor /> : null;
}
function WebStatsMonitor() {
  const { intl } = useZCodeIntl();
  const [range, setRange] = useState<ServerStatsRange>("1m");
  const { snapshot, online, latency, now } = useServerStats(true, range);
  const [preferences, setPreferences] = useState(readPreferences);
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [panelHeight, setPanelHeight] = useState(600);
  const collapse = useCallback(() => setExpanded(false), []);
  const close = useCallback(() => {
    setExpanded(false);
    trigger.current?.focus();
  }, []);
  const width = preferences.shape === "ball" ? 80 : preferences.shape === "mini" ? 136 : 296;
  const height = preferences.shape === "ball" ? 80 : 40;
  const placement = useStatsPosition(width, height, collapse);
  const { view } = placement;
  const updatePreferences = (next: typeof preferences) => {
    setPreferences(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch (error) {
      logger.debug("[serverStats] preferences unavailable", error);
    }
  };
  useLayoutEffect(() => {
    if (!expanded || !panel.current) return;
    // 按面板实际高度而非球的高度夹取，避免底部展开时内容落到屏幕外。
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setPanelHeight(entry.target.getBoundingClientRect().height);
    });
    observer.observe(panel.current);
    panel.current.focus();
    return () => observer.disconnect();
  }, [expanded]);
  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (
        !preferences.pinned &&
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        collapse();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [expanded, preferences.pinned, collapse, close]);
  if (!snapshot) return null;
  const narrow = view.width < 600;
  const panelWidth = Math.min(narrow ? 300 : 336, view.width - view.left - view.right - 24);
  const minX = view.x + view.left + 12;
  const maxX = view.x + view.width - view.right - 12 - panelWidth;
  const naturalX =
    placement.position.side === "right"
      ? placement.style.left - panelWidth - 8
      : placement.style.left + width + 8;
  // 手机只展示摘要并限制半屏高度，避免桌面明细面板遮住整个工作区。
  const availableHeight = view.height - view.top - view.bottom;
  const maxHeight = narrow ? Math.min(360, availableHeight * 0.5) : availableHeight - 24;
  const panelTop = Math.max(
    view.y + view.top + 12,
    Math.min(placement.style.top, view.y + view.height - view.bottom - 12 - panelHeight),
  );
  const p = snapshot.latest;
  const label = intl.formatMessage(
    { id: "serverStats.ballAriaLabel" },
    {
      cpu: p?.cpuPercent == null ? "—" : Math.round(p.cpuPercent),
      memory: Math.round(usage(p?.memUsedBytes, p?.memTotalBytes) ?? 0),
    },
  );
  return (
    <>
      {expanded ? (
        <div
          ref={panel}
          data-testid="server-stats-panel"
          id="server-stats-panel"
          role="dialog"
          aria-labelledby="server-stats-title"
          tabIndex={-1}
          className="fixed z-[81] overflow-y-auto overscroll-contain rounded-xl border border-popover-border bg-popover text-foreground shadow-lg outline-none"
          style={{
            left: Math.min(maxX, Math.max(minX, naturalX)),
            top: panelTop,
            width: panelWidth,
            maxHeight,
          }}
        >
          <StatsPanel
            compact={narrow}
            snapshot={snapshot}
            online={online}
            latency={latency}
            now={now}
            range={range}
            onRange={setRange}
            shape={preferences.shape}
            onShape={(shape) => updatePreferences({ ...preferences, shape })}
            pinned={preferences.pinned}
            onPin={() => updatePreferences({ ...preferences, pinned: !preferences.pinned })}
            onClose={close}
          />
        </div>
      ) : null}
      <button
        ref={trigger}
        type="button"
        data-testid="server-stats-trigger"
        aria-label={`${label}${online ? "" : ` · ${intl.formatMessage({ id: "serverStats.disconnected" })}`}`}
        aria-expanded={expanded}
        aria-controls="server-stats-panel"
        title={label}
        className={`fixed z-[80] flex touch-none select-none items-center justify-center rounded-full border border-popover-border bg-popover text-foreground shadow-md focus-visible:ring-2 focus-visible:ring-primary ${placement.dragging ? "cursor-grabbing" : "cursor-grab"} ${online ? "" : "opacity-70"}`}
        style={placement.style}
        {...placement.events}
        onClick={(event) => {
          // 拖动后的合成 click 不得重新展开；键盘 click(detail=0)仍正常工作。
          if (event.detail > 0 && placement.suppressClick.current) {
            placement.suppressClick.current = false;
            return;
          }
          setExpanded((value) => !value);
        }}
      >
        <StatsTrigger snapshot={snapshot} online={online} shape={preferences.shape} />
      </button>
    </>
  );
}
