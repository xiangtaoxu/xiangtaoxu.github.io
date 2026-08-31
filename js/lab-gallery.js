/*
  lab-gallery.js — the auto-cycling lab photo gallery on the Team page.

  The slides are plain <figure> elements already in team.qmd, newest first; this
  file only decides which one is visible. Timing follows the rule "linger on the
  newest photo, flip through the history": the first slide holds for HOLD_FIRST,
  every other slide for HOLD_REST, then it wraps back to the newest.

  Nothing here is page-specific beyond the container class, so a second gallery
  elsewhere would work by copying the markup.

  Two courtesies to the reader:
    - hovering, focusing a dot, or leaving the tab pauses the timer;
    - "prefers-reduced-motion" turns autoplay off entirely (the dots still work).

  No build step, no dependencies.
*/

(function () {
  "use strict";

  var HOLD_FIRST = 10000;  // ms on the newest photo
  var HOLD_REST = 3000;    // ms on each older photo

  function initGallery(root) {
    var slides = Array.prototype.slice.call(
      root.querySelectorAll(".lab-gallery__slide")
    );
    if (slides.length < 2) return;   // one photo: leave it as a static image

    var dotBar = root.querySelector(".lab-gallery__dots");
    var timer = null;
    var paused = false;
    var index = 0;

    var reduceMotion = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;

    // ---- dots: one button per slide, also the manual control ----
    var dots = slides.map(function (slide, i) {
      var label = slide.getAttribute("data-label") || "Photo " + (i + 1);
      var dot = document.createElement("button");
      dot.type = "button";
      dot.className = "lab-gallery__dot";
      dot.setAttribute("aria-label", label);
      dot.addEventListener("click", function () {
        show(i);
        restart();          // a click re-bases the timer on the chosen slide
      });
      dotBar.appendChild(dot);
      return dot;
    });

    function show(i) {
      index = (i + slides.length) % slides.length;
      slides.forEach(function (slide, j) {
        slide.classList.toggle("is-active", j === index);
        slide.setAttribute("aria-hidden", j === index ? "false" : "true");
      });
      dots.forEach(function (dot, j) {
        dot.classList.toggle("is-active", j === index);
        dot.setAttribute("aria-current", j === index ? "true" : "false");
      });
    }

    function restart() {
      window.clearTimeout(timer);
      if (paused || (reduceMotion && reduceMotion.matches)) return;
      timer = window.setTimeout(function () {
        show(index + 1);
        restart();
      }, index === 0 ? HOLD_FIRST : HOLD_REST);
    }

    function setPaused(value) {
      paused = value;
      restart();
    }

    root.addEventListener("mouseenter", function () { setPaused(true); });
    root.addEventListener("mouseleave", function () { setPaused(false); });
    root.addEventListener("focusin", function () { setPaused(true); });
    root.addEventListener("focusout", function () { setPaused(false); });
    document.addEventListener("visibilitychange", function () {
      setPaused(document.hidden);
    });
    if (reduceMotion && reduceMotion.addEventListener) {
      reduceMotion.addEventListener("change", restart);
    }

    root.classList.add("is-live");   // reveals the dots; without JS they'd do nothing
    show(0);
    restart();
  }

  function init() {
    var galleries = document.querySelectorAll(".lab-gallery");
    Array.prototype.forEach.call(galleries, initGallery);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
