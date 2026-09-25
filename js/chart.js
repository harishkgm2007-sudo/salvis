/**
 * Interactive Canvas Trajectory Chart Renderer
 * Dynamic month labels, animated progressive draw, hover tooltip, responsive resize
 */

class TrajectoryChart {
  static _instances = {};

  static renderChart(canvasId, goals) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const inst = new TrajectoryChartInstance(canvas, goals);
    TrajectoryChart._instances[canvasId] = inst;
    return inst;
  }

  static rerenderAll() {
    Object.values(TrajectoryChart._instances).forEach((inst) => inst && inst.rerender());
  }
}

class TrajectoryChartInstance {
  constructor(canvas, goals) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.goals = goals || [];
    this.animationId = null;
    this.drawProgress = 1;
    this.hoverIndex = -1;
    this._destroyed = false;

    this._buildDataModel();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.rerender());
      this._ro.observe(canvas);
    }
    this.canvas.addEventListener('mousemove', (e) => this._onMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverIndex = -1;
      this._drawStatic();
    });
    this.canvas.addEventListener('click', (e) => this._onMove(e));
  }

  rerender() {
    if (this._destroyed) return;
    this._buildDataModel();
    this._startAnimation();
  }

  destroy() {
    this._destroyed = true;
    if (this._ro) this._ro.disconnect();
    if (this.animationId) cancelAnimationFrame(this.animationId);
  }

  _activeGoals() {
    return this.goals.filter((g) => g.status === 'active' || g.status === 'completed');
  }

  _buildDataModel() {
    const goals = this._activeGoals();
    if (goals.length === 0) {
      this.data = null;
      return;
    }

    const currency = (typeof SavingsCalculator !== 'undefined' ? SavingsCalculator : window.SavingsCalculator) || {};
    const fmt = currency.formatCurrency ? (v) => currency.formatCurrency(v) : (v) => `$${v.toFixed(2)}`;
    this.fmt = fmt;

    const now = new Date();
    const totalTarget = goals.reduce((s, g) => s + g.targetAmount, 0);
    const totalSaved = goals.reduce((s, g) => s + g.savedAmount, 0);

    // Timeline: earliest start (-buffer) -> latest target (+buffer)
    const dates = goals.map((g) => {
      const t = new Date(g.targetDate);
      return isNaN(t.getTime()) ? now.getTime() : t.getTime();
    });
    const targetEnd = new Date(Math.max(...dates, now.getTime()));
    const startDates = goals
      .map((g) => {
        const t = new Date(g.startDate);
        return isNaN(t.getTime()) ? now.getTime() : t.getTime();
      })
      .concat([now.getTime()]);
    const targetStart = new Date(Math.min(...startDates));

    targetEnd.setDate(targetEnd.getDate() + 5);
    targetStart.setDate(targetStart.getDate() - 5);

    // Build monthly buckets
    const buckets = [];
    const cur = new Date(targetStart);
    while (cur.getTime() <= targetEnd.getTime()) {
      buckets.push({
        label: cur.toLocaleDateString(undefined, { month: 'short' }),
        t: cur.getTime()
      });
      cur.setMonth(cur.getMonth() + 1);
    }
    if (buckets.length < 2) {
      buckets.push({ label: targetEnd.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), t: targetEnd.getTime() });
    }

    const totalSpan = targetEnd.getTime() - targetStart.getTime() || 1;

    // Projected: linear ramp across full timeline
    const projected = buckets.map((b, i) => {
      const fraction = buckets.length > 1 ? i / (buckets.length - 1) : 1;
      return totalTarget * fraction;
    });

    // Actual: cumulative from transaction deposits mapped into buckets
    let txs = [];
    try {
      const storage = typeof StorageService !== 'undefined' ? StorageService : window.StorageService;
      if (storage && storage.getTransactions) txs = storage.getTransactions();
    } catch (e) {}

    const fn = (t) => ((t - targetStart.getTime()) / totalSpan);
    const actual = buckets.map(() => 0);
    const deposits = txs
      .filter((tx) => tx && (tx.type === 'deposit' || tx.type === 'reallocate'))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let accum = 0;
    let idx = 0;
    deposits.forEach((tx) => {
      const t = new Date(tx.timestamp).getTime();
      accum += parseFloat(tx.amount) || 0;
      let i = idx;
      while (i < buckets.length - 1 && buckets[i + 1].t <= t) i++;
      actual[i] = Math.max(actual[i], accum);
      idx = i;
    });
    // Ensure final bucket reflects total saved
    actual[actual.length - 1] = Math.max(actual[actual.length - 1], totalSaved);
    // Fill forward
    let running = 0;
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] > 0) running = actual[i];
      else actual[i] = running;
    }
    for (let i = actual.length - 2; i >= 0; i--) {
      actual[i] = Math.max(actual[i], 0);
    }

    this.data = {
      buckets,
      projected,
      actual,
      totalTarget,
      totalSaved,
      maxVal: Math.max(100, totalTarget * 1.1)
    };
  }

  _startAnimation() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.drawProgress = 0;
    const start = performance.now();
    const duration = 900;
    const step = (t) => {
      if (this._destroyed) return;
      this.drawProgress = Math.min(1, (t - start) / duration);
      this._draw();
      if (this.drawProgress < 1) this.animationId = requestAnimationFrame(step);
      else this.animationId = null;
    };
    this.animationId = requestAnimationFrame(step);
  }

  _drawStatic() {
    this.drawProgress = 1;
    this._draw();
  }

  _dimensions() {
    const rect = this.canvas.getBoundingClientRect();
    const width = rect.width > 10 ? rect.width : (this.canvas.clientWidth || 680);
    const height = rect.height > 10 ? rect.height : (this.canvas.clientHeight || 300);
    return { width, height };
  }

  _draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const { width, height } = this._dimensions();
    const dpr = window.devicePixelRatio || 1;
    if (width <= 40 || height <= 40) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const data = this.data;
    if (!data) {
      ctx.fillStyle = isDark() ? '#64748b' : '#94a3b8';
      ctx.font = '13px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No active goal vaults to plot trajectory', width / 2, height / 2);
      return;
    }

    const isDarkTheme = isDark();
    const gridColor = isDarkTheme ? '#27354f' : '#eef2f7';
    const textColor = isDarkTheme ? '#94a3b8' : '#64748b';

    const topPad = 42;
    const bottomPad = 34;
    const pad = 44;
    const graphW = width - pad * 2;
    const graphH = height - topPad - bottomPad;
    const { buckets, projected, actual, maxVal } = data;

    const px = (i) => {
      const denom = Math.max(1, buckets.length - 1);
      return pad + (graphW / denom) * i;
    };
    const py = (v) => topPad + graphH - (v / maxVal) * graphH;

    // Grid + y labels
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = topPad + (graphH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
      const val = maxVal - (maxVal / 4) * i;
      ctx.fillStyle = textColor;
      ctx.font = '11px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(compactNumber(val), pad - 8, y + 4);
    }

    // x labels
    ctx.fillStyle = textColor;
    ctx.font = '11px Plus Jakarta Sans, sans-serif';
    ctx.textAlign = 'center';
    const labelStep = Math.max(1, Math.ceil(buckets.length / 8));
    buckets.forEach((b, idx) => {
      if (idx % labelStep === 0 || idx === buckets.length - 1) {
        ctx.fillText(b.label, px(idx), height - 10);
      }
    });

    const progress = this.drawProgress;
    const shownCount = Math.max(2, Math.ceil(buckets.length * progress));

    // Legend
    this._drawLegend(ctx, width, topPad, isDarkTheme);

    // Projected line (dashed)
    ctx.save();
    ctx.beginPath();
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    for (let i = 0; i < shownCount; i++) {
      const x = px(i);
      const y = py(projected[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();

    // Actual area + line (emerald)
    const shownActual = actual.slice(0, shownCount);
    const lastShown = shownCount - 1;
    const grad = ctx.createLinearGradient(0, topPad, 0, topPad + graphH);
    grad.addColorStop(0, 'rgba(16, 185, 129, 0.22)');
    grad.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    ctx.beginPath();
    let started = false;
    shownActual.forEach((v, i) => {
      if (!started) {
        ctx.moveTo(px(i), py(v));
        started = true;
      } else ctx.lineTo(px(i), py(v));
    });
    if (lastShown >= 0) {
      ctx.lineTo(px(lastShown), topPad + graphH);
      ctx.lineTo(px(0), topPad + graphH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.strokeStyle = '#059669';
    ctx.lineWidth = 3;
    started = false;
    shownActual.forEach((v, i) => {
      if (!started) {
        ctx.moveTo(px(i), py(v));
        started = true;
      } else ctx.lineTo(px(i), py(v));
    });
    ctx.stroke();

    // Nodes
    shownActual.forEach((v, i) => {
      if (v <= 0 && i !== shownActual.length - 1 && shownActual.length > 3) return;
      const x = px(i);
      const y = py(v);
      ctx.beginPath();
      ctx.arc(x, y, i === shownActual.length - 1 ? 5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#059669';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = isDarkTheme ? '#151d30' : '#ffffff';
      ctx.stroke();
    });

    // Hover guide
    if (this.hoverIndex >= 0 && this.hoverIndex < buckets.length) {
      const hx = px(this.hoverIndex);
      ctx.save();
      ctx.strokeStyle = isDarkTheme ? '#475569' : '#cbd5e1';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, topPad);
      ctx.lineTo(hx, topPad + graphH);
      ctx.stroke();
      ctx.restore();

      this._drawTooltip(ctx, hx, this.hoverIndex, topPad, graphH, width);
    }
  }

  _drawLegend(ctx, width, topPad, isDarkTheme) {
    const y = 18;
    let x = width - 20;
    const textColor = isDarkTheme ? '#94a3b8' : '#64748b';

    const drawItem = (label, color, dash) => {
      ctx.font = '11px Plus Jakarta Sans, sans-serif';
      const tw = ctx.measureText(label).width;
      x -= tw + 26;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash(dash || []);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 12, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = textColor;
      ctx.textAlign = 'left';
      ctx.fillText(label, x + 16, y + 4);
      x -= 10;
    };

    drawItem('Actual', '#059669', []);
    drawItem('Projected', '#2563eb', [5, 5]);
  }

  _drawTooltip(ctx, x, index, topPad, graphH, width) {
    const data = this.data;
    const bucket = data.buckets[index];
    const projected = data.projected[index];
    const actual = data.actual[index] || 0;
    const textColor = isDark() ? '#e2e8f0' : '#0f172a';

    const lines = [
      bucket.label,
      'Projected: ' + this.fmt(projected),
      'Actual: ' + this.fmt(actual)
    ];

    ctx.font = '11px Plus Jakarta Sans, sans-serif';
    let boxW = 0;
    lines.forEach((l) => (boxW = Math.max(boxW, ctx.measureText(l).width)));
    boxW += 20;
    const boxH = lines.length * 16 + 14;

    let boxX = x + 12;
    if (boxX + boxW > width - 6) boxX = x - boxW - 12;
    let boxY = Math.max(6, topPad + 4);

    ctx.save();
    ctx.fillStyle = isDark() ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)';
    ctx.strokeStyle = isDark() ? '#334155' : '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 12;
    drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.textAlign = 'left';
    ctx.fillStyle = isDark() ? '#38bdf8' : '#2563eb';
    ctx.fillText(lines[0], boxX + 10, boxY + 16);
    ctx.fillStyle = textColor;
    ctx.fillText(lines[1], boxX + 10, boxY + 32);
    ctx.fillStyle = isDark() ? '#10b981' : '#059669';
    ctx.fillText(lines[2], boxX + 10, boxY + 48);
    ctx.restore();
  }

  _onMove(e) {
    if (!this.data || !this.data.buckets.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const { width } = this._dimensions();
    const pad = 44;
    const graphW = width - pad * 2;
    const denom = Math.max(1, this.data.buckets.length - 1);
    const idx = Math.round(((x - pad) / graphW) * denom);
    this.hoverIndex = Math.max(0, Math.min(this.data.buckets.length - 1, idx));
    this._draw();
  }
}

function compactNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  if (n % 1 === 0) return String(Math.round(n));
  return n.toFixed(1);
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function isDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

/* ==========================================================================
   CATEGORY ALLOCATION DONUT CHART
   ========================================================================== */

const DONUT_CATEGORY_COLORS = {
  Electronics: '#2563eb',
  Travel: '#14b8a6',
  Gaming: '#8b5cf6',
  Safety: '#f59e0b',
  Shopping: '#ec4899',
  General: '#64748b'
};

const DONUT_FALLBACK_COLORS = ['#38bdf8', '#34d399', '#818cf8', '#fbbf24', '#fb7185', '#2dd4bf', '#a78bfa', '#94a3b8'];

class CategoryDonutChart {
  static _instances = {};

  static renderChart(canvasId, goals, legendContainerId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const inst = new CategoryDonutChartInstance(canvas, goals, legendContainerId);
    CategoryDonutChart._instances[canvasId] = inst;
    return inst;
  }
}

class CategoryDonutChartInstance {
  constructor(canvas, goals, legendContainerId) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.legendContainer = legendContainerId ? document.getElementById(legendContainerId) : null;
    this.goals = goals || [];
    const currency = typeof SavingsCalculator !== 'undefined' ? SavingsCalculator : (window.SavingsCalculator || {});
    this.fmt = currency.formatCurrency ? (value) => currency.formatCurrency(value) : (value) => `$${Number(value || 0).toFixed(2)}`;
    this.hoverIndex = -1;
    this.drawProgress = 0;
    this.animationId = null;
    this._destroyed = false;

    this._buildData();
    this._renderLegend();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.rerender());
      this._ro.observe(canvas);
    }
    this.canvas.addEventListener('mousemove', (e) => this._onMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverIndex = -1;
      this._drawStatic();
    });
    this._startAnimation();
  }

  _buildData() {
    const active = this.goals.filter((g) => (g.savedAmount || 0) > 0);
    const totals = {};
    active.forEach((g) => {
      const key = g.category || 'General';
      totals[key] = (totals[key] || 0) + (parseFloat(g.savedAmount) || 0);
    });
    const entries = Object.keys(totals)
      .map((name) => ({ name, value: totals[name] }))
      .sort((a, b) => b.value - a.value);
    const sum = entries.reduce((s, e) => s + e.value, 0);
    this.data = { entries, sum };
  }

  _renderLegend() {
    if (!this.legendContainer) return;
    const { entries, sum } = this.data;
    this.legendContainer.innerHTML = entries.length
      ? entries.map((e, i) => `
          <div class="donut-legend-item" data-idx="${i}">
            <span class="donut-legend-dot" style="background: ${this._color(i)};"></span>
            <span class="donut-legend-name">${e.name}</span>
            <span class="donut-legend-val">${sum > 0 ? ((e.value / sum) * 100).toFixed(1) : 0}%</span>
          </div>
        `).join('')
      : `<div class="donut-legend-empty">Deposit into any vault to see category allocation.</div>`;
    this.legendContainer.querySelectorAll('.donut-legend-item').forEach((el) => {
      el.addEventListener('mouseenter', () => {
        this.hoverIndex = parseInt(el.getAttribute('data-idx'), 10);
        this._drawStatic();
      });
      el.addEventListener('mouseleave', () => {
        this.hoverIndex = -1;
        this._drawStatic();
      });
    });
  }

  _color(i) {
    const e = this.data.entries[i];
    if (e && DONUT_CATEGORY_COLORS[e.name]) return DONUT_CATEGORY_COLORS[e.name];
    return DONUT_FALLBACK_COLORS[i % DONUT_FALLBACK_COLORS.length];
  }

  rerender() {
    if (this._destroyed) return;
    this._buildData();
    this._renderLegend();
    this._startAnimation();
  }

  destroy() {
    this._destroyed = true;
    if (this._ro) this._ro.disconnect();
    if (this.animationId) cancelAnimationFrame(this.animationId);
  }

  _startAnimation() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.drawProgress = 0;
    const start = performance.now();
    const duration = 900;
    const step = (t) => {
      if (this._destroyed) return;
      this.drawProgress = Math.min(1, (t - start) / duration);
      this._draw();
      if (this.drawProgress < 1) this.animationId = requestAnimationFrame(step);
      else this.animationId = null;
    };
    this.animationId = requestAnimationFrame(step);
  }

  _drawStatic() {
    this.drawProgress = 1;
    this._draw();
  }

  _draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 10 ? rect.width : (canvas.clientWidth || 280);
    const height = rect.height > 10 ? rect.height : (canvas.clientHeight || 240);
    const dpr = window.devicePixelRatio || 1;
    if (width <= 40 || height <= 40) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const { entries, sum } = this.data;
    const cx = width / 2;
    const cy = height / 2;
    const outerR = Math.min(width, height) / 2 - 18;
    const innerR = outerR * 0.58;

    if (!entries.length) {
      ctx.fillStyle = isDark() ? '#64748b' : '#94a3b8';
      ctx.font = '12px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No category allocation yet', cx, cy);
      return;
    }

    const startAngle = -Math.PI / 2;
    const fullSweep = Math.PI * 2;
    const sweep = fullSweep * this.drawProgress;
    let angleAcc = 0;

    const isDarkTheme = isDark();
    const stroke = isDarkTheme ? '#101a2e' : '#ffffff';

    entries.forEach((e, i) => {
      const frac = sum > 0 ? e.value / sum : 0;
      const segSweep = frac * fullSweep;
      const segStart = startAngle + angleAcc;
      const segEnd = segStart + segSweep;

      let visibleStart = segStart;
      let visibleEnd = Math.min(segEnd, startAngle + sweep);
      if (visibleEnd <= visibleStart) {
        angleAcc += segSweep;
        return;
      }

      ctx.beginPath();
      ctx.arc(cx, cy, outerR, visibleStart, visibleEnd);
      ctx.arc(cx, cy, innerR, visibleEnd, visibleStart, true);
      ctx.closePath();
      ctx.fillStyle = this._color(i);
      ctx.globalAlpha = this.hoverIndex === i || this.hoverIndex === -1 ? 1 : 0.45;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();

      angleAcc += segSweep;
    });

    // Hole label
    ctx.textAlign = 'center';
    ctx.fillStyle = isDark() ? '#e2e8f0' : '#0f172a';
    ctx.font = '700 15px Plus Jakarta Sans, sans-serif';
    ctx.fillText('Allocated', cx, cy - 4);
    ctx.fillStyle = isDark() ? '#10b981' : '#059669';
    ctx.font = '700 17px Plus Jakarta Sans, sans-serif';
    ctx.fillText(this.fmt ? this.fmt(sum) : ('$' + sum.toFixed(2)), cx, cy + 18);

    // Tooltip on hovered segment
    if (this.hoverIndex >= 0 && this.hoverIndex < entries.length) {
      const e = entries[this.hoverIndex];
      const pct = sum > 0 ? (e.value / sum) * 100 : 0;
      const label = `${e.name}: ${this.fmt ? this.fmt(e.value) : ('$' + e.value.toFixed(2))} (${pct.toFixed(1)}%)`;
      ctx.font = '11px Plus Jakarta Sans, sans-serif';
      const tw = ctx.measureText(label).width;
      const bx = Math.min(cx - tw / 2 - 10, width - tw - 16);
      const by = cy - outerR - 30;
      ctx.save();
      ctx.fillStyle = isDark() ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = isDark() ? '#334155' : '#e2e8f0';
      drawRoundedRect(ctx, bx, by, tw + 20, 24, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isDark() ? '#e2e8f0' : '#0f172a';
      ctx.textAlign = 'left';
      ctx.fillText(label, bx + 10, by + 16);
      ctx.restore();
    }
  }

  _onMove(e) {
    if (!this.data.entries.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const outerR = Math.min(rect.width, rect.height) / 2 - 18;
    const innerR = outerR * 0.58;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < innerR || dist > outerR) {
      this.hoverIndex = -1;
      this._drawStatic();
      return;
    }
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += Math.PI * 2;
    let acc = 0;
    const sum = this.data.sum;
    this.hoverIndex = -1;
    this.data.entries.forEach((en, i) => {
      const frac = sum > 0 ? en.value / sum : 0;
      if (angle >= acc && angle < acc + frac * Math.PI * 2) this.hoverIndex = i;
      acc += frac * Math.PI * 2;
    });
    this._drawStatic();
  }
}

/* ==========================================================================
   MONTHLY VELOCITY BAR CHART  (scheduled vs actual, last 6 months)
   ========================================================================== */

const VELOCITY_MONTH_MULTIPLIER = { daily: 30, weekly: 4.33, biweekly: 2.17, monthly: 1 };

class MonthlyVelocityBarChart {
  static _instances = {};

  static renderChart(canvasId, goals) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const inst = new MonthlyVelocityBarChartInstance(canvas, goals);
    MonthlyVelocityBarChart._instances[canvasId] = inst;
    return inst;
  }
}

class MonthlyVelocityBarChartInstance {
  constructor(canvas, goals) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.goals = goals || [];
    this.drawProgress = 0;
    this.animationId = null;
    this.hoverIndex = -1;
    this._destroyed = false;

    this._buildData();

    const sCalc = (typeof SavingsCalculator !== 'undefined' ? SavingsCalculator : window.SavingsCalculator) || {};
    this.fmt = sCalc.formatCurrency ? (v) => sCalc.formatCurrency(v) : (v) => `$${v.toFixed(2)}`;

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.rerender());
      this._ro.observe(canvas);
    }
    this.canvas.addEventListener('mousemove', (e) => this._onMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverIndex = -1;
      this._drawStatic();
    });
    this._startAnimation();
  }

  _buildData() {
    const now = new Date();
    const labels = [];
    const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

    for (let i = 5; i >= 0; i--) {
      const d = monthStart(new Date(now.getFullYear(), now.getMonth() - i, 1));
      labels.push({
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        cell: d.getTime()
      });
    }

    const scheduled = labels.map(() => 0);
    const actual = labels.map(() => 0);

    const activeGoals = this.goals.filter((g) => g.status === 'active' || g.status === 'completed');
    activeGoals.forEach((g) => {
      let ppi = 0;
      try {
        const sCalc = (typeof SavingsCalculator !== 'undefined' ? SavingsCalculator : window.SavingsCalculator) || {};
        if (sCalc.calculateSchedule) {
          const s = sCalc.calculateSchedule(g.targetAmount, g.savedAmount, g.startDate, g.targetDate, g.frequency);
          ppi = s.paymentPerInterval || 0;
        }
      } catch (e) {}
      const monthly = ppi * (VELOCITY_MONTH_MULTIPLIER[g.frequency] || 1);
      scheduled.forEach((v, i) => { scheduled[i] = v + monthly; });
    });

    let txs = [];
    try {
      const storage = (typeof StorageService !== 'undefined' ? StorageService : window.StorageService) || {};
      if (storage.getTransactions) txs = storage.getTransactions();
    } catch (e) {}
    txs
      .filter((tx) => tx && tx.type === 'deposit' && tx.timestamp)
      .forEach((tx) => {
        const cell = monthStart(new Date(tx.timestamp)).getTime();
        const idx = labels.findIndex((l) => l.cell === cell);
        if (idx >= 0) actual[idx] += parseFloat(tx.amount) || 0;
      });

    const maxVal = scheduled.reduce((m, v) => Math.max(m, v), 0);
    const maxActual = actual.reduce((m, v) => Math.max(m, v), 0);
    this.data = { labels, scheduled, actual, maxVal: Math.max(100, maxVal, maxActual) * 1.12 };
  }

  rerender() {
    if (this._destroyed) return;
    this._buildData();
    this._startAnimation();
  }

  destroy() {
    this._destroyed = true;
    if (this._ro) this._ro.disconnect();
    if (this.animationId) cancelAnimationFrame(this.animationId);
  }

  _startAnimation() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.drawProgress = 0;
    const start = performance.now();
    const duration = 850;
    const step = (t) => {
      if (this._destroyed) return;
      this.drawProgress = Math.min(1, (t - start) / duration);
      this._draw();
      if (this.drawProgress < 1) this.animationId = requestAnimationFrame(step);
      else this.animationId = null;
    };
    this.animationId = requestAnimationFrame(step);
  }

  _drawStatic() {
    this.drawProgress = 1;
    this._draw();
  }

  _draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 10 ? rect.width : (canvas.clientWidth || 380);
    const height = rect.height > 10 ? rect.height : (canvas.clientHeight || 240);
    const dpr = window.devicePixelRatio || 1;
    if (width <= 40 || height <= 40) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isDarkTheme = isDark();
    const gridColor = isDarkTheme ? '#27354f' : '#eef2f7';
    const textColor = isDarkTheme ? '#94a3b8' : '#64748b';

    const topPad = 34;
    const bottomPad = 26;
    const pad = 34;
    const graphW = width - pad * 2;
    const graphH = height - topPad - bottomPad;
    const { labels, scheduled, actual, maxVal } = this.data;

    const n = labels.length;
    const slot = graphW / n;
    const barW = Math.min(26, slot * 0.28);
    const gap = barW * 0.55 + 4;

    const py = (v) => topPad + graphH - (v / maxVal) * graphH;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = topPad + (graphH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.font = '10px Plus Jakarta Sans, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(compactNumber(maxVal - (maxVal / 3) * i), pad - 6, y + 4);
    }

    ctx.textAlign = 'center';
    ctx.font = '10px Plus Jakarta Sans, sans-serif';
    ctx.fillStyle = textColor;

    const shown = Math.max(1, Math.ceil(n * this.drawProgress));

    labels.forEach((l, i) => {
      if (i >= shown) return;
      const cx = pad + slot * i + slot / 2;

      const aH = (actual[i] / maxVal) * graphH;
      const sH = (scheduled[i] / maxVal) * graphH;

      ctx.fillStyle = '#059669';
      if (this.hoverIndex === i) ctx.globalAlpha = 1; else ctx.globalAlpha = 0.92;
      ctx.fillRect(cx - barW - gap / 2, topPad + graphH - aH, barW, aH);
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#2563eb';
      if (this.hoverIndex === i) ctx.globalAlpha = 1; else ctx.globalAlpha = 0.8;
      ctx.fillRect(cx + gap / 2, topPad + graphH - sH, barW, sH);
      ctx.globalAlpha = 1;

      ctx.fillText(l.label, cx, height - 8);
    });

    // Legend
    ctx.font = '10px Plus Jakarta Sans, sans-serif';
    ctx.textAlign = 'left';
    const ly = 14;
    ctx.fillStyle = '#059669';
    ctx.fillRect(pad, ly - 7, 10, 10);
    ctx.fillStyle = textColor;
    ctx.fillText('Actual', pad + 15, ly);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(pad + 70, ly - 7, 10, 10);
    ctx.fillStyle = textColor;
    ctx.fillText('Scheduled', pad + 85, ly);

    // Hover tooltip
    if (this.hoverIndex >= 0 && this.hoverIndex < labels.length) {
      const i = this.hoverIndex;
      const cx = pad + slot * i + slot / 2;
      const lines = [
        labels[i].label,
        'Actual: ' + this.fmt(actual[i]),
        'Scheduled: ' + this.fmt(scheduled[i])
      ];
      ctx.font = '11px Plus Jakarta Sans, sans-serif';
      let boxW = 0;
      lines.forEach((l) => (boxW = Math.max(boxW, ctx.measureText(l).width)));
      boxW += 20;
      const boxH = lines.length * 16 + 14;
      let boxX = cx + 10;
      if (boxX + boxW > width - 4) boxX = cx - boxW - 10;
      const boxY = topPad - 4;
      ctx.save();
      ctx.fillStyle = isDarkTheme ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255,255,255,0.95)';
      ctx.strokeStyle = isDarkTheme ? '#334155' : '#e2e8f0';
      drawRoundedRect(ctx, boxX, boxY, boxW, boxH, 8);
      ctx.fill();
      ctx.stroke();
      ctx.textAlign = 'left';
      ctx.fillStyle = isDarkTheme ? '#38bdf8' : '#2563eb';
      ctx.fillText(lines[0], boxX + 10, boxY + 16);
      ctx.fillStyle = isDarkTheme ? '#10b981' : '#059669';
      ctx.fillText(lines[1], boxX + 10, boxY + 32);
      ctx.fillStyle = textColor;
      ctx.fillText(lines[2], boxX + 10, boxY + 48);
      ctx.restore();
    }
  }

  _onMove(e) {
    if (!this.data.labels.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pad = 34;
    const graphW = rect.width - pad * 2;
    const slot = graphW / this.data.labels.length;
    const idx = Math.floor((x - pad) / slot);
    this.hoverIndex = Math.max(0, Math.min(this.data.labels.length - 1, idx));
    if (x < pad || x > rect.width - pad) this.hoverIndex = -1;
    this._drawStatic();
  }
}

/* ==========================================================================
   FINANCIAL HEALTH SCORE GAUGE
   ========================================================================== */

class HealthScoreGauge {
  static _instances = {};

  static renderChart(canvasId, goals, detailContainerId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return null;
    const inst = new HealthScoreGaugeInstance(canvas, goals, detailContainerId);
    HealthScoreGauge._instances[canvasId] = inst;
    return inst;
  }
}

class HealthScoreGaugeInstance {
  constructor(canvas, goals, detailContainerId) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.detailContainer = detailContainerId ? document.getElementById(detailContainerId) : null;
    this.goals = goals || [];
    this.drawProgress = 0;
    this.animationId = null;
    this._destroyed = false;

    this._buildData();
    this._renderDetail();

    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.rerender());
      this._ro.observe(canvas);
    }
    this._startAnimation();
  }

  _buildData() {
    const goals = this.goals || [];
    const active = goals.filter((g) => g.status === 'active');
    const sCalc = (typeof SavingsCalculator !== 'undefined' ? SavingsCalculator : window.SavingsCalculator) || {};
    const storage = (typeof StorageService !== 'undefined' ? StorageService : window.StorageService) || {};

    // 1) Completion pace vs deadline (0-40)
    let paceScore = 0;
    const paceNotes = [];
    if (active.length) {
      const now = Date.now();
      let total = 0;
      active.forEach((g) => {
        const startT = new Date(g.startDate || now).getTime();
        const targetT = new Date(g.targetDate).getTime();
        if (isNaN(targetT)) return;
        const elapsedFrac = targetT > startT ? Math.max(0, Math.min(1, (now - startT) / (targetT - startT))) : 1;
        const savedFrac = g.targetAmount > 0 ? Math.min(1, (g.savedAmount || 0) / g.targetAmount) : 0;
        const onTrack = savedFrac >= elapsedFrac * 0.92;
        total += onTrack ? 1 : savedFrac >= elapsedFrac * 0.6 ? 0.4 : 0;
      });
      paceScore = active.length ? (total / active.length) * 40 : 0;
      paceNotes.push(active.length ? 'completion pace' : '—');
    }

    // 2) Deposit cadence vs missed (0-35)
    let cadenceScore = 0;
    const cadenceNotes = [];
    if (active.length) {
      let ratioSum = 0;
      let count = 0;
      const intervalDaysMap = { daily: 1, weekly: 7, biweekly: 14, monthly: 30.44 };
      active.forEach((g) => {
        const intervalDays = intervalDaysMap[g.frequency] || 7;
        const startT = g.startDate ? new Date(g.startDate).getTime() : Date.now();
        const elapsedDays = Math.max(0, (Date.now() - startT) / 86400000);
        const expected = Math.max(1, Math.floor(elapsedDays / intervalDays) + 1);
        let actual = 0;
        try {
          if (storage.getTransactions) {
            actual = storage.getTransactions().filter((tx) => tx.goalId === g.id && tx.type === 'deposit').length;
          }
        } catch (e) {}
        ratioSum += Math.min(1, actual / expected);
        count++;
      });
      cadenceScore = count ? (ratioSum / count) * 35 : 0;
      cadenceNotes.push(count ? 'deposit cadence' : '—');
    }

    // 3) Emergency reserve coverage (0-25)
    let reserveScore = 0;
    const reserveNotes = [];
    const safetyGoals = goals.filter((g) => {
      const cat = String(g.category || '').toLowerCase();
      return cat === 'safety' || cat.indexOf('reserve') !== -1 || cat.indexOf('emergency') !== -1;
    });
    if (safetyGoals.length) {
      const funded = safetyGoals.reduce((s, g) => s + Math.min(1, (g.savedAmount || 0) / g.targetAmount), 0);
      reserveScore = (funded / safetyGoals.length) * 25;
      reserveNotes.push('emergency reserve');
    } else {
      reserveNotes.push('no emergency reserve vault');
    }

    const score = Math.round(Math.min(100, Math.max(0, paceScore + cadenceScore + reserveScore)));
    const label =
      score >= 90 ? 'Excellent' :
      score >= 75 ? 'Great Momentum' :
      score >= 60 ? 'On Track' :
      score >= 40 ? 'Needs Focus' :
      'At Risk';

    this.data = {
      score,
      label,
      breakdown: [
        { name: paceNotes[0] || 'completion pace', value: Math.round(paceScore), max: 40 },
        { name: cadenceNotes[0] || 'deposit cadence', value: Math.round(cadenceScore), max: 35 },
        { name: reserveNotes[0] || 'emergency reserve', value: Math.round(reserveScore), max: 25 }
      ]
    };
  }

  _renderDetail() {
    if (!this.detailContainer) return;
    const { breakdown } = this.data;
    this.detailContainer.innerHTML = breakdown.map((b) => `
      <div class="health-breakdown-row">
        <span class="health-breakdown-name">${b.name}</span>
        <div class="health-breakdown-track"><div class="health-breakdown-fill" style="width: ${(b.value / b.max) * 100}%;"></div></div>
        <span class="health-breakdown-val">${b.value}/${b.max}</span>
      </div>
    `).join('');
  }

  rerender() {
    if (this._destroyed) return;
    this._buildData();
    this._renderDetail();
    this._startAnimation();
  }

  destroy() {
    this._destroyed = true;
    if (this._ro) this._ro.disconnect();
    if (this.animationId) cancelAnimationFrame(this.animationId);
  }

  _startAnimation() {
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this.drawProgress = 0;
    const start = performance.now();
    const duration = 1100;
    const step = (t) => {
      if (this._destroyed) return;
      this.drawProgress = Math.min(1, (t - start) / duration);
      this._draw();
      if (this.drawProgress < 1) this.animationId = requestAnimationFrame(step);
      else this.animationId = null;
    };
    this.animationId = requestAnimationFrame(step);
  }

  _draw() {
    const canvas = this.canvas;
    const ctx = this.ctx;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 10 ? rect.width : (canvas.clientWidth || 260);
    const height = rect.height > 10 ? rect.height : (canvas.clientHeight || 240);
    const dpr = window.devicePixelRatio || 1;
    if (width <= 40 || height <= 40) return;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const isDarkTheme = isDark();
    const cx = width / 2;
    const cy = height / 2 + 4;
    const radius = Math.min(width, height) / 2 - 22;
    const startAngle = Math.PI * 0.75;
    const sweep = Math.PI * 1.5;

    // Track arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sweep);
    ctx.strokeStyle = isDarkTheme ? '#1e2f4a' : '#e8edf5';
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Progress arc
    const { score } = this.data;
    const eased = 1 - Math.pow(1 - this.drawProgress, 3);
    const color = score >= 75 ? '#10b981' : score >= 60 ? '#38bdf8' : score >= 40 ? '#f59e0b' : '#f43f5e';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sweep * eased);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.18 + eased * 0.82;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Center
    ctx.textAlign = 'center';
    ctx.fillStyle = isDarkTheme ? '#f8fafc' : '#0f172a';
    ctx.font = '800 44px Plus Jakarta Sans, sans-serif';
    ctx.fillText(String(Math.round(score * eased)), cx, cy + 8);
    ctx.fillStyle = color;
    ctx.font = '700 12px Plus Jakarta Sans, sans-serif';
    ctx.fillText(this.data.label.toUpperCase(), cx, cy + 30);
  }
}

if (typeof window !== 'undefined') {
  window.TrajectoryChart = TrajectoryChart;
  window.CategoryDonutChart = CategoryDonutChart;
  window.MonthlyVelocityBarChart = MonthlyVelocityBarChart;
  window.HealthScoreGauge = HealthScoreGauge;
}