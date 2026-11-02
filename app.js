// PieFlag — posterise a flag image and chart how much of it each colour covers.
const $ = (id) => document.getElementById(id);
const fileInput = $('file'), slider = $('colours'), sliderOut = $('coloursOut');
const drop = $('drop'), hint = $('hint'), canvas = $('preview');
const pie = $('pie'), legend = $('legend'), summary = $('summary'), saveBtn = $('save'), saveChartBtn = $('saveChart');

const MAX_PREVIEW = 960; // preview is processed at most this size
const MIN_PCT = 1;       // colours covering less than this % are hidden from the chart

let source = null;   // the loaded image
let palette = [];    // current [r, g, b] colours
let slices = [];     // colours shown in the chart: { hex, frac }
let fileName = 'flag';

const toHex = ([r, g, b]) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1).toUpperCase();
const dist = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

function getPixels(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// Pick k colours: start from the most common colour, keep adding the colour that is
// both common and far from those already chosen, then refine with weighted k-means.
function findPalette(data, k) {
  const counts = new Map();
  const step = Math.max(1, Math.floor(data.length / 4 / 50000)) * 4;
  for (let i = 0; i < data.length; i += step) {
    if (data[i + 3] < 128) continue;
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const colours = [...counts].map(([key, n]) => ({ c: [key >> 16, (key >> 8) & 255, key & 255], n }));
  if (!colours.length) return [[0, 0, 0]];
  colours.sort((a, b) => b.n - a.n);

  const centres = [colours[0].c];
  while (centres.length < k) {
    let best = null, bestScore = 0;
    for (const { c, n } of colours) {
      const score = n * Math.min(...centres.map((m) => dist(c, m)));
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best) break; // fewer distinct colours than k
    centres.push(best);
  }

  for (let iter = 0; iter < 10; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const { c, n } of colours) {
      const s = sums[nearest(c, centres)];
      s[0] += c[0] * n; s[1] += c[1] * n; s[2] += c[2] * n; s[3] += n;
    }
    sums.forEach((s, i) => { if (s[3]) centres[i] = [0, 1, 2].map((j) => Math.round(s[j] / s[3])); });
  }
  return centres;
}

function nearest(c, centres) {
  let best = 0;
  for (let i = 1; i < centres.length; i++) if (dist(c, centres[i]) < dist(c, centres[best])) best = i;
  return best;
}

// Recolour pixels in place to their nearest palette colour; return pixel counts per colour.
function posterise(img) {
  const d = img.data, counts = palette.map(() => 0), cache = new Map();
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { d[i + 3] = 0; continue; }
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    let idx = cache.get(key);
    if (idx === undefined) cache.set(key, (idx = nearest([d[i], d[i + 1], d[i + 2]], palette)));
    [d[i], d[i + 1], d[i + 2]] = palette[idx];
    d[i + 3] = 255;
    counts[idx]++;
  }
  return counts;
}

function render() {
  if (!source) return;
  const img = getPixels(canvas.width, canvas.height);
  palette = findPalette(img.data, +slider.value);
  const counts = posterise(img);
  canvas.getContext('2d').putImageData(img, 0, 0);
  drawChart(counts);
}

function drawChart(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  const shown = palette
    .map((c, i) => ({ c, n: counts[i] }))
    .filter((x) => total && (x.n / total) * 100 >= MIN_PCT)
    .sort((a, b) => b.n - a.n);
  const shownTotal = shown.reduce((a, x) => a + x.n, 0);
  const hidden = counts.filter((n) => n > 0).length - shown.length;

  summary.textContent = `${shown.length} colour${shown.length === 1 ? '' : 's'}` +
    (hidden > 0 ? ` • ${hidden} under ${MIN_PCT}% hidden` : '');

  slices = shown.map(({ c, n }) => ({ hex: toHex(c), frac: n / shownTotal }));

  pie.innerHTML = '';
  legend.innerHTML = '';
  let angle = -Math.PI / 2;
  for (const { hex, frac } of slices) {
    let el;
    if (frac > 0.9999) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      el.setAttribute('r', 1);
    } else {
      const end = angle + frac * 2 * Math.PI;
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('d', `M0 0 L${Math.cos(angle)} ${Math.sin(angle)} A1 1 0 ${frac > 0.5 ? 1 : 0} 1 ${Math.cos(end)} ${Math.sin(end)}Z`);
      angle = end;
    }
    el.setAttribute('fill', hex);
    pie.appendChild(el);

    const li = document.createElement('li');
    li.innerHTML = `<span class="swatch" style="background:${hex}"></span>` +
      `<button type="button" class="hex" title="Copy">${hex}</button>` +
      `<span class="pct">${(frac * 100).toFixed(1)}%</span>`;
    const btn = li.querySelector('.hex');
    btn.onclick = () => navigator.clipboard.writeText(hex).then(() => {
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = hex), 1000);
    });
    legend.appendChild(li);
  }
  pie.hidden = false;
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) return alert('Please choose an image file.');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    source = img;
    fileName = file.name.replace(/\.[^.]+$/, '') || 'flag';
    const w = img.naturalWidth || 600, h = img.naturalHeight || 400;
    const scale = Math.min(1, MAX_PREVIEW / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.hidden = false;
    hint.hidden = true;
    saveBtn.disabled = saveChartBtn.disabled = false;
    render();
  };
  img.onerror = () => alert('Could not read that image.');
  img.src = url;
}

fileInput.onchange = () => { loadFile(fileInput.files[0]); fileInput.value = ''; };

slider.oninput = () => { sliderOut.textContent = slider.value; render(); };

drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('dragging'); };
drop.ondragleave = () => drop.classList.remove('dragging');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('dragging');
  loadFile(e.dataTransfer.files[0]);
};

// Save at the original resolution, using the palette chosen for the preview.
saveBtn.onclick = () => {
  const img = getPixels(source.naturalWidth || canvas.width, source.naturalHeight || canvas.height);
  posterise(img);
  const out = document.createElement('canvas');
  out.width = img.width;
  out.height = img.height;
  out.getContext('2d').putImageData(img, 0, 0);
  download(out, `${fileName}-posterised.png`);
};

// Save the pie chart with its colour list as a PNG.
saveChartBtn.onclick = () => {
  const size = 400, pad = 32, rowH = 34, listW = 240;
  const c = document.createElement('canvas');
  c.width = pad * 3 + size + listW;
  c.height = pad * 2 + Math.max(size, slices.length * rowH);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#d9dde4';
  ctx.lineWidth = 2;

  const cx = pad + size / 2, cy = pad + size / 2;
  let angle = -Math.PI / 2;
  for (const { hex, frac } of slices) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, size / 2, angle, (angle += frac * 2 * Math.PI));
    ctx.closePath();
    ctx.fillStyle = hex;
    ctx.fill();
    if (slices.length > 1) ctx.stroke();
  }
  if (slices.length === 1) { ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, 2 * Math.PI); ctx.stroke(); }

  const x = pad * 2 + size;
  ctx.textBaseline = 'middle';
  slices.forEach(({ hex, frac }, i) => {
    const y = pad + i * rowH + rowH / 2;
    ctx.fillStyle = hex;
    ctx.fillRect(x, y - 10, 20, 20);
    ctx.strokeRect(x, y - 10, 20, 20);
    ctx.fillStyle = '#1b1f27';
    ctx.font = '600 17px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(hex, x + 32, y);
    ctx.font = '17px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`${(frac * 100).toFixed(1)}%`, c.width - pad, y);
  });
  download(c, `${fileName}-pie-chart.png`);
};

function download(canvasEl, name) {
  canvasEl.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}
