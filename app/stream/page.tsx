"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  StreamEvent,
  StreamLob,
  StreamOptions,
  StreamTick,
  StreamOptionTick,
  StreamVix,
  StreamVix9d,
  StreamVolume,
} from "@/lib/stream-types";
import { vwap, movingAverage, macd } from "@/lib/stream-stats";
import {
  createReinforceAgent,
  REINFORCE_ACTIONS,
  type ReinforceAgentState,
} from "@/lib/reinforce";
import {
  createQLearningAgent,
  Q_ACTIONS,
  type QLearningAgentState,
} from "@/lib/qlearning";
import { getAGREEAction, AGREE_ACTIONS } from "@/lib/agree";
// Options visualizations live in @/components/options-visualizations (OptionsPanel, OptionTradesPanel) — not rendered on this page
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
  LineChart,
  Line,
} from "recharts";

const MAX_TICKS = 80;
/** Tick chart: last 1 minute; volume profile: last 5 minutes */
const TICK_CHART_MS = 1 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
/** MES tick size 0.25 — bucket trades for volume profile */
const PRICE_BUCKET = 0.25;
/** LOB depth: 10 levels per side */
const LOB_DEPTH = 10;
/** Rolling window for tick momentum (blog: 50 ticks) */
const TICK_MOMENTUM_WINDOW = 50;

// Blog-inspired palette (ib-interface/website/blog)
const BID_FILL = "#22c55e";
const ASK_FILL = "#ef4444";
const VOLUME_FILL = "#8b5cf6";
const SPREAD_COLOR = "#f59e0b";
/** Tick chart: unchanged vs previous */
const TICK_UNCHANGED_FILL = "#3b82f6";

function useTickStream() {
  const [ticks, setTicks] = useState<StreamTick[]>([]);
  const [chartTicks, setChartTicks] = useState<StreamTick[]>([]);
  const [volume, setVolume] = useState<StreamVolume | null>(null);
  const [lob, setLob] = useState<StreamLob | null>(null);
  const [vix, setVix] = useState<StreamVix | null>(null);
  const [vix9d, setVix9d] = useState<StreamVix9d | null>(null);
  const [options, setOptions] = useState<StreamOptions | null>(null);
  const [optionTicks, setOptionTicks] = useState<StreamOptionTick[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Rolling 5-min window: { ts, priceBucket, size } for volume profile */
  const volumeRollingRef = useRef<Array<{ ts: number; priceBucket: number; size: number }>>([]);
  const [volumeProfileBars, setVolumeProfileBars] = useState<Array<{ price: string; volume: number }>>([]);
  const signedTicksRef = useRef<number[]>([]);
  const [tickMomentum, setTickMomentum] = useState<number | null>(null);
  const lastPriceRef = useRef<number | null>(null);

  const flushVolumeProfile = useCallback(() => {
    const now = Date.now();
    const cutoff = now - FIVE_MIN_MS;
    const arr = volumeRollingRef.current.filter((x) => x.ts >= cutoff);
    volumeRollingRef.current = arr;
    const map = new Map<number, number>();
    for (const { priceBucket, size } of arr) {
      map.set(priceBucket, (map.get(priceBucket) ?? 0) + size);
    }
    const entries = Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
    setVolumeProfileBars(
      entries.map(([p, vol]) => ({ price: p.toFixed(2), volume: vol }))
    );
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/stream");
    es.onopen = () => {
      setConnected(true);
      setError(null);
    };
    es.onerror = () => {
      setConnected(false);
      setError("Stream disconnected. Is the producer running?");
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StreamEvent;
        if (data.type === "tick") {
          setTicks((prev) => [...prev.slice(-(MAX_TICKS - 1)), data]);
          const ts = data.time ? new Date(data.time).getTime() : Date.now();
          const cutoff = ts - TICK_CHART_MS;
          setChartTicks((prev) => [...prev.filter((t) => t.time && new Date(t.time).getTime() >= cutoff), data]);
          const priceBucket = Math.round(data.price / PRICE_BUCKET) * PRICE_BUCKET;
          volumeRollingRef.current.push({ ts, priceBucket, size: data.size });
          flushVolumeProfile();

          const last = lastPriceRef.current;
          if (last != null) {
            const sign = data.price > last ? 1 : data.price < last ? -1 : 0;
            signedTicksRef.current = [...signedTicksRef.current.slice(-(TICK_MOMENTUM_WINDOW - 1)), sign].filter(
              (s) => s !== 0
            );
            const n = signedTicksRef.current.length;
            setTickMomentum(n === 0 ? 0 : signedTicksRef.current.reduce((a, b) => a + b, 0) / n);
          }
          lastPriceRef.current = data.price;
        } else if (data.type === "volume") {
          setVolume(data);
        } else if (data.type === "lob") {
          setLob(data);
        } else if (data.type === "vix") {
          setVix(data);
        } else if (data.type === "vix9d") {
          setVix9d(data);
        } else if (data.type === "options") {
          setOptions(data);
        } else if (data.type === "option_tick") {
          setOptionTicks((prev) => [...prev.slice(-99), data]);
        }
      } catch {
        // ignore
      }
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [flushVolumeProfile]);

  return { ticks, chartTicks, volume, lob, vix, vix9d, options, optionTicks, volumeProfileBars, tickMomentum, connected, error };
}

/** Live stats: spread, mid, last, book imbalance, tick momentum */
function LiveStatsStrip({
  lob,
  lastTick,
  tickMomentum,
}: {
  lob: StreamLob | null;
  lastTick: StreamTick | null;
  tickMomentum: number | null;
}) {
  const bestBid = lob?.bids[0];
  const bestAsk = lob?.asks[0];
  const spread = bestBid != null && bestAsk != null ? bestAsk.price - bestBid.price : null;
  const mid = bestBid != null && bestAsk != null ? (bestBid.price + bestAsk.price) / 2 : null;
  const bidSize = bestBid?.size ?? 0;
  const askSize = bestAsk?.size ?? 0;
  const totalSize = bidSize + askSize;
  const bookImbalance = totalSize > 0 ? (bidSize - askSize) / totalSize : null; // +1 bid heavy, -1 ask heavy

  const items = [
    { label: "Spread", value: spread != null ? spread.toFixed(2) : "—", color: SPREAD_COLOR },
    { label: "Mid", value: mid != null ? mid.toFixed(2) : "—" },
    { label: "Last", value: lastTick != null ? lastTick.price.toFixed(2) : "—", color: BID_FILL },
    {
      label: "Imbalance",
      value: bookImbalance != null ? (bookImbalance > 0 ? `+${bookImbalance.toFixed(2)}` : bookImbalance.toFixed(2)) : "—",
      color: bookImbalance != null && bookImbalance > 0 ? BID_FILL : bookImbalance != null && bookImbalance < 0 ? ASK_FILL : undefined,
    },
    {
      label: "Tick mom",
      value: tickMomentum != null ? (tickMomentum >= 0 ? `+${tickMomentum.toFixed(2)}` : tickMomentum.toFixed(2)) : "—",
      title: `${TICK_MOMENTUM_WINDOW}-tick signed momentum`,
    },
  ];

  return (
    <div
      className="flex flex-wrap items-center justify-center gap-6 px-4 py-3 font-mono text-sm"
      style={{ marginBottom: "1.5rem" }}
    >
      {items.map(({ label, value, color, title }) => (
        <div key={label} className="flex flex-col items-center gap-0.5" title={title}>
          <span className="text-xs text-muted-foreground">{label}</span>
          <span className="font-semibold tabular-nums" style={color ? { color } : undefined}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Panel wrapper for single-pane layout — fills cell, scrolls content */
const Pane = ({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) => (
  <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-card/80 p-3 ${className}`}>
    <h4 className="flex-shrink-0 w-full text-center text-sm font-medium text-foreground mb-2">{title}</h4>
    <div className="flex-1 min-h-0 overflow-auto">{children}</div>
  </div>
);

/** Cumulative depth by price — blog DepthChart style (stepAfter area) */
function DepthChartPanel({ lob }: { lob: StreamLob | null }) {
  if (!lob || (lob.bids.length === 0 && lob.asks.length === 0)) {
    return (
      <Pane title="Market Depth">
        <div className="flex h-full min-h-[200px] items-center justify-center rounded text-sm text-muted-foreground">
          Waiting for depth…
        </div>
      </Pane>
    );
  }

  const bids = lob.bids.slice(0, LOB_DEPTH);
  const asks = lob.asks.slice(0, LOB_DEPTH);
  const bidRows = bids.reduce<Array<{ price: number; bid: number; ask: number | null }>>((acc, lev) => {
    const cum = acc.length ? (acc[acc.length - 1].bid as number) + lev.size : lev.size;
    acc.push({ price: lev.price, bid: cum, ask: null });
    return acc;
  }, []);
  const askRows = asks.reduce<Array<{ price: number; bid: number | null; ask: number }>>((acc, lev) => {
    const cum = acc.length ? (acc[acc.length - 1].ask as number) + lev.size : lev.size;
    acc.push({ price: lev.price, bid: null, ask: cum });
    return acc;
  }, []);
  const mid = bids.length && asks.length ? (bids[0].price + asks[0].price) / 2 : null;
  const data = [...bidRows, ...askRows].sort((a, b) => a.price - b.price);

  return (
    <Pane title="Market Depth">
      <div className="h-full min-h-[200px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 10, right: 1, left: 1, bottom: 10 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="price"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <YAxis width={30} tick={{ fontSize: 10 }} />
          <Tooltip
            formatter={(v) => [v != null ? Number(v).toFixed(0) : "", "Contracts"]}
            labelFormatter={(label) => `$${Number(label).toFixed(2)}`}
          />
          {mid != null && (
            <ReferenceLine x={mid} stroke="#888" strokeDasharray="4 4" label={mid.toFixed(2)} />
          )}
          <Area
            type="stepAfter"
            dataKey="bid"
            stroke={BID_FILL}
            fill={BID_FILL}
            fillOpacity={0.3}
            connectNulls={false}
          />
          <Area
            type="stepAfter"
            dataKey="ask"
            stroke={ASK_FILL}
            fill={ASK_FILL}
            fillOpacity={0.3}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
    </Pane>
  );
}

/** Tick chart — price over time (last 1 minute) */
function TickChartPanel({ ticks }: { ticks: StreamTick[] }) {
  const chartData = ticks.map((t, i) => {
    const prevPrice = i > 0 ? ticks[i - 1].price : t.price;
    const tickColor =
      t.price > prevPrice ? BID_FILL : t.price < prevPrice ? ASK_FILL : TICK_UNCHANGED_FILL;
    return {
      time: t.time ? new Date(t.time).toLocaleTimeString("en-US", { hour12: false, second: "2-digit", minute: "2-digit", hour: "2-digit" }) : "",
      ts: t.time ? new Date(t.time).getTime() : 0,
      price: t.price,
      size: t.size,
      tickColor,
    };
  });

  if (chartData.length === 0) {
    return (
      <Pane title="Ticks">
        <div className="flex h-full min-h-[200px] items-center justify-center rounded text-sm text-muted-foreground">
          Waiting for tick data…
        </div>
      </Pane>
    );
  }

  const lastPrice = chartData.length > 0 ? chartData[chartData.length - 1].price : 0;
  const tickRange = 25 * PRICE_BUCKET; // ±25 tick increments
  const yDomain = [lastPrice - tickRange, lastPrice + tickRange] as [number, number];

  return (
    <Pane title="Ticks">
      <div className="h-full min-h-[200px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 1, left: 1, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis
            width={30}
            domain={yDomain}
            tick={{ fontSize: 10 }}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            formatter={(v) => [v != null ? Number(v).toFixed(2) : "", "Price"]}
            labelFormatter={(label) => String(label ?? "")}
          />
          <Line
            type="monotone"
            dataKey="price"
            strokeWidth={0}
            isAnimationActive={false}
            dot={({ cx, cy, payload }) =>
              cx != null && cy != null && payload?.tickColor ? (
                <line x1={cx - 2} y1={cy} x2={cx + 2} y2={cy} stroke={payload.tickColor} strokeWidth={2} />
              ) : null
            }
            connectNulls={false}
            name="Price"
          />
        </LineChart>
      </ResponsiveContainer>
      </div>
    </Pane>
  );
}

/** Volume profile — volume at price */
function VolumeProfilePanel({ volumeProfileBars }: { volumeProfileBars: Array<{ price: string; volume: number }> }) {
  if (volumeProfileBars.length === 0) {
    return (
      <Pane title="Volume Profile">
        <div className="flex h-full min-h-[200px] items-center justify-center rounded text-sm text-muted-foreground">
          Waiting for tick data…
        </div>
      </Pane>
    );
  }

  return (
    <Pane title="Volume Profile">
      <div className="h-full min-h-[200px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={volumeProfileBars}
          layout="vertical"
          margin={{ top: 5, right: 1, left: 1, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.2} horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="price" width={44} tick={{ fontSize: 10 }} />
          <Tooltip formatter={(v) => [v != null ? Number(v).toLocaleString() : "", "Contracts"]} />
          <Bar dataKey="volume" fill={BID_FILL} fillOpacity={0.5} name="Volume" />
        </BarChart>
      </ResponsiveContainer>
      </div>
    </Pane>
  );
}

export default function StreamPage() {
  const { ticks, chartTicks, volume, lob, vix, vix9d, volumeProfileBars, tickMomentum, connected, error } = useTickStream();
  const lastTick = ticks.length > 0 ? ticks[ticks.length - 1] : null;

  const vwapValue = vwap(ticks);
  const ma20 = movingAverage(ticks, 20);
  const ma50 = movingAverage(ticks, 50);
  const macdResult = macd(ticks);

  const agentRef = useRef(createReinforceAgent());
  const [reinforceState, setReinforceState] = useState<ReinforceAgentState | null>(null);
  useEffect(() => {
    if (lob && lastTick != null) {
      const next = agentRef.current.step(lob, lastTick.price);
      if (next) setReinforceState(next);
    }
  }, [lob, lastTick]);

  const qAgentRef = useRef(createQLearningAgent());
  const [qLearningState, setQLearningState] = useState<QLearningAgentState | null>(null);
  useEffect(() => {
    if (lob && lastTick != null) {
      const next = qAgentRef.current.step(lob, lastTick.price);
      if (next) setQLearningState(next);
    }
  }, [lob, lastTick]);

  const agreeAction = getAGREEAction(
    ma20,
    ma50,
    qLearningState?.action ?? null,
    reinforceState?.action ?? null,
    macdResult?.macd ?? null,
    vwapValue,
    lastTick?.price ?? null
  );

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background p-3">
      {/* Single pane of glass */}
      <div className="flex flex-1 min-h-0 flex-col overflow-hidden bg-card/50">
        <header className="flex-shrink-0 px-4 py-2">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-foreground">MES Tick Stream</h1>
            <div className="flex items-center gap-3">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: connected ? BID_FILL : "var(--muted-foreground)" }}
                title={connected ? "Connected" : "Disconnected"}
              />
              <span className="text-xs text-muted-foreground">{connected ? "Live" : "Waiting…"}</span>
            </div>
          </div>
          {error && (
            <div className="mt-2 rounded bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-400">
              {error}
            </div>
          )}
          <LiveStatsStrip lob={lob} lastTick={lastTick} tickMomentum={tickMomentum} />
        </header>

        <main className="flex-1 min-h-0 min-w-0 grid grid-cols-4 gap-3 p-3 overflow-hidden">
          <div className="col-span-1 min-h-0 min-w-0 overflow-hidden flex flex-col"><DepthChartPanel lob={lob} /></div>
          <div className="col-span-2 min-h-0 min-w-0 overflow-hidden flex flex-col"><TickChartPanel ticks={chartTicks} /></div>
          <div className="col-span-1 min-h-0 min-w-0 overflow-hidden flex flex-col"><VolumeProfilePanel volumeProfileBars={volumeProfileBars} /></div>
        </main>

        <div className="flex-shrink-0 flex flex-wrap items-center justify-center gap-6 px-4 py-3 font-mono text-sm">
          <div className="flex flex-col items-center gap-0.5">
            {agreeAction === 1 && (
              <span className="text-xs font-medium" style={{ color: BID_FILL }}>
                AGREE
              </span>
            )}
            {agreeAction === 2 && (
              <span className="text-xs font-medium" style={{ color: ASK_FILL }}>
                DISAGREE
              </span>
            )}
            <span className="text-xl font-semibold tabular-nums">
              {lastTick != null ? lastTick.price.toFixed(2) : "—"}
            </span>
            <span className="text-xs text-muted-foreground">Last</span>
          </div>
        </div>

        <footer className="flex-shrink-0 flex flex-wrap items-center justify-center gap-6 px-4 py-3 font-mono text-sm">
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="font-semibold tabular-nums"
              style={{
                color:
                  qLearningState?.action === 1
                    ? BID_FILL
                    : qLearningState?.action === 2
                      ? ASK_FILL
                      : undefined,
              }}
            >
              {qLearningState != null ? Q_ACTIONS[qLearningState.action].toUpperCase() : "—"}
            </span>
            <span className="text-xs text-muted-foreground">Q-LEARNING</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="font-semibold tabular-nums"
              style={{
                color:
                  reinforceState?.action === 1
                    ? BID_FILL
                    : reinforceState?.action === 2
                      ? ASK_FILL
                      : undefined,
              }}
            >
              {reinforceState != null ? REINFORCE_ACTIONS[reinforceState.action].toUpperCase() : "—"}
            </span>
            <span className="text-xs text-muted-foreground">REINFORCE</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            <span
              className="font-semibold tabular-nums"
              style={{
                color:
                  ma20 != null && ma50 != null
                    ? ma20 > ma50
                      ? BID_FILL
                      : ma50 > ma20
                        ? ASK_FILL
                        : undefined
                    : undefined,
              }}
            >
              {ma20 != null && ma50 != null
? ma20 > ma50
                      ? "UP"
                      : ma50 > ma20
                        ? "DOWN"
                    : "—"
                : "—"}
            </span>
            <span className="text-xs text-muted-foreground">CROSS</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            {lastTick != null && vwapValue != null && (
              <span
                className="font-semibold tabular-nums"
                style={{
                  color:
                    lastTick.price > vwapValue
                      ? BID_FILL
                      : lastTick.price < vwapValue
                        ? ASK_FILL
                        : undefined,
                }}
              >
                {lastTick.price > vwapValue ? "UP" : lastTick.price < vwapValue ? "DOWN" : "NEUTRAL"}
              </span>
            )}
            <span className="text-xs text-muted-foreground">VWAP</span>
          </div>
          <div className="flex flex-col items-center gap-0.5">
            {macdResult?.macd != null && (
              <span
                className="font-semibold tabular-nums"
                style={{
                  color:
                    macdResult.macd > 0
                      ? BID_FILL
                      : macdResult.macd < 0
                        ? ASK_FILL
                        : undefined,
                }}
              >
                {macdResult.macd > 0 ? "UP" : macdResult.macd < 0 ? "DOWN" : "NEUTRAL"}
              </span>
            )}
            <span className="text-xs text-muted-foreground">MACD</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
