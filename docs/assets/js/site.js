/* Think Before You Send: page behaviour.
   - Draft checking runs locally with detector.js + model.json.
   - AI coaching is requested only by an explicit button click and goes to the Worker below.
   - Nothing is persisted: no localStorage, cookies, URLs or analytics. */
(function () {
  "use strict";

  var WORKER_URL = "https://think-before-you-send.drmurtadha.workers.dev";
  var MAX = 500;
  var SELF_HARM = /\b(kill(ing)? myself|end(ing)? my life|want to die|wanna die|suicid\w*|don'?t want to (live|be here|exist)|better off dead)\b/i;
  var TIPS = [
    "Name the situation and the feeling instead of the person: “I felt ignored” lands differently from “You never listen.”",
    "Describe what happened, not what the other person is.",
    "Say what you need next, in one sentence.",
    "If you are very angry, wait ten minutes before sending anything."
  ];
  var EXAMPLES = [
    { draft: "You never do your part.", rev: "Can we agree on what each of us will finish today?" },
    { draft: "You are such an idiot. You never do your part.",
      rev: "I'm frustrated that the slides aren't ready because our deadline is tomorrow. Can you send your section by 6 pm, or tell us what help you need?" }
  ];

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var draft = $("draft"), count = $("count"), checkBtn = $("check"), statusEl = $("status"),
      result = $("result"), draftError = $("draft-error"),
      reflect = $("reflect"), reflection = $("reflection"),
      writeRevisionBtn = $("write-revision"), resetBtn = $("reset"),
      revWrap = $("revision-wrap"), revision = $("revision"), revCount = $("revision-count"),
      revError = $("revision-error"), checkRevBtn = $("check-revision"), revResult = $("revision-result");

  var state = {
    detector: null,
    rev: 0,               // increments on every check, edit-after-check, and reset
    checked: null,        // { text, kind, rev } for the draft the visible result belongs to
    original: null,       // { text, kind } snapshot used for the original/revision comparison
    controller: null      // AbortController of the in-flight coaching request
  };

  // ---------- helpers ----------
  function setStatus(msg) { statusEl.textContent = msg; }
  function showError(node, input, msg) {
    node.textContent = msg; node.hidden = false; input.setAttribute("aria-invalid", "true");
  }
  function clearError(node, input) {
    node.textContent = ""; node.hidden = true; input.removeAttribute("aria-invalid");
  }
  function updateCount(input, out) { out.textContent = input.value.length + " / " + MAX; }
  function cancelPending() {
    if (state.controller) { state.controller.abort(); state.controller = null; }
  }
  function assess(text) {
    if (SELF_HARM.test(text)) return { kind: "support" };
    return { kind: state.detector.check(text).band };   // "ok" | "borderline" | "block"
  }

  // ---------- result rendering ----------
  function tipsList() {
    var ul = el("ul");
    TIPS.forEach(function (t) { ul.appendChild(el("li", null, t)); });
    return ul;
  }
  function panel(kind, tag, title) {
    var p = el("div", "panel panel--" + kind);
    if (tag) p.appendChild(el("span", "tag", tag));
    p.appendChild(el("h3", null, title));
    return p;
  }
  function supportPanel() {
    var p = panel("warn", "Support", "This sounds like it may be about you, not someone else");
    p.appendChild(el("p", null, "If you are thinking about hurting yourself, please contact local emergency services or a crisis line now, or talk to someone you trust. You can find a crisis line for your country at findahelpline.com."));
    p.appendChild(el("p", null, "This tool is not able to help with that, so it offers no coaching here."));
    return p;
  }
  function resultPanel(kind, withCoach) {
    var p;
    if (kind === "support") return supportPanel();
    if (kind === "ok") {
      p = panel("ok", "No wording flagged", "The checker did not flag this wording");
      p.appendChild(el("p", null, "The checker misses some things and cannot judge context. Read the message once more as the person receiving it would."));
      return p;
    }
    if (kind === "borderline") {
      p = panel("warn", "Worth a second look", "Some wording may come across as aggressive");
      p.appendChild(el("p", null, "It is close to the line. Think about how the other person may read it."));
    } else {
      p = panel("bad", "Wording flagged", "This wording may come across as aggressive");
      p.appendChild(el("p", null, "Before sending it anywhere, try one of these:"));
    }
    p.appendChild(tipsList());
    if (withCoach && WORKER_URL) p.appendChild(coachBox(kind));
    return p;
  }

  function coachBox(kind) {
    var box = el("div", "coach-box");
    box.appendChild(el("p", "disclosure", "This sends the checked draft to a third-party AI service."));
    var btn = el("button", "btn btn--secondary", kind === "borderline" ? "Get a second opinion from AI" : "Get AI coaching for this draft");
    btn.type = "button";
    btn.id = "coach-btn";
    var out = el("div", "coach-out");
    out.id = "coach-out";
    out.setAttribute("aria-live", "polite");
    btn.addEventListener("click", function () { requestCoaching(btn, out); });
    box.appendChild(btn);
    box.appendChild(out);
    return box;
  }

  function renderSuggestions(out, c) {
    out.replaceChildren();
    out.appendChild(el("h4", null, "AI suggestions, not a verdict"));
    if (c.aggressive === false) {
      out.appendChild(el("p", null, "The AI read this wording as direct rather than aggressive. You can still adjust it."));
    }
    var dl = el("dl", "suggestion");
    [["Possible feeling or need", c.feeling], ["How it may land", c.impact], ["A tip", c.tip]].forEach(function (kv) {
      if (!kv[1]) return;
      dl.appendChild(el("dt", null, kv[0]));
      dl.appendChild(el("dd", null, kv[1]));
    });
    if (c.starter) {
      dl.appendChild(el("dt", null, "Start your own version with"));
      dl.appendChild(el("dd", "starter", "“" + c.starter + " …”"));
    }
    out.appendChild(dl);
    out.appendChild(el("p", null, "These suggestions may be wrong. Use your own judgement and write your own words."));
  }

  function requestCoaching(btn, out) {
    if (btn.disabled) return;            // a request is already in flight
    var snapshot = state.checked;
    if (!snapshot || (snapshot.kind !== "block" && snapshot.kind !== "borderline")) return;
    cancelPending();
    var controller = new AbortController();
    state.controller = controller;
    var myRev = snapshot.rev;
    btn.disabled = true;
    btn.textContent = "Requesting suggestions…";
    out.replaceChildren();
    setStatus("Requesting AI suggestions for the checked draft…");

    function stillCurrent() { return state.checked && state.checked.rev === myRev && state.controller === controller; }

    fetch(WORKER_URL.replace(/\/$/, "") + "/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: snapshot.text, band: snapshot.kind }),
      signal: controller.signal
    }).then(function (r) {
      if (!r.ok) { var e = new Error("http"); e.status = r.status; throw e; }
      return r.json();
    }).then(function (c) {
      if (!stillCurrent()) return;             // draft changed or a newer check ran: ignore this reply
      state.controller = null;
      renderSuggestions(out, c);
      btn.disabled = false;
      btn.textContent = "Ask again";
      setStatus("AI suggestions are ready below the tips.");
    }).catch(function (err) {
      if (err && err.name === "AbortError") return;
      if (!stillCurrent()) return;
      state.controller = null;
      btn.disabled = false;
      btn.textContent = "Try AI coaching again";
      out.replaceChildren();
      var limited = err && err.status === 429;
      out.appendChild(el("p", "field-error", limited
        ? "Too many requests right now. Please wait a minute, then try again."
        : "AI coaching is unavailable right now. The tips above still apply, and your draft is unchanged."));
      setStatus("AI coaching could not be completed.");
    });
  }

  // ---------- main check ----------
  function clearResult() { result.replaceChildren(); }

  function runCheck() {
    if (!state.detector) return;
    var text = draft.value.trim();
    cancelPending();
    if (!text) {
      clearResult();
      state.checked = null;
      state.rev++;
      showError(draftError, draft, "Write a message first, or choose a practice scenario above.");
      setStatus("");
      draft.focus();
      return;
    }
    clearError(draftError, draft);
    var a = assess(text);
    state.rev++;
    state.checked = { text: text, kind: a.kind, rev: state.rev };
    state.original = { text: text, kind: a.kind };
    result.replaceChildren(resultPanel(a.kind, true));
    reflect.hidden = a.kind === "support";
    // a new check makes any earlier revision result out of date
    revResult.replaceChildren();
    var msgs = {
      ok: "Result: no wording flagged.",
      borderline: "Result: some wording may come across as aggressive. Optional AI second opinion available.",
      block: "Result: this wording may come across as aggressive. Optional AI coaching available.",
      support: "This message sounds like it may be about you. Support information is shown."
    };
    setStatus(msgs[a.kind]);
  }

  function onDraftInput() {
    updateCount(draft, count);
    if (draft.getAttribute("aria-invalid")) clearError(draftError, draft);
    if (state.checked && draft.value.trim() !== state.checked.text) {
      cancelPending();
      state.rev++;                // invalidates any reply still in flight
      state.checked = null;
      clearResult();
      setStatus("Your draft changed. Check it again to get feedback on the new wording.");
    }
  }

  // ---------- reflection and revision ----------
  function compareView(origText, origKind, revText, revKind) {
    var wrap = el("div", "compare");
    function col(label, text, kind) {
      var c = el("div", "compare__col");
      c.appendChild(el("h4", null, label));
      c.appendChild(el("p", null, text));
      var note = { ok: "Checker: no wording flagged", borderline: "Checker: worth a second look", block: "Checker: wording flagged", support: "Support information shown" }[kind];
      c.appendChild(el("span", "tag", note));
      return c;
    }
    wrap.appendChild(col("Original draft", origText, origKind));
    wrap.appendChild(col("Your revision", revText, revKind));
    return wrap;
  }

  function runRevisionCheck() {
    if (!state.detector) return;
    var text = revision.value.trim();
    if (!text) {
      revResult.replaceChildren();
      showError(revError, revision, "Write your revision first.");
      revision.focus();
      return;
    }
    clearError(revError, revision);
    var a = assess(text);
    var orig = state.original || { text: draft.value.trim(), kind: "ok" };
    revResult.replaceChildren();
    revResult.appendChild(compareView(orig.text, orig.kind, text, a.kind));
    var p = resultPanel(a.kind, false);
    p.style.marginTop = "1rem";
    revResult.appendChild(p);
    revResult.appendChild(el("p", "field-hint", "Passing the checker is not a measure of learning. Compare the two versions and explain your choices."));
    setStatus("Revision checked locally. Nothing was sent to an AI service.");
  }

  function reset() {
    cancelPending();
    state.rev++;
    state.checked = null;
    state.original = null;
    draft.value = ""; reflection.value = ""; revision.value = "";
    updateCount(draft, count); updateCount(revision, revCount);
    clearError(draftError, draft); clearError(revError, revision);
    clearResult(); revResult.replaceChildren();
    revWrap.hidden = true; reflect.hidden = true;
    setStatus("Practice cleared. Nothing was kept.");
    draft.focus();
  }

  // ---------- wiring ----------
  draft.addEventListener("input", onDraftInput);
  revision.addEventListener("input", function () {
    updateCount(revision, revCount);
    if (revision.getAttribute("aria-invalid")) clearError(revError, revision);
    revResult.replaceChildren();
  });
  checkBtn.addEventListener("click", runCheck);
  checkRevBtn.addEventListener("click", runRevisionCheck);
  resetBtn.addEventListener("click", reset);
  writeRevisionBtn.addEventListener("click", function () {
    revWrap.hidden = false;
    revision.focus();
  });
  Array.prototype.forEach.call(document.querySelectorAll(".scenario"), function (b) {
    b.addEventListener("click", function () {
      draft.value = b.getAttribute("data-text");
      onDraftInput();
      clearError(draftError, draft);
      setStatus("Practice scenario loaded. Choose “Check my message” when you are ready.");
      draft.focus();
    });
  });
  var cta = $("cta-try");
  if (cta) cta.addEventListener("click", function (e) {
    e.preventDefault();
    draft.scrollIntoView({ block: "center", behavior: "auto" });
    draft.focus({ preventScroll: true });
  });

  // hero example: user-triggered swap with a short fade
  var exIndex = 0, exToggle = $("ex-toggle");
  if (exToggle) exToggle.addEventListener("click", function () {
    exIndex = (exIndex + 1) % EXAMPLES.length;
    var boxes = [$("ex-draft-box"), $("ex-rev-box")];
    function swap() {
      $("ex-draft").textContent = EXAMPLES[exIndex].draft;
      $("ex-rev").textContent = EXAMPLES[exIndex].rev;
      boxes.forEach(function (b) { b.classList.remove("is-fading"); });
    }
    if (reduceMotion) { swap(); return; }
    boxes.forEach(function (b) { b.classList.add("is-fading"); });
    setTimeout(swap, 180);
  });

  // ---------- model loading ----------
  function loadModel() {
    checkBtn.disabled = true;
    setStatus("Loading the checker…");
    result.replaceChildren();
    fetch("model.json").then(function (r) {
      if (!r.ok) throw new Error("model " + r.status);
      return r.json();
    }).then(function (m) {
      state.detector = AggressionDetector.create(m);
      checkBtn.disabled = false;
      setStatus("The checker is ready. Write a message or choose a scenario.");
    }).catch(function () {
      var p = panel("bad", "Checker unavailable", "The checker could not load");
      p.appendChild(el("p", null, "The model file did not download. Check your connection, then try again. If you opened this page as a local file, serve it from a web server instead."));
      var retry = el("button", "btn btn--secondary", "Retry loading the checker");
      retry.type = "button";
      retry.addEventListener("click", loadModel);
      p.appendChild(retry);
      result.replaceChildren(p);
      setStatus("The checker could not load.");
    });
  }

  updateCount(draft, count);
  updateCount(revision, revCount);
  loadModel();
})();
