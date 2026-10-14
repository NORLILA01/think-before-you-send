// Frontend regression tests for docs/index.html + assets/js/site.js + detector.js.
// Uses jsdom with the real page, the real detector and model, and a mocked network (no billable calls).
// Run:  npm install --no-save jsdom   (or set JSDOM_PATH to an installed jsdom)  then  node --test tests/site.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { JSDOM } = await import(process.env.JSDOM_PATH || "jsdom");
const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs");
const HTML = fs.readFileSync(path.join(DOCS, "index.html"), "utf8");
const DETECTOR_JS = fs.readFileSync(path.join(DOCS, "detector.js"), "utf8");
const SITE_JS = fs.readFileSync(path.join(DOCS, "assets", "js", "site.js"), "utf8");
const MODEL = fs.readFileSync(path.join(DOCS, "model.json"), "utf8");

const FLAGGED = "you are such a stupid idiot, you never listen";   // band: block
const BORDER = "you are an a$$hole";                                 // band: borderline
const SAFE = "thanks for the update, see you tomorrow";             // band: ok
const tick = (n = 5) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : setTimeout(f, 0)); f(); });

async function mount({ modelFails = false, coach = null } = {}) {
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "https://drmurtadha.github.io/think-before-you-send/", pretendToBeVisual: true });
  const win = dom.window, doc = win.document;
  const calls = [];            // every fetch
  const coachCalls = [];       // POST /coach bodies
  let failModel = modelFails;
  win.fetch = (url, opts = {}) => {
    calls.push(String(url));
    if (String(url).endsWith("model.json")) {
      if (failModel) return Promise.resolve({ ok: false, status: 503, json: async () => ({}) });
      return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(MODEL) });
    }
    if (String(url).endsWith("/coach")) {
      coachCalls.push(JSON.parse(opts.body));
      return new Promise((resolve, reject) => {
        if (opts.signal) opts.signal.addEventListener("abort", () => reject(new win.DOMException("Aborted", "AbortError")));
        const out = coach ? coach(JSON.parse(opts.body), resolve, reject) : null;
        if (out) resolve(out);
      });
    }
    return Promise.reject(new Error("unexpected fetch " + url));
  };
  win.eval(DETECTOR_JS);
  win.eval(SITE_JS);
  await tick();
  const $ = (id) => doc.getElementById(id);
  const api = {
    win, doc, $, calls, coachCalls,
    setFail(v) { failModel = v; },
    type(el, value) { el.value = value; el.dispatchEvent(new win.Event("input", { bubbles: true })); },
    click(el) { el.dispatchEvent(new win.MouseEvent("click", { bubbles: true })); },
    async check(text) { api.type($("draft"), text); api.click($("check")); await tick(); },
    resultText() { return $("result").textContent; },
  };
  return api;
}
const okJson = (obj) => ({ ok: true, status: 200, json: async () => obj });
const SUGG = { aggressive: true, feeling: "frustrated", impact: "may feel attacked", tip: "describe the behaviour", starter: "I feel ignored when" };

test("no /coach request on load, typing, scenario choice or an ordinary check", async () => {
  const t = await mount();
  t.type(t.$("draft"), "hello");
  t.click(t.doc.querySelector(".scenario"));
  await t.check(FLAGGED);
  await t.check(BORDER);
  await t.check(SAFE);
  assert.equal(t.coachCalls.length, 0);
  assert.ok(t.calls.every((u) => u.endsWith("model.json")), "only the model file was fetched: " + t.calls.join(", "));
});

test("check is disabled until the model has loaded, then enabled", async () => {
  const dom = new JSDOM(HTML, { runScripts: "outside-only", url: "https://drmurtadha.github.io/think-before-you-send/" });
  const win = dom.window;
  let release;
  win.fetch = () => new Promise((r) => { release = () => r({ ok: true, json: async () => JSON.parse(MODEL) }); });
  win.eval(DETECTOR_JS); win.eval(SITE_JS);
  const btn = win.document.getElementById("check");
  assert.equal(btn.disabled, true);
  assert.match(win.document.getElementById("status").textContent, /Loading the checker/);
  release(); await tick();
  assert.equal(btn.disabled, false);
});

test("model load failure shows an explanation and a working retry", async () => {
  const t = await mount({ modelFails: true });
  assert.equal(t.$("check").disabled, true);
  assert.match(t.resultText(), /could not load/i);
  t.setFail(false);
  t.click(t.doc.querySelector("#result button"));
  await tick();
  assert.equal(t.$("check").disabled, false);
  assert.equal(t.resultText(), "");
});

test("empty submission shows an inline error linked to the field", async () => {
  const t = await mount();
  t.click(t.$("check")); await tick();
  const err = t.$("draft-error");
  assert.equal(err.hidden, false);
  assert.match(err.textContent, /Write a message first/);
  assert.match(t.$("draft").getAttribute("aria-describedby"), /draft-error/);
  assert.equal(t.$("draft").getAttribute("aria-invalid"), "true");
  assert.equal(t.coachCalls.length, 0);
});

test("input limit and counter", async () => {
  const t = await mount();
  assert.equal(t.$("draft").getAttribute("maxlength"), "500");
  assert.equal(t.$("revision").getAttribute("maxlength"), "500");
  t.type(t.$("draft"), "x".repeat(120));
  assert.equal(t.$("count").textContent, "120 / 500");
});

test("scenario choice fills the editor but runs no check", async () => {
  const t = await mount();
  const s = [...t.doc.querySelectorAll(".scenario")];
  assert.equal(s.length, 3);
  t.click(s[2]); await tick();
  assert.equal(t.$("draft").value, "Shut up, loser. Your ideas are worthless.");
  assert.equal(t.resultText(), "");
  assert.equal(t.coachCalls.length, 0);
});

test("flagged draft: disclosure sits with the button; click sends exactly the checked draft and band", async () => {
  const t = await mount({ coach: () => okJson(SUGG) });
  await t.check(FLAGGED);
  const btn = t.$("coach-btn");
  assert.ok(btn, "coaching button present");
  assert.match(btn.parentElement.textContent, /This sends the checked draft to a third-party AI service\./);
  assert.equal(t.coachCalls.length, 0);
  t.click(btn); await tick(8);
  assert.deepEqual(t.coachCalls, [{ message: FLAGGED, band: "block" }]);
  const out = t.$("coach-out").textContent;
  assert.match(out, /frustrated/);
  assert.match(out, /I feel ignored when/);
  assert.match(out, /not a verdict/i);
});

test("borderline draft offers a second opinion with band=borderline", async () => {
  const t = await mount({ coach: () => okJson(SUGG) });
  await t.check(BORDER);
  t.click(t.$("coach-btn")); await tick(8);
  assert.equal(t.coachCalls[0].band, "borderline");
});

test("safe draft shows no coaching button and no guarantee", async () => {
  const t = await mount();
  await t.check(SAFE);
  assert.equal(t.$("coach-btn"), null);
  assert.match(t.resultText(), /did not flag/i);
  assert.doesNotMatch(t.resultText(), /\bsafe\b/i);
});

test("editing the draft during a request discards the late reply", async () => {
  let resolveCoach;
  const t = await mount({ coach: (_b, resolve) => { resolveCoach = () => resolve(okJson(SUGG)); } });
  await t.check(FLAGGED);
  t.click(t.$("coach-btn")); await tick();
  assert.equal(t.coachCalls.length, 1);
  t.type(t.$("draft"), FLAGGED + " and more");        // user edits while waiting
  if (resolveCoach) resolveCoach();
  await tick(8);
  assert.equal(t.resultText(), "", "old result cleared");
  assert.doesNotMatch(t.doc.body.textContent, /AI suggestions, not a verdict/);
  assert.match(t.$("status").textContent, /draft changed/i);
});

test("a newer check supersedes an in-flight reply for the older draft", async () => {
  let replies = [];
  const t = await mount({ coach: (_b, resolve) => { replies.push(() => resolve(okJson(SUGG))); } });
  await t.check(FLAGGED);
  t.click(t.$("coach-btn")); await tick();
  await t.check(BORDER);                               // new check while the first request is pending
  replies.forEach((r) => r());
  await tick(8);
  assert.doesNotMatch(t.resultText(), /AI suggestions, not a verdict/);
});

test("AI failure keeps tips and the draft, and allows retry; 429 has its own message", async () => {
  let status = 500;
  const t = await mount({ coach: () => ({ ok: false, status, json: async () => ({}) }) });
  await t.check(FLAGGED);
  t.click(t.$("coach-btn")); await tick(8);
  assert.match(t.$("coach-out").textContent, /unavailable right now/);
  assert.equal(t.$("coach-btn").disabled, false);
  assert.ok(t.doc.querySelectorAll("#result li").length >= 3, "tips still shown");
  assert.equal(t.$("draft").value, FLAGGED);
  status = 429;
  t.click(t.$("coach-btn")); await tick(8);
  assert.match(t.$("coach-out").textContent, /Too many requests/);
});

test("button is disabled while a request is pending (no duplicate requests)", async () => {
  const t = await mount({ coach: () => null });         // never resolves
  await t.check(FLAGGED);
  t.click(t.$("coach-btn")); await tick();
  assert.equal(t.$("coach-btn").disabled, true);
  t.click(t.$("coach-btn")); await tick();
  assert.equal(t.coachCalls.length, 1);
});

test("support routing: no coaching offered and no request sent", async () => {
  const t = await mount();
  await t.check("I want to kill myself");
  assert.match(t.resultText(), /findahelpline\.com/);
  assert.equal(t.$("coach-btn"), null);
  assert.equal(t.coachCalls.length, 0);
});

test("model text is rendered as text, never as HTML", async () => {
  const evil = { aggressive: true, feeling: '<img src=x onerror="window.__pwned=1">', impact: "<b>bold</b>", tip: "<script>window.__pwned=2</script>", starter: "<svg onload=1>" };
  const t = await mount({ coach: () => okJson(evil) });
  await t.check(FLAGGED);
  t.click(t.$("coach-btn")); await tick(8);
  const out = t.$("coach-out");
  assert.equal(out.querySelector("img, script, svg, b"), null);
  assert.match(out.textContent, /<img src=x/);
  assert.equal(t.win.__pwned, undefined);
});

test("nothing is persisted: no storage, cookies or URL/history changes", async () => {
  const t = await mount({ coach: () => okJson(SUGG) });
  await t.check(FLAGGED);
  t.click(t.$("coach-btn")); await tick(8);
  t.type(t.$("reflection"), "private reflection text");
  t.click(t.$("write-revision"));
  t.type(t.$("revision"), "I feel ignored when you interrupt me.");
  t.click(t.$("check-revision")); await tick();
  assert.equal(t.win.localStorage.length, 0);
  assert.equal(t.win.sessionStorage.length, 0);
  assert.equal(t.win.document.cookie, "");
  assert.equal(t.win.location.href, "https://drmurtadha.github.io/think-before-you-send/");
});

test("revision flow compares original and revision locally; reset clears everything", async () => {
  const t = await mount();
  await t.check(FLAGGED);
  assert.equal(t.$("reflect").hidden, false);
  t.click(t.$("write-revision"));
  assert.equal(t.$("revision-wrap").hidden, false);
  t.type(t.$("revision"), "I feel ignored when meetings start without me. Could we agree a time?");
  t.click(t.$("check-revision")); await tick();
  const txt = t.$("revision-result").textContent;
  assert.match(txt, /Original draft/);
  assert.match(txt, /Your revision/);
  assert.match(txt, /not a measure of learning/i);
  assert.equal(t.coachCalls.length, 0);
  t.click(t.$("reset")); await tick();
  assert.equal(t.$("draft").value, "");
  assert.equal(t.$("revision").value, "");
  assert.equal(t.$("reflection").value, "");
  assert.equal(t.resultText(), "");
  assert.equal(t.$("revision-result").textContent, "");
  assert.equal(t.$("reflect").hidden, true);
});

test("reset cancels a pending request so a late reply cannot appear", async () => {
  let resolveCoach;
  const t = await mount({ coach: (_b, resolve) => { resolveCoach = () => resolve(okJson(SUGG)); } });
  await t.check(FLAGGED);
  t.click(t.$("coach-btn")); await tick();
  t.click(t.$("reset")); await tick();
  if (resolveCoach) resolveCoach();
  await tick(8);
  assert.equal(t.resultText(), "");
});
