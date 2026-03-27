/**
 * REINFORCE (policy gradient) RL algorithm using market depth (LOB) as state.
 * Discrete actions: Neutral (0), Up (1), Down (2). Reward from next-tick price move.
 */

export type LobLike = {
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
};

const STATE_DIM = 6;
const NUM_ACTIONS = 3;
const LEARNING_RATE = 0.01;
const TICK_SIZE = 0.25;
/** Top N levels per side for state features */
const DEPTH_LEVELS = 5;

/** Extract state vector from LOB for policy input. */
export function getStateFromLob(lob: LobLike | null): number[] | null {
  if (!lob || !lob.bids.length || !lob.asks.length) return null;
  const bids = lob.bids.slice(0, DEPTH_LEVELS);
  const asks = lob.asks.slice(0, DEPTH_LEVELS);
  const bestBid = bids[0];
  const bestAsk = asks[0];
  const spread = bestAsk.price - bestBid.price;
  const bidVol = bids.reduce((s, l) => s + l.size, 0);
  const askVol = asks.reduce((s, l) => s + l.size, 0);
  const total = bidVol + askVol + 1e-6;
  const imbalance = (bidVol - askVol) / total;
  return [
    1,
    spread / TICK_SIZE,
    imbalance,
    Math.log(1 + bidVol),
    Math.log(1 + askVol),
    spread / (TICK_SIZE * 10),
  ];
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exp = logits.map((x) => Math.exp(x - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((e) => e / sum);
}

function sample(probs: number[]): number {
  const u = Math.random();
  let c = 0;
  for (let i = 0; i < probs.length; i++) {
    c += probs[i];
    if (u <= c) return i;
  }
  return probs.length - 1;
}

export const REINFORCE_ACTIONS = ["Neutral", "Up", "Down"] as const;
export type ReinforceAction = 0 | 1 | 2;

export interface ReinforceAgentState {
  action: ReinforceAction;
  probs: [number, number, number];
}

/**
 * REINFORCE agent: state from LOB, linear softmax policy, reward from price change.
 */
export function createReinforceAgent() {
  let theta: number[][] = Array.from({ length: NUM_ACTIONS }, () =>
    Array.from({ length: STATE_DIM }, () => (Math.random() - 0.5) * 0.1)
  );
  let lastState: number[] | null = null;
  let lastAction: ReinforceAction = 0;
  let lastPrice: number | null = null;

  function getAction(lob: LobLike | null): ReinforceAgentState | null {
    const state = getStateFromLob(lob);
    if (!state) return null;
    const logits = theta.map((row) => row.reduce((s, w, i) => s + w * state[i], 0));
    const probs = softmax(logits) as [number, number, number];
    const action = sample(probs) as ReinforceAction;
    lastState = state;
    lastAction = action;
    return { action, probs };
  }

  /**
   * Call when a new tick arrives. Uses current lastTick.price as new price and
   * previous price from last step to compute reward, then updates policy.
   */
  function step(lob: LobLike | null, currentPrice: number): ReinforceAgentState | null {
    if (lastState !== null && lastPrice !== null) {
      const priceChange = currentPrice - lastPrice;
      let reward = 0;
      if (lastAction === 1) reward = priceChange / TICK_SIZE;
      else if (lastAction === 2) reward = -priceChange / TICK_SIZE;
      const logits = theta.map((row) =>
        row.reduce((s, w, i) => s + w * lastState![i], 0)
      );
      const pi = softmax(logits);
      const oneHot = [0, 0, 0];
      oneHot[lastAction] = 1;
      const grad = oneHot.map((o, i) => o - pi[i]);
      for (let a = 0; a < NUM_ACTIONS; a++) {
        for (let i = 0; i < STATE_DIM; i++) {
          theta[a][i] += LEARNING_RATE * reward * grad[a] * lastState![i];
        }
      }
    }
    lastPrice = currentPrice;
    return getAction(lob);
  }

  return { getAction, step };
}
