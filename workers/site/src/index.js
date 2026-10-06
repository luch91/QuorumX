function secured(response, cacheControl) {
  const headers = new Headers(response.headers);
  headers.set("content-security-policy", "default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://cdn.stamp.fyi; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("cross-origin-opener-policy", "same-origin");
  if (cacheControl) headers.set("cache-control", cacheControl);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function fetchApi(env, request) {
  return env.QUORUMX_API ? env.QUORUMX_API.fetch(request) : fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.quorumx.dev") {
      url.hostname = "quorumx.dev";
      return secured(Response.redirect(url.toString(), 308), "public, max-age=300");
    }

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (request.method !== "GET" && request.method !== "OPTIONS") {
        return secured(new Response(JSON.stringify({ error: "method_not_allowed" }), {
          status: 405,
          headers: { "content-type": "application/json; charset=utf-8", allow: "GET, OPTIONS" },
        }));
      }
      const upstream = new URL(env.QUORUMX_API_BASE);
      upstream.pathname = url.pathname.slice("/api".length) || "/";
      upstream.search = url.search;
      return secured(await fetchApi(env, new Request(upstream, request)));
    }

    const record = url.pathname.match(/^\/proposals\/([^/]+)$/);
    if (record && request.method === "GET") {
      let canonicalId;
      try { canonicalId = decodeURIComponent(record[1]); } catch { return secured(new Response("Invalid proposal URL", { status: 400 })); }
      const upstream = new URL(`/v1/proposals/${encodeURIComponent(canonicalId)}`, env.QUORUMX_API_BASE);
      const [shell, proposalResponse] = await Promise.all([
        env.ASSETS.fetch(new Request(new URL("/", url), request)),
        fetchApi(env, new Request(upstream, { headers: { accept: "application/json" } })),
      ]);
      if (!proposalResponse.ok) return secured(new Response(proposalResponse.status === 404 ? "Proposal not found" : "Proposal temporarily unavailable", { status: proposalResponse.status }));
      const proposal = (await proposalResponse.json()).data;
      const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
      const fallback = `<main class="server-record"><p>${escape(proposal.daoName)} / ${escape(proposal.space)}</p><h1>${escape(proposal.title)}</h1><p>${escape(proposal.bodyText || "The canonical source contains no proposal body.")}</p><p><a href="${escape(proposal.canonicalUrl)}">Open canonical proposal</a></p></main>`;
      const html = (await shell.text()).replace("<body", `<body data-direct-proposal="${escape(canonicalId)}"`).replace("</body>", `<noscript>${fallback}</noscript></body>`);
      return secured(new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }), "public, max-age=15, stale-while-revalidate=30");
    }

    const asset = await env.ASSETS.fetch(request);
    const immutable = /\.(?:webp|svg)$/.test(url.pathname) ? "public, max-age=604800, immutable" : undefined;
    return secured(asset, immutable);
  },
};
