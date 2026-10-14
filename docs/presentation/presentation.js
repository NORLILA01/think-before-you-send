/* Think Before You Send: presentation controls.
   Previous/Next buttons, ArrowLeft/ArrowRight/PageUp/PageDown/Home/End, slide number in the URL hash.
   No auto-advance. Keys are ignored while typing in a field or when a modifier key is held. */
(function () {
  "use strict";
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var canvas = document.getElementById("canvas");
  var prev = document.getElementById("prev"), next = document.getElementById("next"), pos = document.getElementById("pos");
  var index = 0;

  function fromHash() {
    var n = parseInt((location.hash || "").replace("#", ""), 10);
    return n >= 1 && n <= slides.length ? n - 1 : 0;
  }
  function show(i, updateHash) {
    index = Math.max(0, Math.min(slides.length - 1, i));
    slides.forEach(function (s, k) { s.hidden = k !== index; });
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    pos.textContent = "Slide " + (index + 1) + " of " + slides.length;
    if (updateHash) history.replaceState(null, "", "#" + (index + 1));
  }
  function fit() {
    var vp = canvas.parentElement.getBoundingClientRect();
    var s = Math.min(vp.width / 1280, vp.height / 720);
    canvas.style.setProperty("--scale", String(Math.max(0.2, s)));
  }
  function typing(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  prev.addEventListener("click", function () { show(index - 1, true); });
  next.addEventListener("click", function () { show(index + 1, true); });
  document.addEventListener("keydown", function (e) {
    if (e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
    var k = e.key, handled = true;
    if (k === "ArrowRight" || k === "PageDown") show(index + 1, true);
    else if (k === "ArrowLeft" || k === "PageUp") show(index - 1, true);
    else if (k === "Home") show(0, true);
    else if (k === "End") show(slides.length - 1, true);
    else handled = false;
    if (handled) e.preventDefault();
  });
  window.addEventListener("hashchange", function () { show(fromHash(), false); });
  window.addEventListener("resize", fit);
  window.addEventListener("beforeprint", function () { canvas.style.setProperty("--scale", "1"); });
  window.addEventListener("afterprint", fit);

  fit();
  show(fromHash(), false);
})();
