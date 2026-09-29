export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === "www.quorumx.dev") {
      url.hostname = "quorumx.dev";
      return Response.redirect(url.toString(), 308);
    }

    return env.ASSETS.fetch(request);
  },
};
