/**
 * Stream stats: VWAP and tick moving averages.
 * All calculations use tick data (price, size) from the frontend state.
 */

export interface TickPriceSize {
  price: number;
  size: number;
}

/**
 * Volume-weighted average price over the given ticks.
 * VWAP = sum(price * size) / sum(size).
 * Returns null if there are no ticks or total size is zero.
 */
export function vwap(ticks: readonly TickPriceSize[]): number | null {
  if (ticks.length === 0) return null;
  let sumPv = 0;
  let sumV = 0;
  for (const t of ticks) {
    sumPv += t.price * t.size;
    sumV += t.size;
  }
  if (sumV === 0) return null;
  return sumPv / sumV;
}

/**
 * Simple moving average of price over the last n ticks.
 * Returns null if there are fewer than n ticks.
 */
export function movingAverage(
  ticks: readonly { price: number }[],
  n: number
): number | null {
  if (ticks.length < n || n <= 0) return null;
  const slice = ticks.slice(-n);
  const sum = slice.reduce((a, t) => a + t.price, 0);
  return sum / n;
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
}

const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;

/**
 * Moving Average Convergence Divergence from tick prices.
 * MACD line = EMA(fast) - EMA(slow); Signal = EMA(MACD line); Histogram = MACD - Signal.
 * Uses default periods 12, 26, 9. Returns null until there are enough ticks (need at least slow + signal length).
 */
export function macd(
  ticks: readonly { price: number }[],
  fastPeriod: number = MACD_FAST,
  slowPeriod: number = MACD_SLOW,
  signalPeriod: number = MACD_SIGNAL
): MacdResult | null {
  if (ticks.length < slowPeriod) return null;
  const prices = ticks.map((t) => t.price);

  const fastEma: number[] = [];
  const slowEma: number[] = [];
  const alphaFast = 2 / (fastPeriod + 1);
  const alphaSlow = 2 / (slowPeriod + 1);
  let fe = prices[0];
  let se = prices[0];
  fastEma.push(fe);
  slowEma.push(se);
  for (let i = 1; i < prices.length; i++) {
    fe = alphaFast * prices[i] + (1 - alphaFast) * fe;
    se = alphaSlow * prices[i] + (1 - alphaSlow) * se;
    fastEma.push(fe);
    slowEma.push(se);
  }

  const macdSeries: number[] = [];
  for (let i = 0; i < fastEma.length; i++) {
    macdSeries.push(fastEma[i] - slowEma[i]);
  }
  if (macdSeries.length < signalPeriod) return null;

  const alphaSignal = 2 / (signalPeriod + 1);
  let signal = macdSeries[0];
  for (let i = 1; i < macdSeries.length; i++) {
    signal = alphaSignal * macdSeries[i] + (1 - alphaSignal) * signal;
  }

  const lastMacd = macdSeries[macdSeries.length - 1];
  const histogram = lastMacd - signal;

  return { macd: lastMacd, signal, histogram };
}
