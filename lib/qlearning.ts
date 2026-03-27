/**
 * Q-learning (tabular) RL algorithm using market depth (LOB) as state.
 * State is discretized from LOB features; actions: Neutral (0), Up (1), Down (2).
 * Reward from next-tick price move.
 */

export type LobLike = {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
};

const NUM_ACTIONS = 3;
const TICK_SIZE = 0.25;
const DEPTH_LEVELS = 5;

/** Number of bins per feature for discretization: spread, imbalance, bidVol, askVol */
const SPREAD_BINS = 3;
const IMBALANCE_BINS = 3;
const VOL_BINS = 2;
const NUM_STATES =
  SPREAD_BINS * IMBALANCE_BINS * VOL_BINS * VOL_BINS;

function binSpread(spreadTicks: number): number {
  if (spreadTicks <= 1) return 0;
  if (spreadTicks <= 2) return 1;
  return 2;
}

function binImbalance(imbalance: number): number {
  if (imbalance < -0.33) return 0;
  if (imbalance <= 0.33) return 1;
  return 2;
}

function binVol(logVol: number): number {
  return logVol < 2 ? 0 : 1;
}

/** Map LOB to a discrete state index for the Q-table. */
function getDiscreteState(lob: LobLike | null): number | null {
  if (!lob || !lob.bids.length || !lob.asks.length) return null;
  const bids = lob.bids.slice(0, DEPTH_LEVELS);
  const asks = lob.asks.slice(0, DEPTH_LEVELS);
  const bestBid = bids[0];
  const bestAsk = asks[0];
  const spread = (bestAsk.price - bestBid.price) / TICK_SIZE;
  const bidVol = bids.reduce((s, l) => s + l.size, 0);
  const askVol = asks.reduce((s, l) => s + l.size, 0);
  const total = bidVol + askVol + 1e-6;
  const imbalance = (bidVol - askVol) / total;
  const bSpread = binSpread(spread);
  const bImb = binImbalance(imbalance);
  const bBid = binVol(Math.log(1 + bidVol));
  const bAsk = binVol(Math.log(1 + askVol));
  return bSpread + SPREAD_BINS * (bImb + IMBALANCE_BINS * (bBid + VOL_BINS * bAsk));
}

export const Q_ACTIONS = ["Neutral", "Up", "Down"] as const;
export type QAction = 0 | 1 | 2;

export interface QLearningAgentState {
  action: QAction;
}

const ALPHA = 0.1;
const GAMMA = 0.95;
const EPSILON = 0.15;

/**
 * Tabular Q-learning agent: discrete state from LOB, epsilon-greedy, reward from price change.
 */
export function createQLearningAgent() {
  const Q: number[][] = Array.from({ length: NUM_STATES }, () =>
    Array.from({ length: NUM_ACTIONS }, () => 0)
  );
  let lastState: number | null = null;
  let lastAction: QAction = 0;
  let lastPrice: number | null = null;

  function getAction(lob: LobLike | null): QLearningAgentState | null {
    const state = getDiscreteState(lob);
    if (state == null) return null;
    const qRow = Q[state];
    const best = qRow.indexOf(Math.max(...qRow));
    const action: QAction =
      Math.random() < EPSILON ? (Math.floor(Math.random() * NUM_ACTIONS) as QAction) : (best as QAction);
    lastState = state;
    lastAction = action;
    return { action };
  }

  function step(lob: LobLike | null, currentPrice: number): QLearningAgentState | null {
    const nextState = getDiscreteState(lob);
    if (lastState !== null && lastPrice !== null && nextState !== null) {
      let reward = 0;
      const priceChange = (currentPrice - lastPrice) / TICK_SIZE;
      if (lastAction === 1) reward = priceChange;
      else if (lastAction === 2) reward = -priceChange;
      const maxNext = Math.max(...Q[nextState]);
      Q[lastState][lastAction] +=
        ALPHA * (reward + GAMMA * maxNext - Q[lastState][lastAction]);
    }
    lastPrice = currentPrice;
    return getAction(lob);
  }

  return { getAction, step };
}
