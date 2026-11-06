const PREFIX = "mc1.";
const kinds = new Set(["search", "details", "facets"]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}

async function fingerprint(identity) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(identity)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function invalidCursor(message) {
  return Object.assign(new Error(message), { code: "invalid_cursor", recoverable: false });
}

export async function createCursor(kind, identity, position) {
  if (!kinds.has(kind) || !Number.isSafeInteger(position) || position < 0) {
    throw invalidCursor("Cannot create a cursor for this position.");
  }
  const payload = { v: 1, k: kind, h: await fingerprint(identity), n: position };
  return PREFIX + btoa(JSON.stringify(payload)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function readCursor(cursor, kind, identity, fallback) {
  if (cursor === undefined || cursor === null) return fallback;
  if (typeof cursor !== "string" || cursor.length > 512 || !/^mc1\.[A-Za-z0-9_-]+$/.test(cursor)) {
    throw invalidCursor("Use the nextCursor returned by the same tool and repeat its search or ID selection.");
  }
  let payload;
  try {
    const encoded = cursor.slice(PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
    payload = JSON.parse(atob(encoded));
  } catch {
    throw invalidCursor("The cursor is malformed. Start the search or ID selection again.");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).sort().join(",") !== "h,k,n,v" ||
      payload.v !== 1 || payload.k !== kind || !Number.isSafeInteger(payload.n) || payload.n < 0 ||
      payload.h !== await fingerprint(identity)) {
    throw invalidCursor("This cursor belongs to a different search, page size or ID selection. Repeat the original arguments.");
  }
  return payload.n;
}
