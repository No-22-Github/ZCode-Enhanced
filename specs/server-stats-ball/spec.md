# Server performance monitor

## Product and ownership

- Web only, mounted once in RootShell. Desktop and hosts without `/proc` initially show nothing. Server `sysStats` owns sampling, bounded history and UTC-day counters; shared `server-stats` owns the HTTP contract; `useServerStats` owns client polling; the floating component owns presentation preferences only.
- First authenticated `GET /api/sys-stats` starts a single serial 1s sampler. It then runs while the server process lives, even without viewers, to maintain history. Timer is unref'd. No extra process, Agent, dependencies or persistence. Restart clears history/counters. Core read failures report unavailable; optional disk failures yield null, never false zero. Failed samples reset delta baselines; recovery does not invent data.
- `?range=1m|15m|24h` defaults to 1m; invalid ranges return 400. Response includes latest raw point independently of the selected range, host name/core count, range/step, monitoring start, and UTC daily traffic. Existing `available` and `points` remain. All requests retain current API auth. Desktop continuous and mobile replayable conversation streams are unchanged: telemetry is same-origin HTTP only.
- CPU uses `/proc/stat` delta, first eight counters only (guest time is already included), idle includes iowait. Memory used remains total minus available. Cache is max(0, Cached + SReclaimable - Shmem); it overlaps the available/used estimate and is shown separately, not stacked additively with used. Swap used = total minus free. Load, uptime and process RSS remain real readings.
- Root filesystem capacity uses async statfs(`/`), refreshed every 10s; used = (blocks - bfree) \* bsize. Disk I/O is host-wide leaf block devices from `/sys/block` (exclude loop/ram/zram and stacked devices with slaves), counters from `/proc/diskstats`, sectors = 512 bytes; label explicitly distinguishes it from root filesystem capacity. Device-set changes reset rate baseline. Unsupported data shows `—`.
- Network sums non-loopback interfaces. Rates use elapsed time and clamp counter resets. Daily UTC traffic accumulates observed deltas only, resets on UTC day rollover, and carries coverage start; missing intervals are excluded. UI states monitoring start/restart and UTC partial-day coverage explicitly.
- History uses bounded buckets: 1m / 1s (60), 15m / 5s (180), 24h / 5m (288). CPU and rates are averaged over valid samples within a bucket; peaks retained independently; other gauges take the last sample. Points retain actual timestamps, no backfill. Client draws fixed-duration timestamp axes and breaks lines over missing buckets. Returned payload is bounded by the selected window.

## Interface and interaction

- Three persistent collapsed modes: dual CPU/memory rings (default), capsule with CPU/memory/network, mini capsule with two usage bars and download. Rings and numeric values warn above 80%, critical above 95%. Status has readable online/offline text as well as color. Use ZCode semantic tokens, text-ui fonts, restrained shadow and native Button controls; no external fonts or chart libraries.
- Expanded panel follows the supplied concept: host/status/header actions; CPU chart/load/peak; used/total memory bar plus cache, swap and RSS; mirrored down/up network graph with shared linear scale, peaks and observed UTC-day totals; root disk capacity and host disk I/O; 1m/15m/24h selector and sampling resolution.
- Pin prevents outside-click dismissal; collapse and Escape still close. Shape and pin preference persist locally; range is local presentation state. Existing `zcode:server-stats-ball` side/top position migrates unchanged. No sampler facts go to localStorage/Zustand.
- Pointer drag retains grab offset, threshold 6px, snap to closest side, cancellation restores stored position. Click/Enter/Space open/close. Resize and safe-area changes reclamp. Expanded panel uses measured height and viewport bounds, internally scrolls on short screens. Focus returns to trigger on collapse/Escape.
- Below 600px viewport width, render a compact summary (CPU, memory used/total, current download/upload, root disk used/total). Omit charts, history controls, load/cache/swap/RSS, daily traffic and host details. Retain connection/stale status, pin, collapse and shape controls. Width is at most 300px; height is at most 50% of the safe viewport and 360px. Anchor beside the trigger and clamp to safe-area insets; keep header controls visible during internal scrolling. Resizing back restores the desktop detail view and selected range. This is presentation derived from the existing viewport owner, with no new stored state or API changes.
- Poll through hook every 2s after previous completion, pause/abort when hidden; range changes abort stale requests. First unsupported response hides and stops until visibility return. After a successful response, connection failures preserve last readings, mark disconnected and retry every 10s while visible; current stale age is shown. RTT is HTTP round-trip latency, not ICMP ping.

```mermaid
sequenceDiagram
  participant UI as Web floating monitor
  participant Hook as useServerStats
  participant API as HTTP route
  participant Sampler as single sysStats owner
  UI->>Hook: range selection
  Hook->>Hook: abort previous request / invalidate response
  Hook->>API: GET sys-stats?range
  API->>Sampler: touch(range), start once
  Sampler->>Sampler: serial 1s sample, bounded buckets, UTC counters
  Sampler-->>Hook: latest + selected history + coverage
  Hook-->>UI: read-only snapshot + RTT / connection status
  Note over Sampler: continues without viewers; restart clears history
  Note over Hook: hidden stops HTTP polling, never server sampling
```

## Acceptance and validation

- Deterministic backend tests: mem/cache/swap and guest accounting; disk sector parsing/device filtering; UTC rollover, reset and gap baselines; bucket average/peak/retention, cold 24h window, invalid range; serial initialization and Linux/non-Linux availability.
- Browser E2E against real Web UI with deterministic HTTP fixtures: all three modes, persisted choice/position, click and keyboard toggle, pin/outside/Escape, dragging/cancel/resize, range requests and stale-response protection, offline retention/recovery, unavailable hiding and visibility pause. Render light/dark, desktop viewport and 390px / 320px phone viewports, ensure panel stays within bounds. Fixture telemetry is not evidence of real VPS measurements.
- Mobile regression: 390px and 320px widths, 640px and short 480px heights; summary occupies at most half the viewport without horizontal overflow, charts/history controls are absent, collapse works by touch, and resizing to desktop restores charts.
- Run pnpm typecheck, pnpm lint, architecture checks, targeted backend/unit/E2E tests and production Web build. Linux CI tests real sampler availability. Local macOS cannot validate live `/proc`/root disk measurements; report this separately.
