/**
 * Acceptance tests for the streaming search API.
 *
 * Prerequisite: `npm run build` (this script starts production servers).
 *
 * Run: npm run test:acceptance
 *
 * The script starts its own servers on free ports so it never disturbs a dev
 * server. One server runs normally; the second forces every Overpass mirror to
 * fail so we can prove an outage is reported as HTTP 502, not an empty list.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NEXT_BIN = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");

const servers = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    failed += 1;
    console.log(`FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
  }
}

function skip(name, reason) {
  skipped += 1;
  console.log(`SKIP  ${name} - ${reason}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error("No free port"))));
    });
  });
}

function startServer(port, extraEnv = {}) {
  if (!existsSync(NEXT_BIN)) {
    throw new Error(`Next.js binary not found at ${NEXT_BIN}. Run npm install.`);
  }

  const child = spawn(process.execPath, [NEXT_BIN, "start", "-p", String(port)], {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const record = { child, port, output: () => output };
  servers.push(record);
  return record;
}

async function waitForServer(baseUrl, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(baseUrl, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  return false;
}

function stopServers() {
  for (const server of servers.splice(0)) {
    try {
      if (process.platform === "win32") {
        spawn("taskkill", ["/PID", String(server.child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        server.child.kill("SIGTERM");
      }
    } catch {
      // Best effort.
    }
  }
}

async function runSearch(baseUrl, params) {
  const url = new URL("/api/search", baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const started = Date.now();
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/x-ndjson" },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (cause) {
    return {
      status: 0,
      message: cause instanceof Error ? cause.message : String(cause),
      leads: [],
      events: [],
      firstLeadMs: null,
      elapsedMs: Date.now() - started,
    };
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok || !contentType.includes("ndjson")) {
    const data = await response.json().catch(() => null);
    return {
      status: response.status,
      message: data?.error?.message ?? data?.message ?? null,
      leads: [],
      events: [],
      firstLeadMs: null,
      elapsedMs: Date.now() - started,
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      status: response.status,
      message: "Response had no body",
      leads: [],
      events: [],
      firstLeadMs: null,
      elapsedMs: Date.now() - started,
    };
  }

  const decoder = new TextDecoder();
  const events = [];
  const leads = [];
  let buffer = "";
  let firstLeadMs = null;
  let done = null;
  let errorEvent = null;

  const handleLine = (line) => {
    if (!line.trim()) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    events.push(event);
    if (event.type === "lead") {
      leads.push(event.lead);
      if (firstLeadMs === null) firstLeadMs = Date.now() - started;
    }
    if (event.type === "done") done = event;
    if (event.type === "error") errorEvent = event;
  };

  while (true) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) handleLine(line);
  }
  if (buffer.trim()) handleLine(buffer);

  return {
    status: response.status,
    message: errorEvent?.message ?? done?.message ?? null,
    leads,
    events,
    firstLeadMs,
    elapsedMs: Date.now() - started,
    done,
    errorEvent,
  };
}

function describe(result) {
  if (result.status === 0) return `network error: ${result.message}`;
  if (result.errorEvent) return `error event: ${result.errorEvent.message}`;
  if (result.done) return `done: ${result.done.outcome}, ${result.leads.length} leads`;
  return `${result.status}, ${result.leads.length} leads`;
}

async function main() {
  if (!existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    console.error("No production build found. Run `npm run build` first.");
    process.exit(1);
  }

  const mainPort = await freePort();
  const failurePort = await freePort();
  const mainBase = `http://127.0.0.1:${mainPort}`;
  const failureBase = `http://127.0.0.1:${failurePort}`;

  console.log(`Starting production server on ${mainBase}…`);
  const mainServer = startServer(mainPort);

  console.log(`Starting mirror-failure server on ${failureBase}…`);
  const failureServer = startServer(failurePort, { APLIFY_FORCE_MIRROR_FAILURE: "1" });

  const [mainReady, failureReady] = await Promise.all([
    waitForServer(mainBase),
    waitForServer(failureBase),
  ]);

  if (!mainReady || !failureReady) {
    console.error("Servers did not become ready.");
    console.error("Main server output:\n", mainServer.output());
    console.error("Failure server output:\n", failureServer.output());
    stopServers();
    process.exit(1);
  }

  console.log("\nRunning acceptance tests…\n");

  // 1. Cold Lagos search: first lead within 5s, or a clear diagnostic.
  const cold = await runSearch(mainBase, {
    audience: "restaurants",
    location: "Lagos, Nigeria",
    limit: 10,
    seed: 101,
  });
  console.log(`  cold Lagos: ${describe(cold)}`);
  check(
    "Lagos cold request is either a stream or a clear 502",
    cold.status === 200 || (cold.status === 502 && Boolean(cold.message)),
    `status ${cold.status}${cold.message ? ` - ${cold.message}` : ""}`,
  );
  check(
    "Lagos cold returns leads or a clear diagnostic",
    cold.leads.length > 0 || Boolean(cold.message),
    cold.leads.length > 0 ? `${cold.leads.length} leads` : cold.message ?? "silent empty result",
  );
  if (cold.leads.length > 0) {
    check(
      "Lagos cold first lead is under 5s",
      cold.firstLeadMs !== null && cold.firstLeadMs < 5_000,
      `${cold.firstLeadMs ?? "?"}ms`,
    );
  }

  // 2. Warm search: first lead within 1s.
  const warm = await runSearch(mainBase, {
    audience: "restaurants",
    location: "Lagos, Nigeria",
    limit: 10,
    seed: 102,
  });
  console.log(`  warm Lagos: ${describe(warm)}`);
  if (warm.leads.length > 0) {
    check(
      "Lagos warm first lead is under 1s",
      warm.firstLeadMs !== null && warm.firstLeadMs < 1_000,
      `${warm.firstLeadMs ?? "?"}ms`,
    );
  } else {
    skip("Lagos warm first lead is under 1s", warm.message ?? "no leads available");
  }

  // 3. Repeat search with the seen set: no shared emails.
  if (cold.leads.length === 0) {
    skip("Repeat search shares no emails", "the cold search returned no leads");
  } else {
    const exclude = cold.leads.flatMap((lead) => [lead.id, lead.email]).join(",");
    const repeat = await runSearch(mainBase, {
      audience: "restaurants",
      location: "Lagos, Nigeria",
      limit: 10,
      seed: 103,
      exclude,
    });
    console.log(`  repeat Lagos (excluded ${cold.leads.length}): ${describe(repeat)}`);

    const firstEmails = new Set(cold.leads.map((lead) => lead.email.toLowerCase()));
    const overlap = repeat.leads.filter((lead) =>
      firstEmails.has(lead.email.toLowerCase()),
    );
    check(
      "Repeat search shares no emails with the first",
      overlap.length === 0,
      overlap.length === 0
        ? `${repeat.leads.length} new leads`
        : `${overlap.length} overlapping emails`,
    );
    check(
      "Repeat search is not a silent empty result",
      repeat.leads.length > 0 || Boolean(repeat.message),
      repeat.message ?? describe(repeat),
    );
  }

  // 4. Unknown location: a clear service error, not an empty list.
  const unknown = await runSearch(mainBase, {
    audience: "restaurants",
    location: "zzzzqqqq-not-a-real-place-999",
    limit: 5,
    seed: 104,
  });
  console.log(`  unknown location: ${describe(unknown)}`);
  check(
    "Unknown location returns a clear error",
    unknown.status === 502 && Boolean(unknown.message),
    `status ${unknown.status}${unknown.message ? ` - ${unknown.message}` : ""}`,
  );

  // 5. Unmapped trade: a clear message, never a silent empty list.
  const unmapped = await runSearch(mainBase, {
    audience: "qzxvbnm",
    location: "Lagos, Nigeria",
    limit: 5,
    seed: 105,
  });
  console.log(`  unmapped trade: ${describe(unmapped)}`);
  const unmappedClear =
    unmapped.status === 502
      ? Boolean(unmapped.message)
      : unmapped.leads.length > 0 || Boolean(unmapped.message);
  check(
    "Unmapped trade is never a silent empty list",
    unmappedClear,
    unmapped.message ?? describe(unmapped),
  );

  // 6. Every mirror forced offline: HTTP 502 with a message.
  const offline = await runSearch(failureBase, {
    audience: "restaurants",
    location: "Reykjavik, Iceland",
    limit: 5,
    seed: 106,
  });
  console.log(`  offline mirrors: ${describe(offline)}`);
  check(
    "Offline mirrors return 502 with a message",
    offline.status === 502 && Boolean(offline.message),
    `status ${offline.status}${offline.message ? ` - ${offline.message}` : ""}`,
  );

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped.\n`);
  stopServers();
  process.exit(failed > 0 ? 1 : 0);
}

process.on("SIGINT", () => {
  stopServers();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopServers();
  process.exit(143);
});

main().catch((cause) => {
  console.error("Acceptance run crashed:", cause);
  stopServers();
  process.exit(1);
});
