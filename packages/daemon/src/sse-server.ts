/**
 * Express HTTP + SSE server for the operator dashboard.
 *
 * Wiring contract:
 *   const sse = startServer({ snapshot: () => state.get() });
 *   sse.emit("milestone-assigned", { projectId, milestoneIndex });
 *   sse.emit("agent-log", { line });
 *   // ...
 *   await sse.stop(); // on shutdown
 *
 * Endpoints:
 *   GET /          — tiny HTML page that subscribes to /events and renders a <pre>
 *   GET /events    — SSE stream of named events (`status`, `milestone-*`, `agent-log`, ...)
 *   GET /status    — JSON snapshot of current daemon state (whatever `snapshot` returns)
 *
 * Keeps zero state of its own — broadcasts to all connected clients on emit().
 */
import express, { type Request, type Response } from "express";
import type { Server } from "node:http";
import { config } from "./config.js";

export interface SseEvent {
  event: string;
  data: unknown;
  at: number;
}

export interface SseServer {
  emit: (event: string, data: unknown) => void;
  stop: () => Promise<void>;
  port: number;
  clientCount: () => number;
}

export interface StartServerOpts {
  /** Optional snapshot fn for GET /status; defaults to a minimal "ok" object. */
  snapshot?: () => unknown;
  /** Override config.httpPort (mostly for tests). */
  port?: number;
}

export function startServer(opts: StartServerOpts = {}): SseServer {
  const app = express();
  const port = opts.port ?? config.httpPort;
  const clients = new Set<Response>();

  app.get("/", (_req: Request, res: Response) => {
    res.type("html").send(HTML_PAGE);
  });

  app.get("/status", (_req: Request, res: Response) => {
    const snap = opts.snapshot ? opts.snapshot() : { ok: true };
    res.json({ daemon: config.daemonName, port, clients: clients.size, snapshot: snap });
  });

  app.get("/events", (req: Request, res: Response) => {
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    // Hello + initial snapshot so clients render immediately.
    writeEvent(res, "hello", { daemon: config.daemonName, at: Date.now() });
    if (opts.snapshot) writeEvent(res, "status", opts.snapshot());

    clients.add(res);

    // Keepalive ping every 25s so reverse proxies don't drop the socket.
    const ping = setInterval(() => {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, 25_000);

    req.on("close", () => {
      clearInterval(ping);
      clients.delete(res);
    });
  });

  const server: Server = app.listen(port, () => {
    console.log(`[chord:sse] http listening on http://localhost:${port}`);
  });

  return {
    port,
    clientCount: () => clients.size,
    emit: (event, data) => {
      for (const res of clients) {
        try {
          writeEvent(res, event, data);
        } catch {
          clients.delete(res);
        }
      }
    },
    stop: () =>
      new Promise<void>(resolve => {
        for (const res of clients) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
        clients.clear();
        server.close(() => resolve());
      }),
  };
}

function writeEvent(res: Response, event: string, data: unknown): void {
  // bigint isn't JSON-serializable by default — coerce defensively.
  const payload = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  res.write(`event: ${event}\ndata: ${payload}\n\n`);
}

const HTML_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Chord daemon</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 1.5rem; background: #0b0d11; color: #d9e1ec; }
    h1 { font-size: 1.1rem; margin: 0 0 0.5rem; color: #8ad4ff; }
    .meta { color: #7c8ba0; font-size: 0.85rem; margin-bottom: 1rem; }
    pre { white-space: pre-wrap; word-break: break-word; background: #11151c; padding: 1rem; border-radius: 6px; max-height: 80vh; overflow: auto; border: 1px solid #1f2630; }
    .ev { color: #c0e0ff; }
    .agent { color: #a8e6a3; }
    .err { color: #ff8a8a; }
  </style>
</head>
<body>
  <h1>chord-daemon — live event stream</h1>
  <div class="meta">connect to <code>/events</code> · snapshot at <code>/status</code></div>
  <pre id="log">connecting...\n</pre>
  <script>
    const log = document.getElementById('log');
    const append = (cls, text) => {
      const span = document.createElement('span');
      if (cls) span.className = cls;
      span.textContent = text + '\\n';
      log.appendChild(span);
      log.scrollTop = log.scrollHeight;
    };
    const src = new EventSource('/events');
    src.onopen = () => append('', '[connected]');
    src.onerror = () => append('err', '[disconnected — retrying]');
    src.addEventListener('hello',     e => append('ev', '[hello] ' + e.data));
    src.addEventListener('status',    e => append('ev', '[status] ' + e.data));
    src.addEventListener('agent-log', e => {
      try { const d = JSON.parse(e.data); append('agent', d.line || e.data); }
      catch { append('agent', e.data); }
    });
    // Catch-all for any other named event
    for (const name of ['milestone-assigned','milestone-accepted','milestone-submitted','milestone-failed','sca-resolved','boot']) {
      src.addEventListener(name, e => append('ev', '[' + name + '] ' + e.data));
    }
  </script>
</body>
</html>`;
