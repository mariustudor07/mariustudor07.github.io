// Client-side category filter + search for the blog list.
(function () {
  var filters = document.getElementById('filters');
  var search = document.getElementById('search');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.post-card'));
  var noResults = document.getElementById('no-results');
  var activeCategory = 'all';

  function apply() {
    var q = (search.value || '').trim().toLowerCase();
    var visible = 0;
    cards.forEach(function (card) {
      var matchCat = activeCategory === 'all' || card.getAttribute('data-category') === activeCategory;
      var matchText = q === '' || (card.getAttribute('data-search') || '').indexOf(q) !== -1;
      var show = matchCat && matchText;
      card.hidden = !show;
      if (show) visible++;
    });
    noResults.hidden = visible !== 0;
  }

  filters.addEventListener('click', function (e) {
    var btn = e.target.closest('.filter');
    if (!btn) return;
    activeCategory = btn.getAttribute('data-category');
    filters.querySelectorAll('.filter').forEach(function (b) { b.classList.remove('active'); });
    btn.classList.add('active');
    apply();
  });

  search.addEventListener('input', apply);
})();
