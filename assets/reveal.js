// Gentle scroll-reveal for sections. Progressive enhancement: if JS or
// IntersectionObserver is missing, or reduced-motion is on, everything is
// simply visible.
(function () {
  var els = document.querySelectorAll('.reveal');
  if (!els.length) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach(function (el) { el.classList.add('is-visible'); });
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

  els.forEach(function (el) { io.observe(el); });
})();

// Inline spoilers: hide a value behind a solid bar until the reader clicks
// (or presses Enter/Space on) it. The blur/bar is done in CSS, so this only
// adds the click-to-reveal, the keyboard support, and the ARIA wiring, and
// authors just write <span class="spoiler">value</span>.
(function () {
  var spoilers = document.querySelectorAll('.spoiler');
  if (!spoilers.length) return;

  spoilers.forEach(function (s) {
    s.setAttribute('tabindex', '0');
    s.setAttribute('role', 'button');
    if (!s.hasAttribute('aria-label')) {
      s.setAttribute('aria-label', 'Spoiler, click to reveal');
    }
  });

  document.addEventListener('click', function (e) {
    var s = e.target.closest('.spoiler');
    if (s) s.classList.toggle('revealed');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var a = document.activeElement;
    if (a && a.classList && a.classList.contains('spoiler')) {
      e.preventDefault();
      a.classList.toggle('revealed');
    }
  });
})();
