const WORKER_VERSION = "0.1.0";
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const MAX_FETCH_CHARS = 30000;
const MAX_FETCH_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_EXTRACT_HTML_CHARS = 512 * 1024;
const MAX_SEARCH_HTML_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_JSON_BYTES = 1024 * 1024;
const MAX_JSON_BODY_CHARS = 16384;
const MAX_BATCH_JSON_BODY_CHARS = 32768;
const MAX_QUERY_CHARS = 500;
const MAX_URL_CHARS = 2048;
const MAX_RERANK_DOCUMENTS = 50;
const SEARCH_PROVIDERS = ["searxng", "zhipu", "bocha", "bocha_ai", "brave", "serper", "tavily", "duckduckgo", "bing"];
const RERANK_PROVIDERS = ["bocha_rerank", "cohere_rerank", "jina_rerank", "voyage_rerank", "siliconflow_rerank"];
const SEARCH_MODES = new Set(["fast", "balanced", "thorough"]);
const NO_KEY_PROVIDERS = new Set(["duckduckgo", "bing"]);
const SUPPORTED_FRESHNESS = new Set(["none", "auto", "day", "week", "month", "year"]);
const FETCH_MODES = new Set(["full", "text", "metadata", "chunks"]);
const DEFAULT_CHUNK_CHARS = 1800;
const MAX_CHUNK_CHARS = 6000;
const DEFAULT_FETCH_CACHE_TTL_SECONDS = 300;
const MAX_FETCH_CACHE_TTL_SECONDS = 3600;
const DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS = 8000;
const DEFAULT_RERANK_PROVIDER_TIMEOUT_MS = 6000;
const MIN_PROVIDER_TIMEOUT_MS = 1000;
const MAX_PROVIDER_TIMEOUT_MS = 30000;
const FETCH_TEXT_CONTENT_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/rss+xml",
  "application/atom+xml",
];
const TRACKING_PARAMS = new Set(["fbclid", "gclid", "msclkid"]);

function requestId() {
  try {
    return `gw_${crypto.randomUUID().slice(0, 18)}`;
  } catch {
    return `gw_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
  }
}

function errorCodeFor(result) {
  if (!result || result.ok !== false) return "";
  const error = String(result.error || "").toLowerCase();
  if (result.status === 401) return "UNAUTHORIZED";
  if (result.status === 429) return "RATE_LIMITED";
  if (/private|credentials in urls|only http\(s\) urls/.test(error)) return "BLOCKED_URL";
  if (result.status === 415 || /unsupported content-type|pdf content/.test(error)) return "UNSUPPORTED_CONTENT_TYPE";
  if (result.status === 413 || /too large/.test(error)) return "PAGE_TOO_LARGE";
  if (/all search providers failed/.test(error)) return "ALL_PROVIDERS_FAILED";
  if (result.status === 400 || /required|invalid|unsupported provider|unsupported fetch mode|too long|content-type must/.test(error)) return "INVALID_INPUT";
  return "FETCH_FAILED";
}

function suggestedActionFor(code) {
  return {
    UNAUTHORIZED: "configure_search_gateway_token",
    RATE_LIMITED: "retry_after_delay",
    BLOCKED_URL: "choose_public_http_url",
    UNSUPPORTED_CONTENT_TYPE: "use_pdf_pipeline",
    PAGE_TOO_LARGE: "retry_with_smaller_limit_or_external_pipeline",
    DYNAMIC_PAGE: "try_archive_or_browser_rendering",
    FETCH_FAILED: "try_another_result_or_retry_later",
    ALL_PROVIDERS_FAILED: "retry_with_different_provider_or_query",
    INVALID_INPUT: "fix_request_parameters",
  }[code] || "inspect_error";
}

function withAgentMeta(result, id) {
  const out = { ...result, request_id: result.request_id || id };
  const code = errorCodeFor(out);
  if (code) {
    out.error_code = out.error_code || code;
    out.suggested_action = out.suggested_action || suggestedActionFor(code);
  }
  return out;
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
  };
}

function clampLimit(value, fallback = DEFAULT_LIMIT) {
  const n = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), MAX_LIMIT);
}

function providerTimeoutMs(value, fallback) {
  const n = Number.parseInt(value ?? fallback, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, MIN_PROVIDER_TIMEOUT_MS), MAX_PROVIDER_TIMEOUT_MS);
}

async function withTimeout(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function decodeHtmlEntities(input) {
  return String(input || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try { return String.fromCodePoint(Number.parseInt(hex, 16)); } catch { return ""; }
    })
    .replace(/&#([0-9]+);/g, (_, dec) => {
      try { return String.fromCodePoint(Number.parseInt(dec, 10)); } catch { return ""; }
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&hellip;/gi, "…")
    .replace(/&ldquo;/gi, "“")
    .replace(/&rdquo;/gi, "”")
    .replace(/&lsquo;/gi, "‘")
    .replace(/&rsquo;/gi, "’");
}

function cleanText(input) {
  return decodeHtmlEntities(String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractBodyHtml(html) {
  return html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || html;
}

function normalizeCharset(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/^['"]|['"]$/g, "");
  if (!raw) return "utf-8";
  if (["gb2312", "gbk", "gb18030"].includes(raw)) return "gb18030";
  if (raw === "utf8") return "utf-8";
  return raw;
}

function charsetFromContentType(contentType) {
  return normalizeCharset(String(contentType || "").match(/charset\s*=\s*([^;]+)/i)?.[1] || "");
}

function charsetFromHtmlPrefix(text) {
  return normalizeCharset(text.match(/<meta[^>]+charset=["']?\s*([^\s"'>;]+)/i)?.[1]
    || text.match(/<meta[^>]+http-equiv=["']content-type["'][^>]+content=["'][^"']*charset=([^\s"';>]+)/i)?.[1]
    || text.match(/<meta[^>]+content=["'][^"']*charset=([^\s"';>]+)["'][^>]+http-equiv=["']content-type["']/i)?.[1]
    || "");
}

function decodeBytes(bytes, charset = "utf-8") {
  const label = normalizeCharset(charset);
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function extractBaseUrl(html, finalUrl = "") {
  const href = cleanText(String(html || "").match(/<base[^>]+href=["']([^"']+)["']/i)?.[1] || "");
  if (!href) return finalUrl;
  try {
    const url = new URL(decodeHtmlEntities(href), finalUrl);
    if (!["http:", "https:"].includes(url.protocol)) return finalUrl;
    return isBlockedUrl(url.toString()) ? finalUrl : url.toString();
  } catch {
    return finalUrl;
  }
}

function jsonLdCandidates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(jsonLdCandidates);
  if (typeof value !== "object") return [];
  const graph = value["@graph"] ? jsonLdCandidates(value["@graph"]) : [];
  return [value, ...graph];
}

function jsonLdAuthorName(author) {
  if (!author) return "";
  if (typeof author === "string") return cleanText(author);
  if (Array.isArray(author)) return author.map(jsonLdAuthorName).filter(Boolean).join(", ");
  if (typeof author === "object") return cleanText(author.name || author["@id"] || "");
  return "";
}

function extractJsonLdMeta(html) {
  const scripts = String(html || "").matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      const parsed = JSON.parse(decodeHtmlEntities(match[1]).trim());
      const candidates = jsonLdCandidates(parsed);
      const article = candidates.find((item) => {
        const type = Array.isArray(item["@type"]) ? item["@type"].join(" ") : String(item["@type"] || "");
        return /Article|NewsArticle|BlogPosting|Report|ScholarlyArticle/i.test(type);
      }) || candidates[0];
      if (!article || typeof article !== "object") continue;
      return {
        title: cleanText(article.headline || article.name || ""),
        description: cleanText(article.description || ""),
        published_at: normalizeDate(article.datePublished || article.dateCreated || ""),
        modified_at: normalizeDate(article.dateModified || article.dateUpdated || ""),
        author: jsonLdAuthorName(article.author || article.creator),
      };
    } catch {
      continue;
    }
  }
  return {};
}

function extractPageMeta(html, finalUrl = "") {
  const jsonLd = extractJsonLdMeta(html);
  const attr = (pattern) => cleanText(html.match(pattern)?.[1] || "");
  const h1Title = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const canonical = attr(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i)
    || attr(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["']/i);
  const ogImage = attr(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || attr(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return {
    title: jsonLd.title
      || attr(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || attr(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)
      || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      || h1Title,
    description: jsonLd.description
      || attr(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || attr(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)
      || attr(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)
      || attr(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i),
    canonical_url: resolveMaybeUrl(canonical || finalUrl, finalUrl),
    lang: attr(/<html[^>]+lang=["']([^"']+)["']/i),
    published_at: jsonLd.published_at || normalizeDate(attr(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)["']/i)
      || attr(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:published_time["']/i)
      || attr(/<time[^>]+datetime=["']([^"']+)["']/i)),
    author: jsonLd.author || attr(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']*)["']/i)
      || attr(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']author["']/i),
    site_name: attr(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i)
      || attr(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:site_name["']/i),
    modified_at: jsonLd.modified_at || normalizeDate(attr(/<meta[^>]+property=["']article:modified_time["'][^>]+content=["']([^"']+)["']/i)
      || attr(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']article:modified_time["']/i)
      || attr(/<meta[^>]+property=["']og:updated_time["'][^>]+content=["']([^"']+)["']/i)
      || attr(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:updated_time["']/i)),
    og_image: safeExternalImageUrl(ogImage ? new URL(ogImage, finalUrl || "https://example.invalid").toString() : ""),
  };
}

function contentScore(html) {
  const text = cleanText(html);
  if (!text) return 0;
  const linkTextLength = [...String(html || "").matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .reduce((sum, match) => sum + cleanText(match[1]).length, 0);
  const linkDensity = Math.min(linkTextLength / text.length, 1);
  const paragraphBonus = Math.min((String(html || "").match(/<p\b/gi) || []).length, 6) * 20;
  const headingBonus = Math.min((String(html || "").match(/<h[1-6]\b/gi) || []).length, 4) * 15;
  return text.length * (1 - linkDensity) + paragraphBonus + headingBonus;
}

function extractMainHtml(html) {
  const body = extractBodyHtml(String(html || "").slice(0, MAX_EXTRACT_HTML_CHARS))
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<[^>]+role=["']main["'][^>]*>([\s\S]*?)<\/[^>]+>/gi,
    /<div[^>]+class=["'][^"']*(?:post-content|post-body|post__content|article-body|article__body|article-content|entry-content|entry-text|content-body|main-content|page-content|story-body|td-post-content|hentry|prose|markdown-body|gh-content|e-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<[a-z][^>]+itemprop=["']articleBody["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi,
  ];
  const candidates = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(body)) !== null) candidates.push(match[1]);
    if (candidates.length) break;
  }
  return candidates.sort((a, b) => contentScore(b) - contentScore(a))[0] || body;
}

function resolveMaybeUrl(href, baseUrl) {
  try {
    const url = new URL(decodeHtmlEntities(href || ""), baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const canonical = canonicalizeUrl(url.toString());
    return canonical && !isBlockedUrl(canonical) ? canonical : "";
  } catch {
    return "";
  }
}

function markdownCell(value) {
  return cleanText(value).replace(/\|/g, "\\|");
}

function tableToMarkdown(tableHtml) {
  const rows = [...String(tableHtml || "").matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => markdownCell(cell[1])))
    .filter((row) => row.length);
  if (!rows.length) return cleanText(tableHtml);
  const columnCount = Math.max(...rows.map((row) => row.length));
  if (columnCount > 8 || /colspan|rowspan/i.test(tableHtml)) {
    return rows.map((row) => row.filter(Boolean).join(" | ")).join("\n");
  }
  const normalized = rows.map((row) => [...row, ...Array(columnCount - row.length).fill("")]);
  const header = normalized[0];
  const body = normalized.slice(1);
  return [
    `| ${header.join(" | ")} |`,
    `| ${Array(columnCount).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function orderedListToMarkdown(html) {
  let n = 0;
  return [...String(html || "").matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((item) => `${++n}. ${cleanText(item[1])}`)
    .join("\n");
}

function blockquoteToMarkdown(html) {
  const text = htmlToMarkdown(html).replace(/\n{2,}/g, "\n").trim();
  return text ? text.split("\n").map((line) => `> ${line}`).join("\n") : "";
}

function htmlToMarkdown(html, baseUrl = "") {
  const src = String(html || "").slice(0, MAX_EXTRACT_HTML_CHARS)
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const protectedBlocks = [];
  const protect = (value) => {
    const token = `\uE000${protectedBlocks.length}\uE000`;
    protectedBlocks.push(value);
    return token;
  };
  let out = src
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, (table) => protect(`\n\n${tableToMarkdown(table)}\n\n`))
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, quote) => protect(`\n\n${blockquoteToMarkdown(quote)}\n\n`))
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, list) => protect(`\n\n${orderedListToMarkdown(list)}\n\n`))
    .replace(/<pre[^>]*>[\s\S]*?<code[^>]*>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/gi, (_, code) => protect(`\n\n\`\`\`\n${cleanText(code)}\n\`\`\`\n\n`))
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => protect(`\n\n\`\`\`\n${cleanText(code)}\n\`\`\`\n\n`))
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
      const label = cleanText(text);
      const resolved = resolveMaybeUrl(href, baseUrl);
      return label && resolved ? `[${label}](${resolved})` : label;
    })
    .replace(/<img[^>]+alt=["']([^"']*)["'][^>]*>/gi, (_, alt) => cleanText(alt) ? `[image: ${cleanText(alt)}]` : "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `\n\n# ${cleanText(text)}\n\n`)
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `\n\n## ${cleanText(text)}\n\n`)
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `\n\n### ${cleanText(text)}\n\n`)
    .replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, (_, text) => `\n\n#### ${cleanText(text)}\n\n`)
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => `**${cleanText(text)}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, text) => `_${cleanText(text)}_`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, text) => `\`${cleanText(text)}\``)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => `\n- ${cleanText(text)}`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|main|blockquote|ul|ol)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
  protectedBlocks.forEach((value, index) => {
    out = out.replaceAll(`\uE000${index}\uE000`, value);
  });
  return decodeHtmlEntities(out)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateAtSentence(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) return { text: value, truncated: false, last_heading: "" };
  const slice = value.slice(0, maxChars);
  const boundaries = ["\n\n", "\n", "。", "！", "？", ". ", "! ", "? ", "; ", "；"];
  let cut = -1;
  for (const boundary of boundaries) {
    const idx = slice.lastIndexOf(boundary);
    if (idx > cut) cut = idx + boundary.trimEnd().length;
  }
  if (cut < Math.floor(maxChars * 0.45)) cut = maxChars;
  const result = slice.slice(0, cut).trimEnd();
  const headings = [...result.matchAll(/^#{1,4} (.+)$/gm)];
  const lastHeading = headings.length ? headings[headings.length - 1][1].trim() : "";
  return { text: result, truncated: true, last_heading: lastHeading };
}

function detectDynamicPage(html, text) {
  const body = extractBodyHtml(html);
  const emptySpaRoot = /<div[^>]+id=["'](?:root|app|__next|__nuxt)["'][^>]*>\s*<\/div>/i.test(body);
  const spaRoot = /<div[^>]+id=["'](?:root|app|__next|__nuxt)["'][^>]*>/i.test(body);
  const frameworkMarker = /data-reactroot|data-v-[a-f0-9]{6,}|ng-version=|x-data=|v-cloak|__NEXT_DATA__|__NUXT__/i.test(body);
  const bodyTextLength = cleanText(body).length;
  const extractedTextLength = cleanText(text).length;
  const lowTextYield = html.length > 8000 && bodyTextLength / html.length < 0.04;
  const sparseLargePage = bodyTextLength < 150 && html.length > 6000;
  const sparseFrameworkShell = frameworkMarker && spaRoot && extractedTextLength < 300;
  const isDynamic = emptySpaRoot || sparseLargePage || sparseFrameworkShell || (frameworkMarker && lowTextYield);
  return isDynamic ? {
    is_dynamic: true,
    hint: "Page appears JS-rendered; use browser rendering/headless fetch if available.",
  } : { is_dynamic: false, hint: "" };
}

function sourceOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function rankHost(result) {
  const host = sourceOf(result.canonical_url || result.url || "") || result.source || result.site_name || "";
  return String(host || "").toLowerCase().replace(/^www\./, "");
}

function credibilityScore(result) {
  const host = rankHost(result);
  if (!host) return 0;
  if (host === "github.com" || host.endsWith(".github.com")) return 6;
  if (host.endsWith(".gov") || host.includes(".gov.")) return 6;
  if (host.endsWith(".edu") || host.includes(".edu.")) return 5;
  if (host.startsWith("docs.") || host.includes(".docs.")) return 4;
  if (host.startsWith("developer.") || host.startsWith("developers.")) return 4;
  return 0;
}

function spamPenalty(result) {
  const host = rankHost(result);
  const text = `${host} ${result.title || ""}`.toLowerCase();
  const patterns = [
    /free-download|download-free/,
    /\bcoupon\b/,
    /\bseo\b/,
    /best-ultimate/,
    /\bcrack\b/,
    /\btorrent\b/,
  ];
  return patterns.some((pattern) => pattern.test(text)) ? -10 : 0;
}

function canonicalizeUrl(input) {
  try {
    const url = new URL(input);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return "";
  }
}

function authConfigured(env) {
  return Boolean(env.SEARCH_GATEWAY_TOKEN);
}

function configuredGatewayMode(env) {
  const mode = String(env.SEARCH_GATEWAY_MODE || "").trim().toLowerCase();
  if (["public", "open"].includes(mode)) return "public";
  if (["private", "bearer", "secure"].includes(mode)) return "private";
  if (String(env.SEARCH_GATEWAY_ALLOW_OPEN || "").toLowerCase() === "true") return "public";
  return authConfigured(env) ? "private" : "public";
}

function authRequired(env) {
  return configuredGatewayMode(env) === "private";
}

function isAuthorized(request, env) {
  if (!authRequired(env)) return true;
  const expected = env.SEARCH_GATEWAY_TOKEN;
  if (!expected) return false;
  const auth = request.headers.get("authorization") || "";
  return auth === `Bearer ${expected}`;
}

async function readJson(request, maxBodyChars = MAX_JSON_BODY_CHARS) {
  const ctype = request.headers.get("content-type") || "";
  if (!ctype.includes("application/json")) {
    throw new Error("content-type must be application/json");
  }
  const contentLength = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (contentLength > maxBodyChars) {
    throw new Error(`request body too large; max ${maxBodyChars} bytes`);
  }
  const text = await readTextLimited(new Response(request.body, { headers: request.headers }), maxBodyChars);
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error("invalid json body");
  }
}

function isSupportedProvider(provider) {
  return provider === "auto" || SEARCH_PROVIDERS.includes(provider);
}

function isTextContentType(contentType) {
  const value = String(contentType || "").toLowerCase().split(";")[0].trim();
  if (!value) return false;
  return FETCH_TEXT_CONTENT_TYPES.some((allowed) => allowed.endsWith("/") ? value.startsWith(allowed) : value === allowed);
}

function hasCjk(text) {
  return /[\u3400-\u9fff]/.test(String(text || ""));
}

function normalizeLanguage(value, query = "") {
  const raw = String(value || "auto").trim();
  if (!raw || raw.toLowerCase() === "auto") return hasCjk(query) ? "zh-CN" : "en-US";
  return raw;
}

function normalizeFreshness(value, query = "") {
  const raw = String(value || "none").toLowerCase().trim();
  if (raw === "auto") {
    return /(latest|recent|today|this week|this month|news|最新|最近|今天|本周|本月|新闻|刚刚|当前)/i.test(query) ? "month" : "none";
  }
  return SUPPORTED_FRESHNESS.has(raw) ? raw : "none";
}

function daysForFreshness(freshness) {
  return { day: 1, week: 7, month: 31, year: 366 }[freshness] || 0;
}

function dateDaysAgo(days) {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function normalizeDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = String(value).trim();
  if (!text) return "";

  const now = Date.now();
  const relative = text.toLowerCase().match(/^(?:about\s+|approximately\s+)?(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months|year|years)\s+ago$/);
  if (relative) {
    const amount = Number.parseInt(relative[1], 10);
    const unitDays = { minute: 1 / 1440, minutes: 1 / 1440, hour: 1 / 24, hours: 1 / 24, day: 1, days: 1, week: 7, weeks: 7, month: 31, months: 31, year: 366, years: 366 }[relative[2]];
    return new Date(now - amount * unitDays * 24 * 60 * 60 * 1000).toISOString();
  }
  if (/^yesterday$/i.test(text)) return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  if (/^(today|just now)$/i.test(text)) return new Date(now).toISOString();

  const zhRelative = text.match(/^(?:(\d+)\s*)?(分钟|小时|天|周|星期|个月|月|年)前$/);
  if (zhRelative) {
    const amount = Number.parseInt(zhRelative[1] || "1", 10);
    const unitDays = { "分钟": 1 / 1440, "小时": 1 / 24, "天": 1, "周": 7, "星期": 7, "个月": 31, "月": 31, "年": 366 }[zhRelative[2]];
    return new Date(now - amount * unitDays * 24 * 60 * 60 * 1000).toISOString();
  }
  if (/^(昨天|昨日)$/.test(text)) return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  if (/^(今天|刚刚|刚)$/.test(text)) return new Date(now).toISOString();

  const zhDate = text.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日?/);
  if (zhDate) {
    const [, year, month, day] = zhDate;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).toISOString();
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return text;
}

function safeExternalImageUrl(input) {
  const url = canonicalizeUrl(input || "");
  if (!url) return "";
  try {
    return isBlockedUrl(url) ? "" : url;
  } catch {
    return "";
  }
}

function responseTooLargeError(maxBytes) {
  const error = new Error(`response too large; max ${maxBytes} bytes`);
  error.status = 413;
  return error;
}

async function readTextLimited(response, maxBytes) {
  const declaredLength = Number.parseInt(response.headers.get("content-length") || "0", 10);
  if (declaredLength > maxBytes) throw responseTooLargeError(maxBytes);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw responseTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headerCharset = charsetFromContentType(response.headers.get("content-type") || "");
  if (headerCharset !== "utf-8") return decodeBytes(bytes, headerCharset);
  const prefix = decodeBytes(bytes.slice(0, Math.min(bytes.length, 2048)), "utf-8");
  const metaCharset = charsetFromHtmlPrefix(prefix);
  return decodeBytes(bytes, metaCharset || headerCharset);
}

async function readJsonLimited(response, maxBytes, label = "json response") {
  const text = await readTextLimited(response, maxBytes);
  try {
    return JSON.parse(text || "{}");
  } catch {
    throw new Error(`${label} returned invalid json`);
  }
}

function parseIpv4(host) {
  const match = String(host || "").match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const parts = match.slice(1).map((part) => Number.parseInt(part, 10));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isBlockedIpv4(parts) {
  if (!parts) return false;
  const [a, b, c, d] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224
    || (a === 255 && b === 255 && c === 255 && d === 255);
}

function html(data, status = 200, extraHeaders = {}) {
  return new Response(data, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function setupPage(env) {
  const mode = configuredGatewayMode(env);
  const tokenConfigured = authConfigured(env);
  const base = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>search-gateway setup</title>
  <style>
    body{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:860px;margin:40px auto;padding:0 20px;line-height:1.55;color:#17202a;background:#f8fafc}
    main{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:28px;box-shadow:0 12px 32px rgba(15,23,42,.06)}
    h1{margin-top:0;font-size:2rem}.muted{color:#64748b}.pill{display:inline-block;border-radius:999px;padding:4px 10px;background:#e0f2fe;color:#075985;font-size:.85rem;font-weight:700}
    code,pre{background:#0f172a;color:#e2e8f0;border-radius:10px}code{padding:2px 5px}pre{padding:14px;overflow:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.card{border:1px solid #e5e7eb;border-radius:12px;padding:14px;background:#fbfdff}a{color:#2563eb}
  </style>
</head>
<body><main>
  <p><span class="pill">search-gateway v${WORKER_VERSION}</span></p>
  <h1>Your Cloudflare search gateway is running.</h1>
  <p class="muted">A public-by-default one-click Cloudflare search/fetch gateway template, with private hardening and upstream-update workflow for long-running personal deployments.</p>
  <div class="grid">
    <section class="card"><strong>Mode</strong><br>${mode}${mode === "private" ? (tokenConfigured ? " · token configured" : " · token missing") : " · open access"}</section>
    <section class="card"><strong>Health</strong><br><a href="/health">GET /health</a></section>
    <section class="card"><strong>Endpoints</strong><br><code>POST /search</code><br><code>POST /fetch</code><br><code>POST /rerank</code><br><code>GET /balance</code><br><code>POST /batch_fetch</code><br><code>POST /search_fetch</code></section>
  </div>
  <h2>Smoke test</h2>
  <pre>curl -s "$WORKER_URL/health"
curl -s "$WORKER_URL/search" \\
  -H 'content-type: application/json' \\
  -d '{"query":"Cloudflare Workers docs","limit":3}'</pre>
  <h2>Private mode</h2>
  <pre>SEARCH_GATEWAY_MODE=private
SEARCH_GATEWAY_TOKEN=&lt;random-secret&gt;

curl -s "$WORKER_URL/search" \\
  -H "authorization: Bearer <token>" \\
  -H 'content-type: application/json' \\
  -d '{"query":"Cloudflare Workers docs","limit":3}'</pre>
  <p class="muted">Configure variables in Cloudflare Dashboard → Worker → Settings → Variables and Secrets. Keep tokens/API keys as Secrets.</p>
</main></body></html>`;
  return base;
}

function healthPayload(env, includeConfig = false) {
  const base = {
    ok: true,
    service: "search-gateway",
    version: WORKER_VERSION,
    endpoints: {
      health: "/health",
      search: "/search",
      fetch: "/fetch",
      rerank: "/rerank",
      balance: "/balance",
      batch_fetch: "/batch_fetch",
      search_fetch: "/search_fetch",
    },
    capabilities: {
      search_modes: ["fast", "balanced", "thorough"],
      rerank_providers: RERANK_PROVIDERS,
      canonical_dedupe: true,
      provider_diagnostics: true,
      freshness: ["none", "auto", "day", "week", "month", "year"],
      language_routing: true,
      citation_fields: ["published_at", "author", "site_name", "image_url", "retrieved_at"],
      no_key_search: true,
      searxng_json_api: true,
      zhipu_web_search_api: true,
      bocha_web_search_api: true,
      bocha_ai_search_api: true,
      bocha_rerank_api: true,
      balance_api: true,
      html_search_fallbacks: ["duckduckgo", "bing"],
      fetch_non_2xx_text: true,
      fetch_content_type_allowlist: true,
      request_size_limits: {
        max_json_body_chars: MAX_JSON_BODY_CHARS,
        max_query_chars: MAX_QUERY_CHARS,
        max_url_chars: MAX_URL_CHARS,
        max_fetch_response_bytes: MAX_FETCH_RESPONSE_BYTES,
        max_search_html_bytes: MAX_SEARCH_HTML_BYTES,
        max_provider_json_bytes: MAX_PROVIDER_JSON_BYTES,
        search_provider_timeout_ms: providerTimeoutMs(env.SEARCH_PROVIDER_TIMEOUT_MS, DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS),
        rerank_provider_timeout_ms: providerTimeoutMs(env.RERANK_PROVIDER_TIMEOUT_MS, DEFAULT_RERANK_PROVIDER_TIMEOUT_MS),
      },
      ssrf_protection: true,
    },
    time: new Date().toISOString(),
  };
  if (!includeConfig) return base;
  return {
    ...base,
    providers: {
      searxng: Boolean(env.SEARXNG_URL),
      zhipu: Boolean(env.ZHIPU_API_KEY),
      bocha: Boolean(env.BOCHA_API_KEY),
      bocha_ai: Boolean(env.BOCHA_API_KEY),
      bocha_rerank: Boolean(env.BOCHA_API_KEY),
      cohere_rerank: Boolean(env.COHERE_API_KEY),
      jina_rerank: Boolean(env.JINA_API_KEY),
      voyage_rerank: Boolean(env.VOYAGE_API_KEY),
      siliconflow_rerank: Boolean(env.SILICONFLOW_API_KEY),
      balance: Boolean(env.BOCHA_API_KEY),
      brave: Boolean(env.BRAVE_SEARCH_API_KEY),
      serper: Boolean(env.SERPER_API_KEY),
      tavily: Boolean(env.TAVILY_API_KEY),
      duckduckgo: true,
      bing: true,
    },
    provider_order: configuredProviders("auto", env),
    auth_configured: authConfigured(env),
    auth_required: authRequired(env),
    auth_mode: authRequired(env) ? (authConfigured(env) ? "bearer" : "private_unconfigured") : "public",
    setup: authRequired(env) ? (authConfigured(env) ? {
      status: "secure",
      message: "Private mode is enabled. Authenticated endpoints require Authorization: Bearer ***",
    } : {
      status: "token_required",
      message: "Private mode is enabled but SEARCH_GATEWAY_TOKEN is not configured. Add the Worker secret, or set SEARCH_GATEWAY_MODE=public for an open gateway.",
    }) : {
      status: "public_mode",
      message: "Public mode is enabled. Anyone with the Worker URL can use search/fetch endpoints. For personal use, set SEARCH_GATEWAY_MODE=private and add SEARCH_GATEWAY_TOKEN.",
    },
    optional_kv_rate_limit: Boolean(env.SEARCH_RATE_LIMIT_KV || env.RATE_LIMIT_KV),
  };
}

async function checkRateLimit(request, env, path, request_id = requestId()) {
  const kv = env.SEARCH_RATE_LIMIT_KV || env.RATE_LIMIT_KV;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") return null;
  const limit = Number.parseInt(env.SEARCH_RATE_LIMIT_PER_MINUTE || "60", 10);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const minute = Math.floor(Date.now() / 60000);
  const key = `rl:${path}:${ip}:${minute}`;
  const current = Number.parseInt(await kv.get(key) || "0", 10) || 0;
  if (current >= limit) {
    return json(withAgentMeta({ ok: false, status: 429, error: "rate limit exceeded", retry_after_seconds: 60 }, request_id), 429, { "retry-after": "60" });
  }
  await kv.put(key, String(current + 1), { expirationTtl: 120 });
  return null;
}

async function cachedFetch(request, ttlSeconds = 300) {
  if (typeof caches === "undefined" || !caches.default) {
    return fetch(request);
  }
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const copy = new Response(response.body, response);
    copy.headers.set("cache-control", `public, max-age=${ttlSeconds}`);
    await cache.put(request, copy.clone());
    return copy;
  }
  return response;
}

function normalizeResult(item, provider) {
  const url = item.url || item.link || item.href || "";
  const canonicalUrl = canonicalizeUrl(url);
  return {
    title: cleanText(item.title || item.name || ""),
    url,
    canonical_url: canonicalUrl,
    snippet: cleanText(item.snippet || item.description || item.body || item.content || ""),
    source: item.source || item.site_name || sourceOf(url),
    provider,
    providers: [provider],
    published_at: normalizeDate(item.published_at || item.published || item.date || item.age || ""),
    author: cleanText(item.author || item.profile?.name || ""),
    site_name: cleanText(item.site_name || item.source || sourceOf(url)),
    image_url: safeExternalImageUrl(item.image_url || item.thumbnail?.src || item.thumbnail || ""),
    retrieved_at: new Date().toISOString(),
  };
}

function cjkTokens(text) {
  const tokens = [];
  for (const match of String(text || "").matchAll(/[\u3400-\u9fff]+/g)) {
    const run = match[0];
    if (run.length === 1) {
      tokens.push(run);
      continue;
    }
    for (let index = 0; index < run.length - 1; index += 1) tokens.push(run.slice(index, index + 2));
  }
  return tokens;
}

function queryTokens(query) {
  const value = String(query || "").toLowerCase();
  const ascii = value.match(/[a-z0-9]+/g) || [];
  return [...new Set([...ascii.filter((token) => token.length > 1), ...cjkTokens(value)])];
}

function tokenHits(text, tokens) {
  const value = String(text || "").toLowerCase();
  return tokens.reduce((count, token) => count + (value.includes(token) ? 1 : 0), 0);
}

function recencyScore(result, freshness) {
  const windowDays = daysForFreshness(freshness);
  if (!windowDays || !result.published_at) return 0;
  const parsed = new Date(result.published_at);
  if (Number.isNaN(parsed.getTime())) return 0;
  const ageDays = Math.max(0, (Date.now() - parsed.getTime()) / (24 * 60 * 60 * 1000));
  if (ageDays <= windowDays) return 6;
  if (ageDays >= windowDays * 2) return 0;
  return 6 * (1 - ((ageDays - windowDays) / windowDays));
}

function urlConsensusScore(result) {
  const providerCount = new Set(result.providers || []).size;
  return Math.min(Math.max(0, providerCount - 1) * 4, 8);
}

function hostConsensusScore(result) {
  const providerCount = new Set(result.providers || []).size;
  const hostProviderCount = Number(result._host_provider_count || 0);
  return Math.min(Math.max(0, hostProviderCount - providerCount) * 2, 4);
}

function resultScore(result, tokens, freshness = "none") {
  return tokenHits(result.title, tokens) * 10
    + tokenHits(result.snippet, tokens) * 2
    + urlConsensusScore(result)
    + hostConsensusScore(result)
    + recencyScore(result, freshness)
    + credibilityScore(result)
    + spamPenalty(result);
}

function betterText(current, next) {
  if (!current) return next || "";
  if (!next) return current;
  return next.length > current.length ? next : current;
}

function diversifyResults(sorted, limit) {
  const primary = [];
  const overflow = [];
  const counts = new Map();
  const cap = limit > 2 ? 2 : limit;
  for (const result of sorted) {
    const host = rankHost(result);
    const count = counts.get(host) || 0;
    if (host && count >= cap) {
      overflow.push(result);
      continue;
    }
    primary.push(result);
    counts.set(host, count + 1);
  }
  return [...primary, ...overflow].slice(0, limit);
}

function mergeRankResults(results, query, limit, freshness = "none") {
  const tokens = queryTokens(query);
  const merged = new Map();

  results.forEach((result, index) => {
    const canonicalUrl = result.canonical_url || canonicalizeUrl(result.url);
    if (!canonicalUrl) return;
    const existing = merged.get(canonicalUrl);
    if (!existing) {
      merged.set(canonicalUrl, {
        ...result,
        canonical_url: canonicalUrl,
        url: canonicalUrl,
        source: result.source || sourceOf(canonicalUrl),
        providers: [...new Set(result.providers || [result.provider])],
        _rank: index,
      });
      return;
    }
    const providers = [...existing.providers];
    for (const provider of result.providers || [result.provider]) {
      if (provider && !providers.includes(provider)) providers.push(provider);
    }
    existing.providers = providers;
    existing.provider = existing.provider || result.provider;
    existing.title = betterText(existing.title, result.title);
    existing.snippet = betterText(existing.snippet, result.snippet);
    existing.source = existing.source || result.source || sourceOf(canonicalUrl);
    existing.site_name = existing.site_name || result.site_name || result.source || sourceOf(canonicalUrl);
    existing.author = existing.author || result.author || "";
    existing.image_url = existing.image_url || result.image_url || "";
    existing.published_at = existing.published_at || result.published_at || "";
    existing.retrieved_at = existing.retrieved_at || result.retrieved_at || new Date().toISOString();
    existing._rank = Math.min(existing._rank, index);
  });

  const hostProviders = new Map();
  for (const result of merged.values()) {
    const host = rankHost(result);
    if (!host) continue;
    const providers = hostProviders.get(host) || new Set();
    for (const provider of result.providers || []) {
      if (provider) providers.add(provider);
    }
    hostProviders.set(host, providers);
  }

  const sorted = [...merged.values()]
    .map((result) => {
      const host = rankHost(result);
      const hostProviderCount = host ? (hostProviders.get(host)?.size || 0) : 0;
      return { ...result, _host_provider_count: hostProviderCount, _score: resultScore({ ...result, _host_provider_count: hostProviderCount }, tokens, freshness) };
    })
    .sort((a, b) => b._score - a._score || a._rank - b._rank || a.canonical_url.localeCompare(b.canonical_url));
  return diversifyResults(sorted, limit)
    .map(({ _rank, _score, _host_provider_count, ...result }) => result);
}

function isRerankProviderConfigured(provider, env) {
  if (provider === "bocha_rerank") return Boolean(env.BOCHA_API_KEY);
  if (provider === "cohere_rerank") return Boolean(env.COHERE_API_KEY);
  if (provider === "jina_rerank") return Boolean(env.JINA_API_KEY);
  if (provider === "voyage_rerank") return Boolean(env.VOYAGE_API_KEY);
  if (provider === "siliconflow_rerank") return Boolean(env.SILICONFLOW_API_KEY);
  return false;
}

function configuredRerankProviders(requested, env) {
  const value = String(requested ?? "auto").toLowerCase();
  if (["false", "off", "none", "disabled", "0"].includes(value)) return [];
  if (value === "auto" || value === "true" || value === "1") return RERANK_PROVIDERS.filter((provider) => isRerankProviderConfigured(provider, env));
  return value.split(",").map((item) => item.trim()).filter(Boolean)
    .filter((provider) => RERANK_PROVIDERS.includes(provider) && isRerankProviderConfigured(provider, env));
}

function rerankDocumentForResult(result) {
  return cleanText([
    result.title,
    result.snippet,
    result.source || result.site_name,
    result.published_at ? `Published: ${result.published_at}` : "",
  ].filter(Boolean).join("\n"));
}

async function rerankProvider(provider, query, results, env) {
  const documents = results.map(rerankDocumentForResult);
  return callRerankProvider(provider, query, documents, env, { top_n: results.length, return_documents: false });
}

function aggregateRerankVotes(results, providerOutputs) {
  const totals = new Array(results.length).fill(0);
  const counts = new Array(results.length).fill(0);
  for (const output of providerOutputs) {
    const scores = output.results.map((item) => Number(item.relevance_score || 0));
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const span = max - min;
    output.results.forEach((item, rank) => {
      const index = item.index;
      if (!Number.isInteger(index) || index < 0 || index >= results.length) return;
      const raw = Number(item.relevance_score || 0);
      const normalized = span > 0 ? (raw - min) / span : Math.max(0, Math.min(1, raw));
      const rankSignal = 1 / (rank + 1);
      totals[index] += (0.8 * normalized) + (0.2 * rankSignal);
      counts[index] += 1;
    });
  }
  return results.map((result, index) => ({
    ...result,
    _base_rank: index,
    _rerank_score: counts[index] ? totals[index] / providerOutputs.length : 0,
  })).sort((a, b) => b._rerank_score - a._rerank_score || a._base_rank - b._base_rank);
}

async function maybeRerankResults(results, query, limit, body, env, warnings) {
  if (!results.length) return { results, providers_used: [] };
  const providers = configuredRerankProviders(body.rerank, env);
  if (!providers.length) return { results: results.slice(0, limit), providers_used: [] };
  const timeoutMs = providerTimeoutMs(env.RERANK_PROVIDER_TIMEOUT_MS, DEFAULT_RERANK_PROVIDER_TIMEOUT_MS);
  const settled = await Promise.all(providers.map(async (provider) => {
    try {
      const output = await withTimeout(rerankProvider(provider, query, results, env), timeoutMs, provider);
      return { provider, output };
    } catch (error) {
      return { provider, warning: `${provider}: ${error.message}` };
    }
  }));
  warnings.push(...settled.map((item) => item.warning).filter(Boolean));
  const successful = settled.filter((item) => item.output?.results?.length > 0);
  if (!successful.length) return { results: results.slice(0, limit), providers_used: [] };
  const ranked = aggregateRerankVotes(results, successful.map((item) => item.output));
  return {
    results: diversifyResults(ranked, limit).map(({ _base_rank, _rerank_score, ...result }) => ({ ...result, rerank_score: _rerank_score })),
    providers_used: successful.map((item) => item.provider),
  };
}

function isProviderConfigured(provider, env) {
  if (provider === "searxng") return Boolean(env.SEARXNG_URL);
  if (provider === "zhipu") return Boolean(env.ZHIPU_API_KEY);
  if (provider === "bocha") return Boolean(env.BOCHA_API_KEY);
  if (provider === "bocha_ai") return Boolean(env.BOCHA_API_KEY);
  if (provider === "brave") return Boolean(env.BRAVE_SEARCH_API_KEY);
  if (provider === "serper") return Boolean(env.SERPER_API_KEY);
  if (provider === "tavily") return Boolean(env.TAVILY_API_KEY);
  return NO_KEY_PROVIDERS.has(provider);
}

function configuredProviders(requestedProvider, env) {
  if (requestedProvider !== "auto") return [requestedProvider];
  return SEARCH_PROVIDERS.filter((provider) => isProviderConfigured(provider, env));
}

async function searchProvider(provider, query, limit, env, options = {}) {
  if (provider === "searxng") return searxngSearch(query, limit, env, options);
  if (provider === "zhipu") return zhipuSearch(query, limit, env, options);
  if (provider === "bocha") return bochaSearch(query, limit, env, options);
  if (provider === "bocha_ai") return bochaAiSearch(query, limit, env, options);
  if (provider === "brave") return braveSearch(query, limit, env, options);
  if (provider === "serper") return serperSearch(query, limit, env, options);
  if (provider === "tavily") return tavilySearch(query, limit, env, options);
  if (provider === "duckduckgo") return duckDuckGoSearch(query, limit, env, options);
  if (provider === "bing") return bingSearch(query, limit, env, options);
  throw new Error(`unsupported provider: ${provider}`);
}

function freshnessAfterDate(freshness) {
  const days = daysForFreshness(freshness);
  return days ? dateDaysAgo(days) : "";
}

async function searxngSearch(query, limit, env, options = {}) {
  if (!env.SEARXNG_URL) throw new Error("SEARXNG_URL is not configured");
  const base = String(env.SEARXNG_URL).trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(`${base}/search`);
  } catch {
    throw new Error("SEARXNG_URL is invalid");
  }
  const blocked = isBlockedUrl(url.toString());
  if (blocked) throw new Error(`SEARXNG_URL blocked: ${blocked}`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", env.SEARXNG_CATEGORIES || "general");
  url.searchParams.set("language", options.language || env.SEARXNG_LANGUAGE || "auto");
  url.searchParams.set("safesearch", env.SEARXNG_SAFESEARCH || "0");
  if (options.freshness && options.freshness !== "none") url.searchParams.set("time_range", options.freshness);
  url.searchParams.set("pageno", "1");
  const headers = { accept: "application/json" };
  if (env.SEARXNG_SECRET) headers.authorization = `Bearer ${env.SEARXNG_SECRET}`;
  const response = await cachedFetch(new Request(url, { headers, redirect: "manual" }), 180);
  if (!response.ok) throw new Error(`searxng search failed: ${response.status}`);
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "searxng");
  return (data.results || []).slice(0, limit).map((r) => normalizeResult({
    title: r.title,
    url: r.url,
    snippet: r.content,
    source: r.engine || sourceOf(r.url),
    published_at: r.publishedDate || r.published_date || r.date,
    author: r.author,
    site_name: r.engine || r.site_name,
    image_url: r.img_src || r.thumbnail,
  }, "searxng"));
}

function freshnessToZhipu(value) {
  return {
    day: "oneDay",
    week: "oneWeek",
    month: "oneMonth",
    year: "oneYear",
  }[value] || "noLimit";
}

function freshnessToBocha(value) {
  return {
    day: "oneDay",
    week: "oneWeek",
    month: "oneMonth",
    year: "oneYear",
  }[value] || "noLimit";
}

function bochaPublishedDate(result) {
  if (result?.datePublished) return result.datePublished;
  const lastCrawled = String(result?.dateLastCrawled || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(lastCrawled)) {
    return lastCrawled.replace(/Z$/, "+08:00");
  }
  return lastCrawled;
}

function base64UrlEncode(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function zhipuAuthorization(apiKey) {
  const value = String(apiKey || "").trim();
  const parts = value.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return `Bearer ${value}`;
  const now = Date.now();
  const header = { alg: "HS256", sign_type: "SIGN" };
  const payload = { api_key: parts[0], exp: now + 210 * 1000, timestamp: now };
  const encoder = new TextEncoder();
  const signingInput = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(parts[1]), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  return `Bearer ${signingInput}.${base64UrlEncode(signature)}`;
}

async function zhipuSearch(query, limit, env, options = {}) {
  if (!env.ZHIPU_API_KEY) throw new Error("ZHIPU_API_KEY is not configured");
  const payload = {
    search_engine: env.ZHIPU_SEARCH_ENGINE || "search_pro",
    search_query: query,
    count: limit,
    search_recency_filter: freshnessToZhipu(options.freshness),
    content_size: env.ZHIPU_CONTENT_SIZE || "medium",
  };
  if (env.ZHIPU_SEARCH_DOMAIN_FILTER) payload.search_domain_filter = env.ZHIPU_SEARCH_DOMAIN_FILTER;
  const response = await fetch("https://open.bigmodel.cn/api/paas/v4/web_search", {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: await zhipuAuthorization(env.ZHIPU_API_KEY),
      "x-source-channel": "search-gateway",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`zhipu search failed: ${response.status}`);
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "zhipu");
  return (data.search_result || []).map((r) => normalizeResult({
    title: r.title,
    url: r.link,
    snippet: r.content,
    published_at: r.publish_date,
    site_name: r.media,
    source: r.media,
    image_url: r.icon || (Array.isArray(r.images) ? r.images[0] : ""),
  }, "zhipu"));
}

async function bochaSearch(query, limit, env, options = {}) {
  if (!env.BOCHA_API_KEY) throw new Error("BOCHA_API_KEY is not configured");
  const payload = {
    query,
    freshness: freshnessToBocha(options.freshness),
    summary: String(env.BOCHA_SUMMARY || "false").toLowerCase() === "true",
    count: limit,
  };
  if (env.BOCHA_INCLUDE) payload.include = env.BOCHA_INCLUDE;
  if (env.BOCHA_EXCLUDE) payload.exclude = env.BOCHA_EXCLUDE;
  const response = await fetch("https://api.bochaai.com/v1/web-search", {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${env.BOCHA_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`bocha search failed: ${response.status}`);
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "bocha");
  return (data.webPages?.value || []).map((r) => normalizeResult({
    title: r.name,
    url: r.url,
    snippet: r.summary || r.snippet,
    published_at: bochaPublishedDate(r),
    site_name: r.siteName,
    source: r.siteName,
    image_url: r.siteIcon,
  }, "bocha"));
}

function parseBochaAiWebpageContent(content) {
  if (!content) return [];
  let data;
  try {
    data = typeof content === "string" ? JSON.parse(content) : content;
  } catch {
    return [];
  }
  if (Array.isArray(data?.value)) return data.value;
  if (Array.isArray(data?.webPages?.value)) return data.webPages.value;
  if (data?.url || data?.name) return [data];
  return [];
}

async function bochaAiSearch(query, limit, env, options = {}) {
  if (!env.BOCHA_API_KEY) throw new Error("BOCHA_API_KEY is not configured");
  const payload = {
    query,
    freshness: freshnessToBocha(options.freshness),
    count: limit,
    answer: String(env.BOCHA_AI_ANSWER || "false").toLowerCase() === "true",
    stream: false,
  };
  if (env.BOCHA_INCLUDE) payload.include = env.BOCHA_INCLUDE;
  const response = await fetch("https://api.bocha.cn/v1/ai-search", {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${env.BOCHA_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`bocha ai search failed: ${response.status}`);
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "bocha_ai");
  if (data.code && data.code !== 200) throw new Error(`bocha ai search failed: ${data.code} ${data.msg || ""}`.trim());
  const pages = [];
  for (const message of data.messages || []) {
    if (message?.role !== "assistant" || message?.type !== "source" || message?.content_type !== "webpage") continue;
    pages.push(...parseBochaAiWebpageContent(message.content));
  }
  return pages.slice(0, limit).map((r) => normalizeResult({
    title: r.name,
    url: r.url,
    snippet: r.summary || r.snippet,
    published_at: bochaPublishedDate(r),
    site_name: r.siteName,
    source: r.siteName,
    image_url: r.siteIcon,
  }, "bocha_ai"));
}

async function braveSearch(query, limit, env, options = {}) {
  if (!env.BRAVE_SEARCH_API_KEY) throw new Error("BRAVE_SEARCH_API_KEY is not configured");
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  if (options.language) url.searchParams.set("search_lang", options.language.split("-")[0]);
  if (options.freshness && options.freshness !== "none") {
    const braveFreshness = { day: "pd", week: "pw", month: "pm", year: "py" }[options.freshness];
    if (braveFreshness) url.searchParams.set("freshness", braveFreshness);
  }
  const response = await fetch(url, {
    redirect: "manual",
    headers: {
      accept: "application/json",
      "x-subscription-token": env.BRAVE_SEARCH_API_KEY,
    },
  });
  if (!response.ok) throw new Error(`brave search failed: ${response.status}`);
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "brave");
  return (data.web?.results || []).map((r) => normalizeResult({
    title: r.title,
    url: r.url,
    snippet: r.description,
    published_at: r.age || r.page_age || r.published,
    author: r.profile?.name,
    site_name: r.profile?.long_name || r.meta_url?.hostname,
    image_url: r.thumbnail?.src,
  }, "brave"));
}

async function serperSearch(query, limit, env, options = {}) {
  if (!env.SERPER_API_KEY) throw new Error("SERPER_API_KEY is not configured");
  const payload = { q: query, num: limit };
  if (options.language) payload.gl = options.language.toLowerCase().startsWith("zh") ? "cn" : "us";
  if (options.freshness && options.freshness !== "none") {
    const tbs = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" }[options.freshness];
    if (tbs) payload.tbs = tbs;
  }
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.SERPER_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`serper search failed: ${response.status}`);
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "serper");
  return (data.organic || []).map((r) => normalizeResult({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
    published_at: r.date,
    site_name: r.source,
    image_url: r.imageUrl,
  }, "serper"));
}

async function tavilySearch(query, limit, env, options = {}) {
  if (!env.TAVILY_API_KEY) throw new Error("TAVILY_API_KEY is not configured");
  const payload = { query, max_results: limit, search_depth: "basic" };
  const afterDate = freshnessAfterDate(options.freshness);
  if (afterDate) payload.start_date = afterDate;
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`tavily search failed: ${response.status}`);
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "tavily");
  return (data.results || []).map((r) => normalizeResult({
    title: r.title,
    url: r.url,
    snippet: r.content,
    published_at: r.published_date || r.publishedAt || r.date,
    site_name: r.source,
    image_url: r.image_url,
  }, "tavily"));
}

function parseDuckDuckGoResults(html) {
  const results = [];
  const blocks = html.match(/<div[^>]+class="[^"]*result[^"]*"[\s\S]*?(?=<div[^>]+class="[^"]*result[^"]*"|<\/body>|$)/gi) || [];
  for (const block of blocks) {
    if (results.length >= MAX_LIMIT) break;
    const link = block.match(/<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let url = link[1].replace(/&amp;/g, "&");
    try {
      const parsed = new URL(url, "https://duckduckgo.com");
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) url = decodeURIComponent(uddg);
    } catch {
      // Keep the raw URL and let canonicalization reject invalid values.
    }
    if (!/^https?:\/\//i.test(url)) continue;
    const snippet = block.match(/<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<div[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || block.match(/<td[^>]+class="[^"]*result-snippet[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    results.push({
      title: cleanText(link[2]),
      url,
      snippet: snippet ? cleanText(snippet[1]) : "",
      source: sourceOf(url),
      site_name: sourceOf(url),
      published_at: "",
      author: "",
      image_url: "",
      retrieved_at: new Date().toISOString(),
      provider: "duckduckgo",
      providers: ["duckduckgo"],
    });
  }
  return results;
}

async function duckDuckGoSearch(query, limit, env, options = {}) {
  const endpoint = env.DUCKDUCKGO_ENDPOINT || "https://html.duckduckgo.com/html/";
  let parsedEndpoint;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error("DUCKDUCKGO_ENDPOINT is invalid");
  }
  const blocked = isBlockedUrl(parsedEndpoint.toString());
  if (blocked) throw new Error(`DUCKDUCKGO_ENDPOINT blocked: ${blocked}`);
  const language = options.language || env.DUCKDUCKGO_LANGUAGE || env.BING_MARKET || "en-US";
  const { response } = await safeFetch(parsedEndpoint.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": "Mozilla/5.0 (compatible; search-gateway/0.2)",
      "accept-language": `${language},en;q=0.8`,
    },
    body: new URLSearchParams({ q: query }).toString(),
  });
  if (!response.ok) throw new Error(`duckduckgo search failed: ${response.status}`);
  const text = await readTextLimited(response, MAX_SEARCH_HTML_BYTES);
  return parseDuckDuckGoResults(text).slice(0, limit);
}

function parseBingResults(html) {
  const results = [];
  const itemRegex = /<li class="b_algo"[\s\S]*?<\/li>/gi;
  let item;
  while ((item = itemRegex.exec(html)) !== null && results.length < MAX_LIMIT) {
    const block = item[0];
    const link = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const url = link[1].replace(/&amp;/g, "&");
    if (!/^https?:\/\//i.test(url)) continue;
    results.push({
      title: cleanText(link[2]),
      url,
      snippet: snippet ? cleanText(snippet[1]) : "",
      source: sourceOf(url),
      site_name: sourceOf(url),
      published_at: "",
      author: "",
      image_url: "",
      retrieved_at: new Date().toISOString(),
      provider: "bing",
      providers: ["bing"],
    });
  }
  return results;
}

async function bingSearch(query, limit, env, options = {}) {
  const market = options.language || env.BING_MARKET || "en-US";
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("q", query);
  url.searchParams.set("setlang", market);
  url.searchParams.set("cc", market.toLowerCase().startsWith("zh") ? "CN" : "US");
  if (options.freshness && options.freshness !== "none") {
    const days = daysForFreshness(options.freshness);
    if (days) url.searchParams.set("qft", `+filterui:age-lt${days * 24}h`);
  }
  const { response } = await safeFetch(url.toString(), {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; search-gateway/0.1)",
      "accept-language": `${market},en;q=0.8,zh-CN;q=0.6`,
    },
  });
  if (!response.ok) throw new Error(`bing search failed: ${response.status}`);
  const text = await readTextLimited(response, MAX_SEARCH_HTML_BYTES);
  return parseBingResults(text).slice(0, limit);
}

async function collectProviderResults(providers, query, searchLimit, env, searchOptions, searchTimeoutMs) {
  return Promise.all(providers.map(async (provider) => {
    try {
      const results = await withTimeout(searchProvider(provider, query, searchLimit, env, searchOptions), searchTimeoutMs, provider);
      return { provider, results, warning: results.length === 0 ? `${provider}: empty results` : "" };
    } catch (error) {
      return { provider, results: [], warning: `${provider}: ${error.message}` };
    }
  }));
}

async function aggregateSearch(providers, context) {
  const settled = await collectProviderResults(providers, context.query, context.searchLimit, context.env, context.searchOptions, context.searchTimeoutMs);
  context.warnings.push(...settled.map((item) => item.warning).filter(Boolean));
  const providersUsed = settled.filter((item) => item.results.length > 0).map((item) => item.provider);
  const candidates = mergeRankResults(settled.flatMap((item) => item.results), context.query, context.searchLimit, context.freshness);
  const reranked = await maybeRerankResults(candidates, context.query, context.limit, context.body, context.env, context.warnings);
  const results = reranked.results;
  return {
    ok: results.length > 0,
    status: results.length > 0 ? 200 : 502,
    mode: context.mode,
    strategy: context.strategy,
    provider: context.requestedProvider,
    providers_used: providersUsed,
    query: context.query,
    freshness: context.freshness,
    language: context.language,
    count: results.length,
    results,
    ...(reranked.providers_used.length ? { rerank_providers_used: reranked.providers_used } : {}),
    fetched_at: new Date().toISOString(),
    warnings: context.warnings,
    details: context.warnings,
    ...(results.length === 0 ? { error: "all search providers failed" } : {}),
  };
}

async function fallbackSearch(providers, context) {
  for (const provider of providers) {
    try {
      const providerResults = await withTimeout(searchProvider(provider, context.query, context.searchLimit, context.env, context.searchOptions), context.searchTimeoutMs, provider);
      const candidates = mergeRankResults(providerResults, context.query, context.searchLimit, context.freshness);
      const reranked = await maybeRerankResults(candidates, context.query, context.limit, context.body, context.env, context.warnings);
      const results = reranked.results;
      if (results.length > 0) {
        return {
          ok: true,
          mode: context.mode,
          strategy: context.strategy,
          provider,
          query: context.query,
          freshness: context.freshness,
          language: context.language,
          count: results.length,
          results,
          ...(reranked.providers_used.length ? { rerank_providers_used: reranked.providers_used } : {}),
          fetched_at: new Date().toISOString(),
          warnings: context.warnings,
          details: context.warnings,
        };
      }
      context.warnings.push(`${provider}: empty results`);
    } catch (error) {
      context.warnings.push(`${provider}: ${error.message}`);
    }
  }
  return {
    ok: false,
    status: 502,
    mode: context.mode,
    strategy: context.strategy,
    query: context.query,
    freshness: context.freshness,
    language: context.language,
    error: "all search providers failed",
    provider: context.requestedProvider,
    count: 0,
    fetched_at: new Date().toISOString(),
    warnings: context.warnings,
    details: context.warnings,
  };
}

async function balancedSearch(providerOrder, context) {
  if (context.requestedProvider !== "auto" || providerOrder.length <= 1) return fallbackSearch(providerOrder, context);
  const firstWave = providerOrder.slice(0, Math.min(3, providerOrder.length));
  const firstWaveResult = await aggregateSearch(firstWave, context);
  if (firstWaveResult.results.length > 0) return firstWaveResult;
  return fallbackSearch(providerOrder.slice(firstWave.length), context);
}


async function runSearch(body, env) {
  const query = String(body.query || "").trim();
  if (!query) return { ok: false, status: 400, error: "query is required" };
  if (query.length > MAX_QUERY_CHARS) return { ok: false, status: 400, error: `query too long; max ${MAX_QUERY_CHARS} chars` };
  const mode = String(body.mode || "balanced").toLowerCase();
  if (!SEARCH_MODES.has(mode)) {
    return { ok: false, status: 400, error: "mode must be fast, balanced, or thorough" };
  }
  const limit = clampLimit(body.limit);
  const requestedProvider = String(body.provider || "auto").toLowerCase();
  if (!isSupportedProvider(requestedProvider)) {
    return { ok: false, status: 400, error: `unsupported provider: ${requestedProvider}` };
  }
  const strategy = mode === "thorough" ? "aggregate" : mode === "fast" ? "fallback" : "balanced";
  const freshness = normalizeFreshness(body.freshness, query);
  const language = normalizeLanguage(body.language, query);
  const searchOptions = { freshness, language };
  const warnings = [];
  const providerOrder = configuredProviders(requestedProvider, env);
  const searchBody = { ...body, rerank: body.rerank === undefined && mode === "fast" ? false : body.rerank };
  const rerankProviders = configuredRerankProviders(searchBody.rerank, env);
  const defaultRerankPool = mode === "thorough" ? MAX_LIMIT : limit * 3;
  const rerankPool = Math.min(MAX_LIMIT, Math.max(limit, Number.parseInt(searchBody.rerank_pool ?? String(defaultRerankPool), 10) || limit));
  const searchLimit = rerankProviders.length ? rerankPool : limit;
  const searchTimeoutMs = providerTimeoutMs(env.SEARCH_PROVIDER_TIMEOUT_MS, DEFAULT_SEARCH_PROVIDER_TIMEOUT_MS);
  const context = { body: searchBody, env, query, limit, requestedProvider, mode, strategy, freshness, language, searchOptions, warnings, searchLimit, searchTimeoutMs };

  if (mode === "thorough") return aggregateSearch(providerOrder, context);
  if (mode === "fast") return fallbackSearch(providerOrder, context);
  return balancedSearch(providerOrder, context);
}

function isBlockedUrl(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) return "only http(s) URLs are allowed";
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  if (parsed.username || parsed.password) return "credentials in URLs are blocked";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return "private host blocked";
  const ipv4 = parseIpv4(host);
  if (isBlockedIpv4(ipv4)) return "private IP blocked";
  const ipv6Host = host.replace(/^\[|\]$/g, "");
  // Conservative IPv6 guard: loopback/unspecified, ULA, link-local, multicast,
  // documentation prefix, and IPv4-mapped compact forms are blocked before fetch.
  if (/^(::|f[cd][0-9a-f]*|fe[89ab][0-9a-f]*|ff[0-9a-f]*|2001:db8:)/i.test(ipv6Host)) return "private IP blocked";
  return "";
}

function safeRedirectHeaders(init = {}) {
  const incoming = new Headers(init.headers || {});
  const headers = new Headers();
  for (const key of ["user-agent", "accept", "accept-language", "content-type"]) {
    const value = incoming.get(key);
    if (value) headers.set(key, value);
  }
  return headers;
}

function redirectInit(init = {}, status = 0) {
  const method = String(init.method || "GET").toUpperCase();
  const rewriteToGet = [301, 302, 303].includes(status) && !["GET", "HEAD"].includes(method);
  return {
    method: rewriteToGet ? "GET" : method,
    headers: safeRedirectHeaders(init),
    body: rewriteToGet ? undefined : init.body,
    redirect: "manual",
  };
}

async function safeFetch(url, init = {}, redirects = 0) {
  const blocked = isBlockedUrl(url);
  if (blocked) throw new Error(blocked);
  const response = await fetch(url, redirectInit(init));
  if (response.status >= 300 && response.status < 400 && response.headers.get("location") && redirects < 5) {
    const next = new URL(response.headers.get("location"), url).toString();
    const nextBlocked = isBlockedUrl(next);
    if (nextBlocked) throw new Error(nextBlocked);
    return safeFetch(next, redirectInit(init, response.status), redirects + 1);
  }
  return { response, finalUrl: url };
}

function fetchMode(value) {
  const mode = String(value || "full").trim().toLowerCase();
  return FETCH_MODES.has(mode) ? mode : "";
}

function fetchCacheTtl(value) {
  if (value === false || value === "false") return 0;
  const n = Number.parseInt(value ?? String(DEFAULT_FETCH_CACHE_TTL_SECONDS), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_FETCH_CACHE_TTL_SECONDS);
}

function fetchCacheKey({ url, maxChars, offset }) {
  const key = new URL("https://search-gateway.local/__fetch_cache");
  key.searchParams.set("url", url);
  key.searchParams.set("max_chars", String(maxChars));
  key.searchParams.set("offset", String(offset));
  return new Request(key.toString(), { method: "GET" });
}

async function readFetchCache(cacheRequest) {
  if (typeof caches === "undefined" || !caches.default) return null;
  const cached = await caches.default.match(cacheRequest);
  if (!cached) return null;
  try {
    return await cached.json();
  } catch {
    return null;
  }
}

async function writeFetchCache(cacheRequest, value, ttlSeconds) {
  if (!ttlSeconds || typeof caches === "undefined" || !caches.default || !value?.ok) return;
  const response = new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `public, max-age=${ttlSeconds}` },
  });
  await caches.default.put(cacheRequest, response);
}

function fetchChunkChars(value) {
  const n = Number.parseInt(value ?? String(DEFAULT_CHUNK_CHARS), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CHUNK_CHARS;
  return Math.min(Math.max(n, 300), MAX_CHUNK_CHARS);
}

function headingFrom(text) {
  return String(text || "").match(/^#{1,6}\s+(.+)$/m)?.[1]?.trim() || "";
}

function splitOversizedChunk(text, maxChars) {
  const parts = [];
  let rest = String(text || "").trim();
  while (rest.length > maxChars) {
    let cut = rest.lastIndexOf("\n\n", maxChars);
    if (cut < Math.floor(maxChars * 0.45)) cut = rest.lastIndexOf(". ", maxChars);
    if (cut < Math.floor(maxChars * 0.45)) cut = maxChars;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.filter(Boolean);
}

function markdownChunks(text, maxChars) {
  const value = String(text || "").trim();
  if (!value) return [];
  const sections = [];
  let current = [];
  for (const block of value.split(/\n{2,}/)) {
    if (/^#{1,6}\s+/.test(block) && current.length) {
      sections.push(current.join("\n\n"));
      current = [block];
    } else {
      current.push(block);
    }
  }
  if (current.length) sections.push(current.join("\n\n"));

  const chunks = [];
  let offset = 0;
  let pending = "";
  let pendingHeading = "";
  const flush = () => {
    const text = pending.trim();
    if (!text) return;
    for (const part of splitOversizedChunk(text, maxChars)) {
      chunks.push({
        index: chunks.length,
        heading: pendingHeading || headingFrom(part),
        text: part,
        char_count: part.length,
        offset,
      });
      offset += part.length;
    }
    pending = "";
    pendingHeading = "";
  };

  for (const section of sections) {
    const sectionText = section.trim();
    const next = pending ? `${pending}\n\n${sectionText}` : sectionText;
    if (pending && next.length > maxChars) flush();
    if (!pending) pendingHeading = headingFrom(sectionText);
    pending = pending ? `${pending}\n\n${sectionText}` : sectionText;
    if (pending.length > maxChars) flush();
  }
  flush();
  return chunks;
}

function projectFetchResult(result, mode, cacheState, options = {}) {
  const base = { ...result, mode, ...(cacheState ? { cache: cacheState } : {}) };
  if (mode === "full") return base;
  const commonKeys = ["ok", "url", "final_url", "status", "content_type", "source", "mode", "cache", "is_dynamic", "hint", "error", "fetched_at"];
  const metadataKeys = ["title", "description", "canonical_url", "lang", "published_at", "author", "site_name", "modified_at", "og_image"];
  const textKeys = ["text", "char_count", "total_chars", "offset", "next_offset", "word_count", "truncated", "truncated_section"];
  if (mode === "chunks") {
    const chunks = markdownChunks(base.text, fetchChunkChars(options.chunk_chars));
    return {
      ...Object.fromEntries([...commonKeys, ...metadataKeys, "total_chars", "offset", "next_offset", "truncated", "truncated_section"]
        .filter((key) => base[key] !== undefined)
        .map((key) => [key, base[key]])),
      chunk_chars: fetchChunkChars(options.chunk_chars),
      chunk_count: chunks.length,
      chunks,
    };
  }
  const keys = mode === "metadata" ? [...commonKeys, ...metadataKeys] : [...commonKeys, ...textKeys];
  return Object.fromEntries(keys.filter((key) => base[key] !== undefined).map((key) => [key, base[key]]));
}

async function runFetch(body, env = {}) {
  const url = String(body.url || "").trim();
  if (!url) return { ok: false, status: 400, error: "url is required" };
  if (url.length > MAX_URL_CHARS) return { ok: false, status: 400, error: `url too long; max ${MAX_URL_CHARS} chars` };
  const mode = fetchMode(body.mode);
  if (!mode) return { ok: false, status: 400, error: `unsupported fetch mode: ${body.mode}` };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, status: 400, error: "invalid url" };
  }
  const blocked = isBlockedUrl(parsed.toString());
  if (blocked) return { ok: false, status: 400, error: blocked };
  const maxChars = Math.min(Math.max(Number.parseInt(body.max_chars ?? "8000", 10) || 8000, 500), MAX_FETCH_CHARS);
  const requestedOffset = Math.max(Number.parseInt(body.offset ?? "0", 10) || 0, 0);
  const cacheTtl = fetchCacheTtl(body.cache_ttl ?? env.FETCH_CACHE_TTL_SECONDS);
  const cacheRequest = cacheTtl ? fetchCacheKey({ url: parsed.toString(), maxChars, offset: requestedOffset }) : null;
  const cachedResult = cacheRequest ? await readFetchCache(cacheRequest) : null;
  if (cachedResult) return projectFetchResult(cachedResult, mode, "hit", body);
  let response;
  let finalUrl;
  try {
    ({ response, finalUrl } = await safeFetch(parsed.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; search-gateway/0.1)",
        accept: "text/html,application/xhtml+xml,application/json,text/plain,application/xml;q=0.9,*/*;q=0.2",
      },
    }));
  } catch (error) {
    return { ok: false, status: 400, error: error.message };
  }
  const contentType = response.headers.get("content-type") || "";
  const normalizedContentType = contentType.toLowerCase().split(";")[0].trim();
  if (normalizedContentType === "application/pdf") {
    return {
      ok: false,
      url: parsed.toString(),
      final_url: finalUrl,
      status: 415,
      content_type: contentType,
      source: sourceOf(finalUrl),
      error: "PDF content cannot be extracted directly",
      hint: "PDF extraction requires a document parser service; fetch the PDF with a PDF extraction pipeline and pass extracted text back.",
      fetched_at: new Date().toISOString(),
    };
  }
  if (!isTextContentType(contentType)) {
    return {
      ok: false,
      url: parsed.toString(),
      final_url: finalUrl,
      status: 415,
      content_type: contentType,
      source: sourceOf(finalUrl),
      error: `unsupported content-type: ${contentType || "unknown"}`,
      fetched_at: new Date().toISOString(),
    };
  }
  let raw;
  try {
    raw = await readTextLimited(response, MAX_FETCH_RESPONSE_BYTES);
  } catch (error) {
    return {
      ok: false,
      url: parsed.toString(),
      final_url: finalUrl,
      status: error.status || 413,
      content_type: contentType,
      source: sourceOf(finalUrl),
      error: error.message,
      fetched_at: new Date().toISOString(),
    };
  }
  const isHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(contentType);
  const metadata = isHtml ? extractPageMeta(raw, finalUrl) : {
    title: "",
    description: "",
    canonical_url: canonicalizeUrl(finalUrl),
    lang: "",
    published_at: "",
    author: "",
    site_name: "",
    modified_at: "",
    og_image: "",
  };
  const baseUrl = isHtml ? extractBaseUrl(raw, finalUrl) : finalUrl;
  const extracted = isHtml
    ? htmlToMarkdown(extractMainHtml(raw), baseUrl)
    : decodeHtmlEntities(raw).replace(/\s+/g, " ").trim();
  const dynamic = isHtml ? detectDynamicPage(raw, extracted) : { is_dynamic: false, hint: "" };
  const totalChars = extracted.length;
  const offset = Math.min(requestedOffset, totalChars);
  const limited = truncateAtSentence(extracted.slice(offset), maxChars);
  const nextOffset = offset + limited.text.length < totalChars ? offset + limited.text.length : null;
  const wordCount = (limited.text.match(/[\p{L}\p{N}_]+/gu) || []).length;
  const result = {
    ok: response.ok,
    url: parsed.toString(),
    final_url: finalUrl,
    status: response.status,
    content_type: contentType,
    source: sourceOf(finalUrl),
    title: metadata.title,
    description: metadata.description,
    canonical_url: metadata.canonical_url || canonicalizeUrl(finalUrl),
    lang: metadata.lang,
    published_at: metadata.published_at,
    author: metadata.author,
    site_name: metadata.site_name || sourceOf(finalUrl),
    modified_at: metadata.modified_at,
    og_image: metadata.og_image,
    text: limited.text,
    char_count: limited.text.length,
    total_chars: totalChars,
    offset,
    next_offset: nextOffset,
    word_count: wordCount,
    truncated: limited.truncated,
    ...(limited.truncated && limited.last_heading ? { truncated_section: limited.last_heading } : {}),
    is_dynamic: dynamic.is_dynamic,
    ...(dynamic.hint ? { hint: dynamic.hint } : {}),
    ...(response.ok ? {} : { error: `fetch failed: ${response.status}` }),
    fetched_at: new Date().toISOString(),
  };
  await writeFetchCache(cacheRequest, result, cacheTtl);
  return projectFetchResult(result, mode, cacheRequest ? "miss" : "off", body);
}

async function runBochaBalance(env = {}) {
  if (!env.BOCHA_API_KEY) return { ok: false, status: 503, error: "BOCHA_API_KEY is not configured" };
  const response = await fetch("https://api.bocha.cn/v1/fund/remaining", {
    method: "GET",
    redirect: "manual",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${env.BOCHA_API_KEY}`,
    },
  });
  if (!response.ok) return { ok: false, status: response.status, error: `bocha balance failed: ${response.status}` };
  const data = await readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, "bocha");
  const code = Number(data.code || (data.success ? 200 : 0));
  if (!data.success || code !== 200) {
    const status = code === 401 ? 401 : code === 429 ? 429 : code >= 400 ? code : 502;
    return { ok: false, status, error: `bocha balance failed: ${data.code || code || "unknown"} ${data.msg || ""}`.trim() };
  }
  return {
    ok: true,
    provider: "bocha",
    remaining: Number(data.data?.remaining ?? 0),
    currency: "CNY",
    unit: "yuan",
    timestamp: data.timestamp || Date.now(),
    checked_at: new Date().toISOString(),
  };
}

function normalizeBalanceProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (!provider) return "";
  if (provider === "bocha" || provider === "bocha_ai" || provider === "bocha_web") return "bocha";
  return provider;
}

async function runBalance(body = {}, env = {}) {
  const provider = normalizeBalanceProvider(body.provider);
  if (!provider) return { ok: false, status: 400, error: "provider is required" };
  if (provider === "bocha") return runBochaBalance(env);
  return { ok: false, status: 400, error: `unsupported balance provider: ${provider}` };
}
async function postRerankJson(provider, url, apiKey, payload) {
  const response = await fetch(url, {
    method: "POST",
    redirect: "manual",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`${provider} failed: ${response.status}`);
  return readJsonLimited(response, MAX_PROVIDER_JSON_BYTES, provider);
}

function normalizeRerankResults(data, documents, returnDocuments) {
  const items = data.data?.results || data.results || data.data || [];
  return (Array.isArray(items) ? items : []).map((item) => {
    const index = Number.isInteger(item.index) ? item.index : Number.parseInt(item.index ?? item.document_index, 10);
    const result = {
      index,
      relevance_score: Number(item.relevance_score ?? item.score ?? item.relevanceScore ?? 0),
    };
    if (returnDocuments) {
      result.document = item.document?.text ?? item.document ?? documents[index] ?? "";
    }
    return result;
  }).filter((item) => Number.isInteger(item.index) && item.index >= 0 && item.index < documents.length);
}

function rerankModelFor(provider, env, requestedModel) {
  if (requestedModel) return requestedModel;
  if (provider === "bocha_rerank") return env.BOCHA_RERANK_MODEL || "gte-rerank";
  if (provider === "cohere_rerank") return env.COHERE_RERANK_MODEL || "rerank-v3.5";
  if (provider === "jina_rerank") return env.JINA_RERANK_MODEL || "jina-reranker-v3";
  if (provider === "voyage_rerank") return env.VOYAGE_RERANK_MODEL || "rerank-2.5";
  if (provider === "siliconflow_rerank") return env.SILICONFLOW_RERANK_MODEL || "BAAI/bge-reranker-v2-m3";
  return requestedModel || "";
}

async function callRerankProvider(provider, query, documents, env, options = {}) {
  const topN = Math.min(Math.max(Number.parseInt(options.top_n ?? documents.length, 10) || documents.length, 1), documents.length);
  const returnDocuments = options.return_documents === true;
  const model = cleanText(rerankModelFor(provider, env, cleanText(options.model || "")));
  let data;
  if (provider === "bocha_rerank") {
    data = await postRerankJson(provider, env.BOCHA_RERANK_ENDPOINT || "https://api.bocha.cn/v1/rerank", env.BOCHA_API_KEY, { model, query, documents, top_n: topN, return_documents: returnDocuments });
    const code = Number(data.code || 200);
    if (code !== 200) throw new Error(`${provider} failed: ${data.code} ${data.msg || ""}`.trim());
  } else if (provider === "cohere_rerank") {
    data = await postRerankJson(provider, env.COHERE_RERANK_ENDPOINT || "https://api.cohere.com/v2/rerank", env.COHERE_API_KEY, { model, query, documents, top_n: topN, return_documents: returnDocuments });
  } else if (provider === "jina_rerank") {
    data = await postRerankJson(provider, env.JINA_RERANK_ENDPOINT || "https://api.jina.ai/v1/rerank", env.JINA_API_KEY, { model, query, documents, top_n: topN, return_documents: returnDocuments });
  } else if (provider === "voyage_rerank") {
    data = await postRerankJson(provider, env.VOYAGE_RERANK_ENDPOINT || "https://api.voyageai.com/v1/rerank", env.VOYAGE_API_KEY, { model, query, documents, top_k: topN, return_documents: returnDocuments });
  } else if (provider === "siliconflow_rerank") {
    data = await postRerankJson(provider, env.SILICONFLOW_RERANK_ENDPOINT || "https://api.siliconflow.cn/v1/rerank", env.SILICONFLOW_API_KEY, { model, query, documents, top_n: topN, return_documents: returnDocuments });
  } else {
    throw new Error(`unsupported rerank provider: ${provider}`);
  }
  return {
    ok: true,
    provider,
    model: data.data?.model || data.model || model,
    results: normalizeRerankResults(data, documents, returnDocuments),
    log_id: data.log_id || data.id || "",
  };
}

async function runRerank(body, env = {}) {
  const query = cleanText(body.query || "");
  if (!query) return { ok: false, status: 400, error: "query is required" };
  if (query.length > MAX_QUERY_CHARS) return { ok: false, status: 400, error: `query too long; max ${MAX_QUERY_CHARS} chars` };
  const documents = Array.isArray(body.documents) ? body.documents.map((d) => cleanText(d)).filter(Boolean) : [];
  if (!documents.length) return { ok: false, status: 400, error: "documents must be a non-empty array of strings" };
  if (documents.length > MAX_RERANK_DOCUMENTS) return { ok: false, status: 400, error: `documents too many; max ${MAX_RERANK_DOCUMENTS}` };
  const provider = String(body.provider || body.rerank_provider || "auto").toLowerCase();
  const providers = configuredRerankProviders(provider, env);
  if (!providers.length) return { ok: false, status: 503, error: provider === "auto" ? "no rerank provider configured" : `rerank provider is not configured: ${provider}` };
  try {
    const output = await callRerankProvider(providers[0], query, documents, env, {
      top_n: body.top_n,
      return_documents: body.return_documents === true || String(body.return_documents || "").toLowerCase() === "true",
      model: body.model,
    });
    return {
      ok: true,
      provider: output.provider,
      model: output.model,
      query,
      count: output.results.length,
      results: output.results,
      log_id: output.log_id || "",
      reranked_at: new Date().toISOString(),
    };
  } catch (error) {
    return { ok: false, status: 502, error: error.message };
  }
}

async function runBatchFetch(body, env = {}, parentRequestId = requestId()) {
  const requests = Array.isArray(body.requests) ? body.requests : [];
  if (!requests.length) return { ok: false, status: 400, error: "requests must be a non-empty array" };
  if (requests.length > 10) return { ok: false, status: 400, error: "too many requests; max 10" };
  const settled = await Promise.all(requests.map(async (item, index) => {
    try {
      const result = await runFetch({ ...(item || {}) }, env);
      return { index, ...withAgentMeta(result, `${parentRequestId}:${index}`) };
    } catch (error) {
      return withAgentMeta({ index, ok: false, status: 500, error: error.message || String(error) }, `${parentRequestId}:${index}`);
    }
  }));
  const successCount = settled.filter((item) => item.ok).length;
  const failedCount = settled.length - successCount;
  return {
    ok: successCount > 0,
    request_id: parentRequestId,
    ...(successCount === 0 ? { status: 502, error: "all batch fetches failed" } : {}),
    count: settled.length,
    success_count: successCount,
    failed_count: failedCount,
    results: settled,
    fetched_at: new Date().toISOString(),
  };
}

async function runSearchFetch(body, env = {}, parentRequestId = requestId()) {
  const fetchTop = Math.min(Math.max(Number.parseInt(body.fetch_top ?? "3", 10) || 3, 1), 10);
  const mode = fetchMode(body.fetch_mode || "chunks");
  if (!mode) return { ok: false, status: 400, error: `unsupported fetch mode: ${body.fetch_mode}` };
  const search = await runSearch(body, env);
  if (!search.ok) {
    return {
      ok: false,
      status: search.status || 502,
      error: search.error || "search failed",
      request_id: parentRequestId,
      search: withAgentMeta(search, `${parentRequestId}:search`),
      fetch_top: fetchTop,
      fetched: { ok: false, count: 0, success_count: 0, failed_count: 0, results: [] },
      fetched_at: new Date().toISOString(),
    };
  }
  const requests = (search.results || []).slice(0, fetchTop).map((result) => ({
    url: result.url,
    mode,
    max_chars: body.max_chars,
    chunk_chars: body.chunk_chars,
    cache_ttl: body.cache_ttl,
  }));
  const fetched = requests.length
    ? await runBatchFetch({ requests }, env, `${parentRequestId}:fetch`)
    : { ok: false, count: 0, success_count: 0, failed_count: 0, results: [] };
  return {
    ok: fetched.success_count > 0,
    request_id: parentRequestId,
    ...(fetched.success_count > 0 ? {} : { status: 502, error: "search succeeded but fetches failed" }),
    search: withAgentMeta(search, `${parentRequestId}:search`),
    fetch_top: Math.min(fetchTop, requests.length),
    fetched: withAgentMeta(fetched, `${parentRequestId}:fetch`),
    fetched_at: new Date().toISOString(),
  };
}

async function handleRequest(request, env) {
  const request_id = requestId();
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method === "GET" && url.pathname === "/") {
    return html(setupPage(env));
  }
  if (request.method === "GET" && url.pathname === "/health") {
    return json(healthPayload(env, !authRequired(env) || isAuthorized(request, env) || !authConfigured(env)));
  }
  if (authRequired(env) && !authConfigured(env)) {
    return json(withAgentMeta({ ok: false, status: 503, error: "SEARCH_GATEWAY_TOKEN is required in private mode" }, request_id), 503);
  }
  if (!isAuthorized(request, env)) return json(withAgentMeta({ ok: false, status: 401, error: "unauthorized" }, request_id), 401);
  if (url.pathname === "/balance" && request.method === "GET") {
    const limited = await checkRateLimit(request, env, url.pathname, request_id);
    if (limited) return limited;
    const result = withAgentMeta(await runBalance({ provider: url.searchParams.get("provider") }, env), request_id);
    return json(result, result.status && !result.ok ? result.status : 200);
  }
  if (request.method !== "POST") return json(withAgentMeta({ ok: false, status: 405, error: "method not allowed" }, request_id), 405);
  if (["/search", "/fetch", "/batch_fetch", "/search_fetch", "/rerank", "/balance"].includes(url.pathname)) {
    const limited = await checkRateLimit(request, env, url.pathname, request_id);
    if (limited) return limited;
  }

  let body;
  try {
    const bodyLimit = ["/batch_fetch", "/search_fetch", "/rerank"].includes(url.pathname) ? MAX_BATCH_JSON_BODY_CHARS : MAX_JSON_BODY_CHARS;
    body = await readJson(request, bodyLimit);
  } catch (error) {
    return json(withAgentMeta({ ok: false, status: 400, error: error.message }, request_id), 400);
  }

  if (url.pathname === "/search") {
    const result = withAgentMeta(await runSearch(body, env), request_id);
    const providers = result.providers_used || (result.provider ? [result.provider] : []);
    return json(result, result.status || (result.ok ? 200 : 500), {
      "x-search-providers": providers.join(","),
      "x-search-mode": result.mode || "",
    });
  }
  if (url.pathname === "/fetch") {
    const result = withAgentMeta(await runFetch(body, env), request_id);
    return json(result, result.status && !result.ok ? result.status : 200);
  }
  if (url.pathname === "/rerank") {
    const result = withAgentMeta(await runRerank(body, env), request_id);
    return json(result, result.status && !result.ok ? result.status : 200);
  }
  if (url.pathname === "/balance") {
    const result = withAgentMeta(await runBalance(body, env), request_id);
    return json(result, result.status && !result.ok ? result.status : 200);
  }
  if (url.pathname === "/batch_fetch") {
    const result = withAgentMeta(await runBatchFetch(body, env, request_id), request_id);
    return json(result, result.status && !result.ok ? result.status : 200);
  }
  if (url.pathname === "/search_fetch") {
    const result = withAgentMeta(await runSearchFetch(body, env, request_id), request_id);
    return json(result, result.status && !result.ok ? result.status : 200);
  }
  return json(withAgentMeta({ ok: false, status: 404, error: "not found" }, request_id), 404);
}

export default {
  fetch(request, env) {
    return handleRequest(request, env || {});
  },
};

// Test-only named exports. The deployed Worker HTTP surface is the default fetch handler.
export const _test = { canonicalizeUrl, cleanText, parseDuckDuckGoResults, parseBingResults, configuredProviders, isTextContentType, normalizeDate, normalizeFreshness, normalizeLanguage, queryTokens, resultScore, mergeRankResults, runSearch, runBalance, runRerank, runFetch, safeFetch, handleRequest };
