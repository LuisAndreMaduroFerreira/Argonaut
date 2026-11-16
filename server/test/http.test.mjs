// How the API answers when something is wrong, and who it answers at all.
import assert from "node:assert/strict";
import { request } from "node:http";
import { test } from "node:test";
import { startApi } from "./harness.ts";

const api = await startApi("http");
const { call, base } = api;

// A request with headers fetch won't send, such as another Host. Answers { status, data }.
function rawGet(path, headers) {
  const url = new URL(base + path);
  return new Promise((resolve, reject) => {
    const req = request({ host: url.hostname, port: url.port, path, method: "GET", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(body || "null"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("errors: every failure is { error } with the right status", async (t) => {
  const ok = (label) => t.diagnostic(label);

  let res = await call("GET", "/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, { ok: true });
  assert.equal(res.headers.get("x-powered-by"), null);
  ok("the health check answers, without naming the software behind it");

  for (const [method, path] of [
    ["GET", "/api/nothing-here"],
    ["POST", "/api/notes"],
    ["GET", "/api"],
  ]) {
    res = await call(method, path);
    assert.equal(res.status, 404, `${method} ${path}`);
    assert.deepEqual(res.data, { error: "There's nothing at that address" });
  }
  ok("an address the API doesn't have is a 404 in JSON, not a web page");

  res = await call("GET", "/api/tests/%E0%A4%A");
  assert.equal(res.status, 400);
  assert.deepEqual(res.data, { error: "That address isn't valid" });
  ok("an address that can't be decoded says so, and isn't blamed on a body the request never had");

  const broken = await fetch(`${base}/api/groups`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{ "name": "Half written", ',
  });
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { error: "The request body isn't valid JSON" });
  ok("a body that isn't JSON is a 400 that says so");

  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }], note: "the note" });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, '"note" needs a title, content and a list of tags');
  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }], note: { title: "T", content: "C" } });
  assert.equal(res.status, 400);
  res = await call("POST", "/api/chat", { messages: [{ role: "user", content: "hi" }], note: { title: "T", content: "C", tags: ["x"] } });
  assert.equal(res.status, 200);
  assert.match(api.llm.lastRequest().messages[0].content, /titled "T" \(tags: x\)/);
  ok("a chat about a note that isn't shaped like one is a 400, not a crash");

  res = await call("PATCH", "/api/state/nonsense", { theme: "dark" });
  assert.equal(res.status, 404);
  assert.deepEqual(res.data, { error: "Unknown state key" });
  for (const [path, what] of [
    ["/api/groups/00000000-0000-4000-8000-000000000000", "Group"],
    ["/api/papers/00000000-0000-4000-8000-000000000000", "Paper"],
    ["/api/tests/00000000-0000-4000-8000-000000000000", "Test"],
    ["/api/tasks/00000000-0000-4000-8000-000000000000", "Task"],
    ["/api/notes/00000000-0000-4000-8000-000000000000", "Note"],
  ]) {
    res = await call("DELETE", path);
    assert.equal(res.status, 404, path);
    assert.deepEqual(res.data, { error: `${what} not found` });
  }
  ok("something that isn't there is a 404 naming what was looked for, the same way everywhere");
});

test("access: only Argonaut's own pages on this PC may use the API", async (t) => {
  const ok = (label) => t.diagnostic(label);
  const host = new URL(base).host;

  let res = await rawGet("/api/health", { Host: "evil.example" });
  assert.equal(res.status, 403);
  assert.deepEqual(res.data, { error: "Argonaut only answers on this PC, as localhost" });
  res = await rawGet("/api/notes", { Host: `argonaut.evil.example:${new URL(base).port}` });
  assert.equal(res.status, 403);
  for (const name of [host, `localhost:${new URL(base).port}`, "LOCALHOST:8787", "[::1]:8787"]) {
    res = await rawGet("/api/health", { Host: name });
    assert.equal(res.status, 200, name);
  }
  ok("a request arriving under another name is refused: a site can't point its own name at this PC");

  const from = (origin, method = "POST", extra = {}) =>
    fetch(`${base}/api/groups`, {
      method,
      headers: { "Content-Type": "application/json", Origin: origin, ...extra },
      body: method === "POST" ? JSON.stringify({ name: `From ${origin}` }) : undefined,
    });

  for (const origin of ["https://evil.example", "http://localhost.evil.example", "null", `http://${host}.evil.example`]) {
    const response = await from(origin);
    assert.equal(response.status, 403, origin);
    assert.deepEqual(await response.json(), { error: "That page isn't allowed to use Argonaut" });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  res = await call("GET", "/api/groups");
  assert.deepEqual(res.data, []);
  ok("a request sent by another site's page is refused, and changes nothing");

  let response = await from(`http://${host}`);
  assert.equal(response.status, 201);
  ok("the app's own page, served from the API's address, is let through");

  response = await from("http://localhost:5173");
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  response = await from("http://localhost:5173", "OPTIONS", { "Access-Control-Request-Method": "DELETE" });
  assert.equal(response.status, 204);
  assert.match(response.headers.get("access-control-allow-methods"), /DELETE/);
  response = await from("https://evil.example", "OPTIONS", { "Access-Control-Request-Method": "DELETE" });
  assert.equal(response.status, 403);
  ok("the dev server's page may call across origins, and is the only one told so");

  const closed = await api.another({ devOrigins: [] });
  response = await fetch(`${closed}/api/groups`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(response.status, 403);
  ok("with no dev origin set, not even that one is let in");
});
