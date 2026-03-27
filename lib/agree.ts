/**
 * AGREE: fusion of 20/50 MA cross, Q-learning, REINFORCE, MACD, and VWAP.
 * Maps each signal to Neutral (0), Up (1), Down (2) and returns majority vote.
 */

export type AgreeAction = 0 | 1 | 2;

export const AGREE_ACTIONS = ["Neutral", "Up", "Down"] as const;

/** Map 20/50 MA cross to action: ma20 > ma50 → Up, ma50 > ma20 → Down, else Neutral. */
function maCrossToAction(ma20: number | null, ma50: number | null): AgreeAction {
  if (ma20 == null || ma50 == null) return 0;
  if (ma20 > ma50) return 1;
  if (ma50 > ma20) return 2;
  return 0;
}

/** MACD > 0 → Up, MACD < 0 → Down, else Neutral. */
function macdToAction(macd: number | null): AgreeAction {
  if (macd == null) return 0;
  if (macd > 0) return 1;
  if (macd < 0) return 2;
  return 0;
}

/** Price > VWAP → Up, Price < VWAP → Down, else Neutral. */
function vwapToAction(vwap: number | null, lastPrice: number | null): AgreeAction {
  if (vwap == null || lastPrice == null) return 0;
  if (lastPrice > vwap) return 1;
  if (lastPrice < vwap) return 2;
  return 0;
}

/**
 * Fuse all signals via majority vote. Tie-break: Neutral.
 */
export function getAGREEAction(
  ma20: number | null,
  ma50: number | null,
  qAction: number | null,
  reinforceAction: number | null,
  macdValue: number | null,
  vwapValue: number | null,
  lastPrice: number | null
): AgreeAction | null {
  const maVote = maCrossToAction(ma20, ma50);
  const qVote = qAction != null && qAction >= 0 && qAction <= 2 ? (qAction as AgreeAction) : null;
  const rVote = reinforceAction != null && reinforceAction >= 0 && reinforceAction <= 2 ? (reinforceAction as AgreeAction) : null;
  const macdVote = macdToAction(macdValue);
  const vwapVote = vwapToAction(vwapValue, lastPrice);

  const votes: AgreeAction[] = [maVote, macdVote, vwapVote];
  if (qVote != null) votes.push(qVote);
  if (rVote != null) votes.push(rVote);

  if (votes.length === 0) return null;
  const counts = [0, 0, 0] as [number, number, number];
  for (const v of votes) counts[v]++;
  const maxCount = Math.max(...counts);
  if (counts[0] === maxCount) return 0;
  if (counts[1] === maxCount) return 1;
  return 2;
}
