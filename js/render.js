'use strict';

/* ============================================================
   渲染：场地、塔、单位、特效
   输入是一个「视图对象」：可以直接是 Sim.Game，也可以是客机由快照重建的
   ============================================================ */

var Render = (function () {
  const T = CR.TILE;
  const W = CR.COLS * T;
  const H = CR.ROWS * T;

  function px(v) { return v * T; }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawArena(ctx, t, placing) {
    // 草地
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1d3b2a');
    g.addColorStop(0.5, '#22492f');
    g.addColorStop(1, '#1d3b2a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // 棋盘格
    for (let y = 0; y < CR.ROWS; y++) {
      for (let x = 0; x < CR.COLS; x++) {
        if ((x + y) % 2 === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.022)';
          ctx.fillRect(x * T, y * T, T, T);
        }
      }
    }

    // 敌方半场略暗
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 0, W, CR.RIVER.y0 * T);

    // 河
    const ry = CR.RIVER.y0 * T;
    const rh = (CR.RIVER.y1 - CR.RIVER.y0) * T;
    const rg = ctx.createLinearGradient(0, ry, 0, ry + rh);
    rg.addColorStop(0, '#1a4a6b');
    rg.addColorStop(0.5, '#236a94');
    rg.addColorStop(1, '#1a4a6b');
    ctx.fillStyle = rg;
    ctx.fillRect(0, ry, W, rh);
    ctx.strokeStyle = 'rgba(160,220,255,0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const yy = ry + rh * (0.25 + i * 0.24) + Math.sin(t * 1.6 + i) * 2;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      for (let x = 0; x <= W; x += 24) {
        ctx.lineTo(x, yy + Math.sin((x / 40) + t * 2 + i) * 2.5);
      }
      ctx.stroke();
    }

    // 桥
    CR.BRIDGES.forEach((b) => {
      const bx = b.x0 * T;
      const bw = (b.x1 - b.x0) * T;
      ctx.fillStyle = '#6b4b2e';
      ctx.fillRect(bx, ry - 2, bw, rh + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      for (let i = 0; i < rh; i += 7) ctx.fillRect(bx, ry + i, bw, 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx + 1, ry - 2, bw - 2, rh + 4);
    });

    // 下牌区域高亮
    if (placing) {
      ctx.save();
      ctx.fillStyle = 'rgba(110,200,255,0.14)';
      const y0 = placing.team === 0 ? CR.RIVER.y1 * T : 0;
      const y1 = placing.team === 0 ? H : CR.RIVER.y0 * T;
      ctx.fillRect(0, y0, W, y1 - y0);
      ctx.strokeStyle = 'rgba(140,220,255,0.55)';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(2, y0 + 2, W - 4, y1 - y0 - 4);
      ctx.restore();
    }

    // 边框
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, W - 3, H - 3);
  }

  function hpBar(ctx, x, y, w, ratio, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, x - w / 2, y, w, 5, 2.5);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, x - w / 2, y, Math.max(1, w * ratio), 5, 2.5);
    ctx.fill();
  }

  function drawTower(ctx, tw) {
    const x = px(tw.x);
    const y = px(tw.y);
    const r = tw.kind === 'king' ? 26 : 22;
    ctx.save();
    if (!tw.alive) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#3a3f4d';
      roundRect(ctx, x - r, y - r, r * 2, r * 2, 8);
      ctx.fill();
      ctx.restore();
      return;
    }
    const base = tw.team === 0 ? '#2d6cc0' : '#b8384a';
    const light = tw.team === 0 ? '#5fa8f5' : '#f0707f';
    ctx.fillStyle = tw.flash > 0 ? '#ffffff' : base;
    roundRect(ctx, x - r, y - r, r * 2, r * 2, 8);
    ctx.fill();
    ctx.strokeStyle = light;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = (r * 1.15) + 'px system-ui, "Segoe UI Emoji"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tw.kind === 'king' ? '👑' : '🏹', x, y + 1);

    const ratio = Math.max(0, tw.hp / tw.maxHp);
    hpBar(ctx, x, y - r - 10, r * 2, ratio, tw.team === 0 ? '#57b6ff' : '#ff6b7f');
    ctx.restore();
  }

  function drawUnit(ctx, u) {
    const x = px(u.x);
    const y = px(u.y);
    const card = CR.CARD_BY_ID[u.card];
    const r = Math.max(11, (u.radius || 0.4) * T * 1.35);
    const team = u.team === 0 ? '#2d6cc0' : '#b8384a';
    const ring = u.team === 0 ? '#7cc4ff' : '#ff9aa6';

    ctx.save();
    if (u.ghost) ctx.globalAlpha = 0.6;
    // 落地阴影
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.75, r * 0.85, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (u.ghost) {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.25, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.fillStyle = u.flash > 0 ? '#ffffff' : team;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ring;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 内圈提亮，让 emoji 在深色圆上用白底更能看清
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.beginPath();
    ctx.arc(x, y, r * 0.74, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = Math.round(r * 1.35) + 'px system-ui, "Segoe UI Emoji"';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(card ? card.emoji : '❔', x, y + 1);

    if (u.hp < u.maxHp) {
      hpBar(ctx, x, y - r - 9, r * 2.1, Math.max(0, u.hp / u.maxHp), u.team === 0 ? '#57b6ff' : '#ff6b7f');
    }
    ctx.restore();
  }

  function drawBolts(ctx, bolts) {
    bolts.forEach((b) => {
      const k = b.t / b.dur;
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = b.team === 0 ? '#9fd8ff' : '#ffb3bd';
      ctx.lineWidth = b.tower ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(px(b.x0), px(b.y0));
      ctx.lineTo(px(b.x1), px(b.y1));
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawBlasts(ctx, blasts) {
    blasts.forEach((b) => {
      const k = b.t / b.dur;
      ctx.save();
      ctx.globalAlpha = (1 - k) * 0.75;
      ctx.fillStyle = b.color;
      ctx.beginPath();
      ctx.arc(px(b.x), px(b.y), px(b.r) * (0.6 + k * 0.7), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawCursor(ctx, cursor) {
    if (!cursor) return;
    const x = px(cursor.x);
    const y = px(cursor.y);
    ctx.save();
    ctx.strokeStyle = cursor.ok ? 'rgba(140,235,180,0.95)' : 'rgba(255,120,120,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 26, y); ctx.lineTo(x - 8, y);
    ctx.moveTo(x + 8, y); ctx.lineTo(x + 26, y);
    ctx.moveTo(x, y - 26); ctx.lineTo(x, y - 8);
    ctx.moveTo(x, y + 8); ctx.lineTo(x, y + 26);
    ctx.stroke();
    ctx.restore();
  }

  function draw(canvas, view, opts) {
    const ctx = canvas.getContext('2d');
    const t = opts && opts.time ? opts.time : 0;
    ctx.clearRect(0, 0, W, H);
    drawArena(ctx, t, opts && opts.placing);
    drawBlasts(ctx, view.blasts || []);
    (view.towers || []).forEach((tw) => drawTower(ctx, tw));
    (view.units || []).forEach((u) => drawUnit(ctx, u));
    drawBolts(ctx, view.bolts || []);
    drawCursor(ctx, opts && opts.cursor);
  }

  return { draw: draw, W: W, H: H, T: T };
})();
