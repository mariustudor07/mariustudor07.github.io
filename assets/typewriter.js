// Lightweight rotating typewriter for the hero tagline. No dependencies.
(function () {
  var el = document.getElementById('typewriter');
  if (!el) return;
  var lines;
  try { lines = JSON.parse(el.getAttribute('data-lines')); } catch (e) { return; }
  if (!lines || !lines.length) return;

  // Respect users who prefer reduced motion.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = lines[0];
    return;
  }

  var i = 0, j = 0, deleting = false;
  function tick() {
    var current = lines[i];
    el.textContent = current.slice(0, j);
    if (!deleting && j < current.length) {
      j++;
      setTimeout(tick, 45);
    } else if (!deleting && j === current.length) {
      deleting = true;
      setTimeout(tick, 1800);
    } else if (deleting && j > 0) {
      j--;
      setTimeout(tick, 25);
    } else {
      deleting = false;
      i = (i + 1) % lines.length;
      setTimeout(tick, 250);
    }
  }
  tick();
})();
