/** Single trade tick from producer */
export interface StreamTick {
  type: "tick";
  time: string | null;
  price: number;
  size: number;
  exchange: string;
}

/** Limit order book snapshot */
export interface StreamLob {
  type: "lob";
  bids: Array<{ price: number; size: number; marketMaker: string }>;
  asks: Array<{ price: number; size: number; marketMaker: string }>;
}

/** Volume update */
export interface StreamVolume {
  type: "volume";
  totalVolume: number;
  sessionVolume: number;
}

/** VIX index value */
export interface StreamVix {
  type: "vix";
  value: number;
}

/** VIX9D index value (9-day) */
export interface StreamVix9d {
  type: "vix9d";
  value: number;
}

/** Option chain snapshot (calls/puts with strike, iv, delta) */
export interface StreamOptions {
  type: "options";
  underlying: string;
  expiry: string;
  calls: Array<{ strike: number; iv: number | null; delta: number | null }>;
  puts: Array<{ strike: number; iv: number | null; delta: number | null }>;
}

/** Single options trade (last update from option ticker) */
export interface StreamOptionTick {
  type: "option_tick";
  time: string | null;
  strike: number;
  right: "C" | "P";
  price: number;
  size: number;
}

export type StreamEvent =
  | StreamTick
  | StreamLob
  | StreamVolume
  | StreamVix
  | StreamVix9d
  | StreamOptions
  | StreamOptionTick;
