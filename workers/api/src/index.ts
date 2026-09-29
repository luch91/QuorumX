import { Client } from "pg";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "GET" } });
    }

    if (url.pathname === "/") {
      return json({
        service: "quorumx-api",
        version: "0.2.0-foundation",
        status: "online",
      });
    }

    if (url.pathname === "/health") {
      const client = new Client({ connectionString: env.HYPERDRIVE.connectionString });
      try {
        await client.connect();
        const result = await client.query<{ database_name: string; checked_at: string }>(
          "select current_database() as database_name, now()::text as checked_at",
        );
        return json({
          status: "ok",
          database: result.rows[0]?.database_name,
          checkedAt: result.rows[0]?.checked_at,
        });
      } catch (error) {
        console.error(JSON.stringify({
          message: "database health check failed",
          error: error instanceof Error ? error.message : String(error),
        }));
        return json({ status: "degraded", database: "unavailable" }, { status: 503 });
      } finally {
        await client.end().catch(() => undefined);
      }
    }

    return json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
