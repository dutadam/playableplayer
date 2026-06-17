import JSZip from "jszip";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".wasm": "application/wasm"
};

export async function importFile(file) {
  const id = crypto.randomUUID();
  const name = stripExtension(file.name);
  const now = new Date().toISOString();

  if (isZip(file)) {
    return importZip(file, id, name, now);
  }

  if (isHtml(file.name)) {
    const htmlBlob = new Blob([await file.arrayBuffer()], { type: "text/html; charset=utf-8" });
    return {
      playable: {
        id,
        name,
        entryPath: "index.html",
        sourceName: file.name,
        fileCount: 1,
        byteSize: file.size,
        createdAt: now
      },
      files: [
        {
          key: `${id}/index.html`,
          playableId: id,
          path: "index.html",
          type: "text/html; charset=utf-8",
          blob: htmlBlob
        }
      ]
    };
  }

  throw new Error("Only .html, .htm, and .zip files are supported.");
}

async function importZip(file, id, name, createdAt) {
  const zip = await JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const root = findCommonRoot(entries.map((entry) => normalizePath(entry.name)));
  const normalizedEntries = entries.map((entry) => ({
    entry,
    path: normalizePath(stripRoot(entry.name, root))
  })).filter(({ path }) => path && !path.startsWith("__MACOSX/"));

  const entryPath = findEntryPath(normalizedEntries.map(({ path }) => path));
  if (!entryPath) {
    throw new Error("Could not find an index.html file in the zip.");
  }

  const files = [];
  let byteSize = 0;
  for (const { entry, path } of normalizedEntries) {
    const blob = await entry.async("blob");
    const type = mimeForPath(path);
    byteSize += blob.size;
    files.push({
      key: `${id}/${path}`,
      playableId: id,
      path,
      type,
      blob: type ? blob.slice(0, blob.size, type) : blob
    });
  }

  return {
    playable: {
      id,
      name,
      entryPath,
      sourceName: file.name,
      fileCount: files.length,
      byteSize,
      createdAt
    },
    files
  };
}

function findEntryPath(paths) {
  const exact = paths.find((path) => path.toLowerCase() === "index.html");
  if (exact) return exact;
  return paths.find((path) => /(^|\/)index\.html$/i.test(path));
}

function findCommonRoot(paths) {
  if (!paths.length) return "";
  const firstSegments = paths[0].split("/");
  if (firstSegments.length < 2) return "";
  const candidate = firstSegments[0];
  return paths.every((path) => path === candidate || path.startsWith(`${candidate}/`)) ? candidate : "";
}

function stripRoot(path, root) {
  const normalized = normalizePath(path);
  if (!root) return normalized;
  return normalized === root ? "" : normalized.replace(new RegExp(`^${escapeRegExp(root)}/`), "");
}

function normalizePath(path) {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function mimeForPath(path) {
  const lower = path.toLowerCase();
  const extension = Object.keys(MIME_TYPES).find((ext) => lower.endsWith(ext));
  return extension ? MIME_TYPES[extension] : "";
}

function isZip(file) {
  return file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
}

function isHtml(name) {
  return /\.html?$/i.test(name);
}

function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
