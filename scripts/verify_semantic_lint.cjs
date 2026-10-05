function diagnostics(value, found = []) {
  if (Array.isArray(value)) value.forEach((entry) => diagnostics(entry, found));
  else if (value && typeof value === "object") {
    if (typeof value.code === "string" && typeof value.message === "string") found.push({ code: value.code, message: value.message });
    Object.values(value).forEach((entry) => diagnostics(entry, found));
  }
  return found;
}

function acceptsKnownUpstreamFailure(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return false; }
  const found = diagnostics(parsed);
  return found.length === 1 && found[0].code === "E101"
    && found[0].message === "HTTP Error 404: Not Found while downloading the GenVM release asset";
}

module.exports = { acceptsKnownUpstreamFailure };

if (require.main === module) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => { if (!acceptsKnownUpstreamFailure(input)) process.exitCode = 1; });
}
