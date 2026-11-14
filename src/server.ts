import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { maybeHandleLiveRequest } from "./lib/live-gateway";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/**
 * `/embed/<channel>` is the app's own route, so the router serves it, not the gateway -- and the
 * gateway is where every other embed surface gets `frame-ancestors *` from. Relying on "nothing sets
 * X-Frame-Options" is how an embed works until the day a security header is added for the app and
 * silently bricks every iframe on every host site. Say it on the response itself.
 */
export function withEmbedFraming(request: Request, response: Response): Response {
  const { pathname } = new URL(request.url);
  if (!/^\/embed(\/|$)/i.test(pathname)) return response;
  // A surface that already stated its framing (the section page) has better information than we do.
  if (response.headers.has("content-security-policy")) return response;
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", "frame-ancestors *;");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const liveResponse = await maybeHandleLiveRequest(request, env);
      if (liveResponse) return liveResponse;

      const handler = await getServerEntry();
      const response = withEmbedFraming(request, await handler.fetch(request, env, ctx));
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
