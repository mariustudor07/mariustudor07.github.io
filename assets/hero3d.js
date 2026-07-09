// Lightweight, dependency-free 3D wireframe icosahedron on <canvas>.
// Reads as a constellation / network graph, on-brand for security, and it
// can't "break ugly" the way a heavy 3D lib can. Respects reduced-motion.
(function () {
  var canvas = document.getElementById('hero-canvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  // Accent colour pulled live from CSS so it tracks light/dark themes.
  function accent() {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--accent');
    return (v || '#2ee6a0').trim();
  }

  // Icosahedron: 12 vertices from the golden ratio.
  var t = (1 + Math.sqrt(5)) / 2;
  var V = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]
  ];
  // Normalise to unit-ish radius.
  var R = Math.hypot(1, t);
  V = V.map(function (p) { return [p[0] / R, p[1] / R, p[2] / R]; });

  // Edges = vertex pairs at minimal distance.
  var E = [];
  var minD2 = Infinity;
  for (var a = 0; a < V.length; a++) {
    for (var b = a + 1; b < V.length; b++) {
      var d2 = 0;
      for (var k = 0; k < 3; k++) { var d = V[a][k] - V[b][k]; d2 += d * d; }
      minD2 = Math.min(minD2, d2);
    }
  }
  for (a = 0; a < V.length; a++) {
    for (b = a + 1; b < V.length; b++) {
      d2 = 0;
      for (k = 0; k < 3; k++) { d = V[a][k] - V[b][k]; d2 += d * d; }
      if (d2 < minD2 * 1.1) E.push([a, b]);
    }
  }

  var W = 0, H = 0, DPR = 1;
  function resize() {
    var rect = canvas.getBoundingClientRect();
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  function project(p, rx, ry) {
    // rotate Y then X
    var cy = Math.cos(ry), sy = Math.sin(ry);
    var x = p[0] * cy - p[2] * sy;
    var z = p[0] * sy + p[2] * cy;
    var cx = Math.cos(rx), sx = Math.sin(rx);
    var y = p[1] * cx - z * sx;
    z = p[1] * sx + z * cx;
    var scale = Math.min(W, H) * 0.34;
    var persp = 2.6 / (2.6 - z * 0.85);
    return { x: W / 2 + x * scale * persp, y: H / 2 + y * scale * persp, z: z };
  }

  function frame(rx, ry) {
    ctx.clearRect(0, 0, W, H);
    var col = accent();
    var pts = V.map(function (p) { return project(p, rx, ry); });

    // edges
    ctx.lineWidth = 1;
    for (var i = 0; i < E.length; i++) {
      var p1 = pts[E[i][0]], p2 = pts[E[i][1]];
      var depth = (p1.z + p2.z) / 2;              // -1..1
      ctx.globalAlpha = 0.18 + (depth + 1) * 0.22; // back edges fainter
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // vertices as glowing nodes
    for (i = 0; i < pts.length; i++) {
      var pt = pts[i];
      var a = 0.4 + (pt.z + 1) * 0.3;
      var r = 1.6 + (pt.z + 1) * 1.6;
      ctx.globalAlpha = a;
      ctx.fillStyle = col;
      ctx.shadowColor = col;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { frame(0.5, 0.6); return; }

  var start = performance.now();
  function loop(now) {
    var s = (now - start) / 1000;
    frame(0.42 + Math.sin(s * 0.25) * 0.18, s * 0.28);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
