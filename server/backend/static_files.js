import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { esport2UrlToFileRel } from "./public/paths.js";

function contentType(filePath) {
  if (filePath.endsWith(".html"))
    return "text/html; charset=utf-8";
  if (filePath.endsWith(".css"))
    return "text/css; charset=utf-8";
  if (filePath.endsWith(".js"))
    return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".json"))
    return "application/json; charset=utf-8";
  if (filePath.endsWith(".woff2"))
    return "font/woff2";
  if (filePath.endsWith(".woff"))
    return "font/woff";
  if (filePath.endsWith(".zip"))
    return "application/zip";
  if (filePath.endsWith(".svg"))
    return "image/svg+xml";
  if (filePath.endsWith(".png"))
    return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg"))
    return "image/jpeg";
  if (filePath.endsWith(".webp"))
    return "image/webp";
  if (filePath.endsWith(".gif"))
    return "image/gif";
  return "application/octet-stream";
}

function acceptsGzip(req) {
  const ae = String(req.headers["accept-encoding"] || "").toLowerCase();
  return ae.includes("gzip");
}

function isHashedAsset(urlPath) {
  return urlPath.startsWith("/assets/") && /\.[a-z0-9]+$/i.test(urlPath);
}

/** GET/HEAD 静态资源优先返回，避免在 API 链里排队导致浏览器长期 Pending */
export function isFastStaticRequest(urlPath, method) {
  if (method !== "GET" && method !== "HEAD")
    return false;
  return (
    urlPath.startsWith("/assets/")
    || urlPath === "/favicon.ico"
    || urlPath.startsWith("/esport2/")
  );
}

function canonicalMatcherPath(urlPath) {
  const m = urlPath.match(/^\/matcher(\/.*)?$/i);
  if (!m)
    return null;
  const suffix = m[1];
  if (!suffix || suffix === "/")
    return "/matcher/";
  return `/matcher${suffix}`;
}

const ESPORT2_ASSET_CACHE_PROD = "public, max-age=31536000, immutable";
const ESPORT2_ASSET_CACHE_DEV = "no-cache, must-revalidate";

export function createStaticHandler({ publicDir, webDir, matcherDir }) {
  const esport2AssetCache
    = process.env.NODE_ENV === "production" ? ESPORT2_ASSET_CACHE_PROD : ESPORT2_ASSET_CACHE_DEV;
  function resolveStaticRoot(urlPath) {
    if (/^\/matcher\/assets\/(venue|games)\//i.test(urlPath)) {
      const fileRel = urlPath.slice("/matcher".length);
      return { rootDir: webDir, fileRel, spa: false };
    }
    if (matcherDir && /^\/matcher(\/|$)/i.test(urlPath)) {
      urlPath = canonicalMatcherPath(urlPath) || urlPath;
      const fileRel
        = urlPath === "/matcher" || urlPath === "/matcher/"
          ? "/index.html"
          : urlPath.slice("/matcher".length) || "/index.html";
      return { rootDir: matcherDir, fileRel: fileRel === "/" ? "/index.html" : fileRel, spa: false };
    }
    if (urlPath.startsWith("/esport2/")) {
      return { rootDir: publicDir, fileRel: esport2UrlToFileRel(urlPath), spa: false };
    }
    const fileRel
      = urlPath === "/"
        ? "/index.html"
        : urlPath.endsWith("/") && urlPath.length > 1
          ? `${urlPath}index.html`
          : urlPath;
    return { rootDir: webDir, fileRel, spa: true };
  }

  function cacheControl(urlPath, fileRel, spa, fp) {
    if (/^\/matcher(\/|$)/i.test(urlPath)) {
      return "no-cache, no-store, must-revalidate";
    }
    if (fileRel.endsWith(".html") || (spa && !path.extname(fileRel))) {
      return "no-cache, no-store, must-revalidate";
    }
    if (isHashedAsset(urlPath)) {
      return ESPORT2_ASSET_CACHE_PROD;
    }
    if (urlPath.startsWith("/esport2/assets/")) {
      return esport2AssetCache;
    }
    if (urlPath.startsWith("/assets/")) {
      return "public, max-age=86400";
    }
    return undefined;
  }

  function sendFile(req, res, fp, urlPath, fileRel, spa) {
    const type = contentType(fp);
    const cc = cacheControl(urlPath, fileRel, spa, fp);
    const baseHeaders = { "Content-Type": type };
    if (cc)
      baseHeaders["Cache-Control"] = cc;
    if (req.headers.origin) {
      baseHeaders["Access-Control-Allow-Origin"] = req.headers.origin;
      baseHeaders.Vary = "Origin";
    }

    const useGzip
      = acceptsGzip(req)
        && req.method === "GET"
        && (fp.endsWith(".js") || fp.endsWith(".css") || fp.endsWith(".json") || fp.endsWith(".html"));

    if (req.method === "HEAD") {
      fs.stat(fp, (statErr, stat) => {
        if (statErr) {
          res.writeHead(404);
          res.end();
          return;
        }
        const headers = { ...baseHeaders, "Content-Length": String(stat.size) };
        res.writeHead(200, headers);
        res.end();
      });
      return;
    }

    if (useGzip) {
      const headers = { ...baseHeaders, "Content-Encoding": "gzip", "Vary": "Accept-Encoding" };
      res.writeHead(200, headers);
      fs.createReadStream(fp)
        .pipe(zlib.createGzip())
        .on("error", () => {
          if (!res.headersSent)
            res.writeHead(500);
          res.end();
        })
        .pipe(res);
      return;
    }

    res.writeHead(200, baseHeaders);
    const stream = fs.createReadStream(fp);
    stream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(500);
      res.end();
    });
    stream.pipe(res);
  }

  function serveStatic(req, res) {
    const rawUrl = req.url || "/";
    const urlPath = rawUrl === "/" ? "/" : rawUrl.split("?")[0];
    const query = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";

    if (matcherDir) {
      const canonical = canonicalMatcherPath(urlPath);
      if (canonical && urlPath !== canonical) {
        res.writeHead(301, { Location: canonical + query });
        res.end();
        return;
      }
    }

    if (urlPath === "/matcher") {
      res.writeHead(301, { Location: `/matcher/${query}` });
      res.end();
      return;
    }
    if (urlPath === "/app" || urlPath === "/app/") {
      res.writeHead(301, { Location: "/" });
      res.end();
      return;
    }
    if (urlPath === "/login" || urlPath === "/login/") {
      res.writeHead(301, { Location: `/${query}` });
      res.end();
      return;
    }
    if (urlPath.startsWith("/app/")) {
      const dest = urlPath.slice("/app".length) || "/";
      res.writeHead(301, { Location: dest });
      res.end();
      return;
    }
    if (urlPath.startsWith("/console/extensions/")) {
      const dest = `/esport2/extensions/${urlPath.slice("/console/extensions/".length)}`;
      res.writeHead(301, { Location: dest });
      res.end();
      return;
    }
    if (urlPath === "/console" || urlPath.startsWith("/console/")) {
      res.writeHead(301, { Location: "/" });
      res.end();
      return;
    }

    const resolved = resolveStaticRoot(urlPath);
    if (!resolved) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const { rootDir, fileRel, spa } = resolved;
    const rootResolved = path.resolve(rootDir);
    const filePath = path.normalize(path.join(rootResolved, fileRel));
    if (!filePath.startsWith(rootResolved)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    fs.stat(filePath, (statErr, stat) => {
      if (statErr) {
        if (spa && !path.extname(fileRel)) {
          const indexPath = path.join(rootResolved, "index.html");
          fs.stat(indexPath, (indexErr) => {
            if (indexErr) {
              res.writeHead(404);
              res.end("Not found");
              return;
            }
            sendFile(req, res, indexPath, urlPath, "/index.html", spa);
          });
          return;
        }
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      if (stat.isDirectory()) {
        if (spa) {
          const indexPath = path.join(rootResolved, "index.html");
          sendFile(req, res, indexPath, urlPath, "/index.html", spa);
          return;
        }
        res.writeHead(301, { Location: `${urlPath}/${query}` });
        res.end();
        return;
      }
      sendFile(req, res, filePath, urlPath, fileRel, spa);
    });
  }

  return serveStatic;
}
