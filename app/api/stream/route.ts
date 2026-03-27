/**
 * SSE endpoint: connects to the tick producer's TCP server (default 127.0.0.1:8765)
 * and streams each NDJSON line as a server-sent event. No MQTT/broker required.
 */
import { NextRequest } from "next/server";
import net from "net";

const TICK_STREAM_HOST = process.env.TICK_STREAM_HOST ?? "127.0.0.1";
const TICK_STREAM_PORT = Number(process.env.TICK_STREAM_PORT ?? "8765");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let buffer = "";
      const socket = net.createConnection(
        { host: TICK_STREAM_HOST, port: TICK_STREAM_PORT },
        () => {
          // connected
        }
      );

      const cleanup = () => {
        try {
          socket.destroy();
          controller.close();
        } catch {
          // ignore
        }
      };

      req.signal.addEventListener("abort", cleanup);

      socket.on("data", (data: Buffer) => {
        buffer += data.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            controller.enqueue(encoder.encode(`data: ${trimmed}\n\n`));
          }
        }
      });

      socket.on("error", (err) => {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "error", message: String(err.message) })}\n\n`
          )
        );
      });

      socket.on("close", () => {
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Connection: "keep-alive",
    },
  });
}
