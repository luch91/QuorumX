"use strict";

// Proposal content is untrusted. markdown-it is used only to turn Markdown
// syntax into a small, controlled HTML vocabulary; raw HTML and non-HTTPS
// links never reach the page as executable markup.
const MarkdownIt = require("markdown-it");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[character]));
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Do not turn ordinary source snippets into paragraph markup just because they
// happen to contain punctuation. URLs are intentionally included: a bare HTTPS
// URL is Markdown-compatible source material and should be usable.
function containsMarkdown(value) {
  const source = String(value ?? "");
  return /(^|\n)\s{0,3}#{1,6}\s+|(^|\n)\s*(?:[-*+]\s+|\d+[.)]\s+|>\s+)|\*\*[^*]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*)|`[^`]+`|```|!?\[[^\]]+\]\([^\s)]+(?:\s+[^)]*)?\)|https:\/\/[^\s<]+/m.test(source);
}

const parser = new MarkdownIt({ html: false, linkify: true, breaks: false });
parser.validateLink = (url) => safeHttpsUrl(url) !== null;
parser.renderer.rules.link_open = (tokens, index, options, environment, self) => {
  const token = tokens[index];
  const href = token.attrGet("href");
  if (!safeHttpsUrl(href)) return "";
  token.attrSet("href", safeHttpsUrl(href));
  token.attrSet("target", "_blank");
  token.attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, index, options);
};
parser.renderer.rules.image = (tokens, index) => escapeHtml(tokens[index].content || "");

function renderMarkdown(value) {
  return parser.render(String(value ?? ""));
}

function renderSourceMarkdown(value) {
  const source = String(value ?? "");
  return containsMarkdown(source) ? renderMarkdown(source) : escapeHtml(source);
}

module.exports = { containsMarkdown, escapeHtml, renderMarkdown, renderSourceMarkdown, safeHttpsUrl };
