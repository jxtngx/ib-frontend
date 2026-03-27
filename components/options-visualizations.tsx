"use client";

import type { ComponentProps, ReactNode } from "react";
import type { StreamOptionTick, StreamOptions } from "@/lib/stream-types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const BID_FILL = "#22c55e";
const ASK_FILL = "#ef4444";

/** Panel wrapper — fills cell, scrolls content */
function Pane({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-card/80 p-3 ${className}`}>
      <h4 className="flex-shrink-0 w-full text-center text-sm font-medium text-foreground mb-2">{title}</h4>
      <div className="flex-1 min-h-0 overflow-auto">{children}</div>
    </div>
  );
}

/** Recent options trades — scrolling list */
export function OptionTradesPanel({ optionTicks }: { optionTicks: StreamOptionTick[] }) {
  const display = [...optionTicks].reverse(); // newest first
  return (
    <Pane title="Options trades">
      <div className="h-full min-h-0 overflow-auto">
        {display.length === 0 ? (
          <div className="flex h-full min-h-[120px] items-center justify-center text-xs text-muted-foreground">
            No options trades yet
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="text-muted-foreground">
                <th className="text-left font-medium py-1 pr-2">Time</th>
                <th className="text-right font-medium py-1 pr-2">Strike</th>
                <th className="text-center font-medium py-1 w-8">C/P</th>
                <th className="text-right font-medium py-1 pr-2">Price</th>
                <th className="text-right font-medium py-1">Size</th>
              </tr>
            </thead>
            <tbody>
              {display.map((t, i) => {
                const timeStr = t.time ? new Date(t.time).toLocaleTimeString("en-US", { hour12: false }) : "—";
                const isCall = t.right === "C";
                return (
                  <tr key={`${t.strike}-${t.right}-${t.price}-${t.size}-${i}`} className="border-t border-border/50">
                    <td className="tabular-nums py-0.5 pr-2 text-muted-foreground">{timeStr}</td>
                    <td className="tabular-nums text-right py-0.5 pr-2">{t.strike}</td>
                    <td className="text-center py-0.5">
                      <span className={isCall ? "font-medium" : ""} style={{ color: isCall ? BID_FILL : ASK_FILL }}>
                        {t.right}
                      </span>
                    </td>
                    <td className="tabular-nums text-right py-0.5 pr-2 font-medium">{t.price.toFixed(2)}</td>
                    <td className="tabular-nums text-right py-0.5">{t.size}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </Pane>
  );
}

/** MES options — volatility smile (IV by strike, calls + puts) */
export function OptionsPanel({ options }: { options: StreamOptions | null }) {
  if (!options || (options.calls.length === 0 && options.puts.length === 0)) {
    return (
      <Pane title={`${options?.underlying ?? "MES"} options`}>
        <div className="flex h-full min-h-[180px] items-center justify-center rounded text-sm text-muted-foreground">
          Waiting for options data…
        </div>
      </Pane>
    );
  }

  const strikes = Array.from(
    new Set([...options.calls.map((r) => r.strike), ...options.puts.map((r) => r.strike)])
  ).sort((a, b) => a - b);

  const smileData = strikes.map((strike) => {
    const c = options.calls.find((r) => r.strike === strike);
    const p = options.puts.find((r) => r.strike === strike);
    return {
      strike,
      callIv: c?.iv != null ? c.iv * 100 : null,
      putIv: p?.iv != null ? p.iv * 100 : null,
      callDelta: c?.delta ?? null,
      putDelta: p?.delta ?? null,
    };
  });

  const allIvs = smileData.flatMap((d) => [d.callIv, d.putIv]).filter((v): v is number => v != null);
  const ivMin = allIvs.length ? Math.min(...allIvs) : 0;
  const ivMax = allIvs.length ? Math.max(...allIvs) : 50;
  const ivPadding = (ivMax - ivMin) * 0.1 || 2;
  const yDomain = [Math.max(0, ivMin - ivPadding), ivMax + ivPadding] as [number, number];

  const callIvs = smileData.map((d) => d.callIv).filter((v): v is number => v != null);
  const putIvs = smileData.map((d) => d.putIv).filter((v): v is number => v != null);
  const avgCallIv = callIvs.length ? (callIvs.reduce((a, b) => a + b, 0) / callIvs.length).toFixed(2) : "—";
  const avgPutIv = putIvs.length ? (putIvs.reduce((a, b) => a + b, 0) / putIvs.length).toFixed(2) : "—";
  const strikeRange = strikes.length >= 2 ? `${strikes[0]} – ${strikes[strikes.length - 1]}` : strikes[0]?.toString() ?? "—";

  function CallTooltip(props: { active?: boolean; payload?: ReadonlyArray<{ payload?: (typeof smileData)[0] }> }) {
    const { active, payload } = props;
    if (!active || !payload?.length || !payload[0].payload) return null;
    const p = payload[0].payload;
    return (
      <div className="rounded border border-border bg-card px-3 py-2 text-xs shadow-md">
        <div className="font-semibold text-foreground mb-1">Strike {p.strike}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          <span>IV</span>
          <span className="tabular-nums font-medium" style={{ color: BID_FILL }}>{p.callIv != null ? `${p.callIv.toFixed(2)}%` : "—"}</span>
          <span>Δ</span>
          <span className="tabular-nums">{p.callDelta != null ? p.callDelta.toFixed(3) : "—"}</span>
        </div>
      </div>
    );
  }

  function PutTooltip(props: { active?: boolean; payload?: ReadonlyArray<{ payload?: (typeof smileData)[0] }> }) {
    const { active, payload } = props;
    if (!active || !payload?.length || !payload[0].payload) return null;
    const p = payload[0].payload;
    return (
      <div className="rounded border border-border bg-card px-3 py-2 text-xs shadow-md">
        <div className="font-semibold text-foreground mb-1">Strike {p.strike}</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          <span>IV</span>
          <span className="tabular-nums font-medium" style={{ color: ASK_FILL }}>{p.putIv != null ? `${p.putIv.toFixed(2)}%` : "—"}</span>
          <span>Δ</span>
          <span className="tabular-nums">{p.putDelta != null ? p.putDelta.toFixed(3) : "—"}</span>
        </div>
      </div>
    );
  }

  return (
    <Pane title={`${options.underlying} options — expiry ${options.expiry}`}>
      <div className="flex flex-col gap-2 h-full min-h-0">
        <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-4 font-mono text-xs text-muted-foreground">
          <span title="Strike range">Strikes: <span className="tabular-nums text-foreground">{strikeRange}</span></span>
          <span title="Average call IV">Call IV: <span className="tabular-nums font-medium" style={{ color: BID_FILL }}>{avgCallIv}%</span></span>
          <span title="Average put IV">Put IV: <span className="tabular-nums font-medium" style={{ color: ASK_FILL }}>{avgPutIv}%</span></span>
          <span title="Number of strikes">N: <span className="tabular-nums text-foreground">{strikes.length}</span></span>
        </div>
        <div className="grid flex-1 min-h-0 grid-cols-2 gap-2" style={{ minHeight: 140 }}>
          <div className="min-h-0">
            <p className="text-center text-xs font-medium text-muted-foreground mb-0.5">Puts — IV</p>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={smileData} margin={{ top: 4, right: 8, left: 32, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
                <XAxis dataKey="strike" type="number" domain={["dataMin", "dataMax"]} tick={{ fontSize: 9 }} tickFormatter={(v) => String(v)} />
                <YAxis orientation="left" domain={yDomain} tick={{ fontSize: 9 }} tickFormatter={(v) => (v != null ? `${v}%` : "")} />
                <Tooltip content={((p: unknown) => <PutTooltip {...(p as ComponentProps<typeof PutTooltip>)} />) as ComponentProps<typeof Tooltip>["content"]} />
                <Line type="monotone" dataKey="putIv" stroke={ASK_FILL} strokeWidth={2} dot={{ r: 2, fill: ASK_FILL }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="min-h-0">
            <p className="text-center text-xs font-medium text-muted-foreground mb-0.5">Calls — IV</p>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={smileData} margin={{ top: 4, right: 32, left: 4, bottom: 16 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.25} vertical={false} />
                <XAxis dataKey="strike" type="number" domain={["dataMax", "dataMin"]} reversed tick={{ fontSize: 9 }} tickFormatter={(v) => String(v)} />
                <YAxis orientation="right" domain={yDomain} tick={{ fontSize: 9 }} tickFormatter={(v) => (v != null ? `${v}%` : "")} />
                <Tooltip content={((p: unknown) => <CallTooltip {...(p as ComponentProps<typeof CallTooltip>)} />) as ComponentProps<typeof Tooltip>["content"]} />
                <Line type="monotone" dataKey="callIv" stroke={BID_FILL} strokeWidth={2} dot={{ r: 2, fill: BID_FILL }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </Pane>
  );
}
