'use strict';

/* ============================================================
   对局模拟：圣水、手牌轮转、下牌、寻路、战斗、塔、胜负
   房主权威：整局只在这里跑，客机只负责渲染快照
   ============================================================ */

var Sim = (function () {
  let nextUnitId = 1;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function makeTower(def) {
    const st = CR.TOWER_STATS[def.kind];
    return {
      id: def.id, team: def.team, kind: def.kind,
      x: def.x, y: def.y,
      hp: st.hp, maxHp: st.hp,
      dmg: st.dmg, hitSpeed: st.hitSpeed, range: st.range, radius: st.radius,
      cd: 0, alive: true, active: def.kind === 'princess',
      flash: 0
    };
  }

  class Game {
    constructor(decks) {
      this.decks = decks;
      this.players = [0, 1].map((team) => ({
        team: team,
        deck: decks[team].slice(),
        queue: [],
        hand: [],
        next: null,
        elixir: 5,
        crowns: 0,
        pending: 0
      }));
      this.players.forEach((p) => this.resetCycle(p));
      this.towers = CR.TOWERS.map(makeTower);
      this.units = [];
      this.bolts = [];
      this.blasts = [];
      this.phase = 'playing';
      this.timeLeft = CR.REGULAR;
      this.overtimeLeft = 0;
      this.result = null;
      this.clock = 0;
      this.events = [];
      this.retarget = 0;
    }

    resetCycle(p) {
      p.queue = shuffle(p.deck);
      p.hand = p.queue.splice(0, 4);
      p.next = p.queue[0];
    }

    /* ---------------- 下牌 ---------------- */

    play(team, handIndex, x, y) {
      if (this.phase === 'over') return { ok: false, reason: '对局已结束' };
      const p = this.players[team];
      const cardId = p.hand[handIndex];
      if (!cardId) return { ok: false, reason: '没有这张牌' };
      const card = CR.CARD_BY_ID[cardId];
      if (p.elixir < card.cost) return { ok: false, reason: '圣水不足' };
      if (card.kind !== 'spell' && !CR.canDeployAt(team, x, y)) return { ok: false, reason: '只能下在自己半场' };
      if (card.kind === 'spell' && (x < 0.4 || x > CR.COLS - 0.4 || y < 0.4 || y > CR.ROWS - 0.4)) {
        return { ok: false, reason: '超出场地' };
      }

      p.elixir -= card.cost;
      // 手牌轮转：打出的牌回到牌堆末尾，下一张补进手里
      p.hand.splice(handIndex, 1);
      p.queue.push(cardId);
      p.hand.push(p.queue.shift());
      p.next = p.queue[0];

      if (card.kind === 'spell') {
        this.castSpell(team, card, x, y);
      } else {
        this.spawnUnits(team, card, x, y);
      }
      this.events.push({ t: 'play', team: team, card: cardId, x: x, y: y });
      return { ok: true, card: cardId };
    }

    spawnUnits(team, card, x, y) {
      const n = card.count || 1;
      for (let i = 0; i < n; i++) {
        const ang = (Math.PI * 2 * i) / n + Math.PI / 2;
        const off = n === 1 ? 0 : 0.42;
        const ux = CR.clamp(x + Math.cos(ang) * off, 0.5, CR.COLS - 0.5);
        const uy = CR.clamp(y + Math.sin(ang) * off, 0.5, CR.ROWS - 0.5);
        this.units.push({
          id: nextUnitId++,
          team: team,
          card: card.id,
          kind: card.kind,
          x: ux, y: uy,
          hp: card.hp, maxHp: card.hp,
          dmg: card.dmg,
          hitSpeed: card.hitSpeed,
          range: card.range,
          speed: card.speed || 0,
          targets: card.targets,
          radius: card.radius,
          splash: card.splash || 0,
          ranged: !!card.ranged,
          life: card.life || 0,
          cd: 0.35,
          retarget: Math.random() * 0.2,
          target: null,
          flash: 0,
          spawn: 0.5
        });
      }
    }

    castSpell(team, card, x, y) {
      this.blasts.push({ x: x, y: y, r: card.spellRadius, t: 0, dur: 0.45, color: card.color });
      this.units.forEach((u) => {
        if (u.team === team) return;
        if (CR.dist(u.x, u.y, x, y) <= card.spellRadius + u.radius * 0.5) {
          this.damageUnit(u, card.spellDmg * 0.85);
        }
      });
      this.towers.forEach((t) => {
        if (t.team === team || !t.alive) return;
        if (CR.dist(t.x, t.y, x, y) <= card.spellRadius + t.radius) {
          this.hitTower(t, card.spellDmg * 0.5);
        }
      });
    }

    /* ---------------- 目标与移动 ---------------- */

    enemiesOf(team) { return this.units.filter((u) => u.team !== team); }

    towerById(id) {
      for (let i = 0; i < this.towers.length; i++) if (this.towers[i].id === id) return this.towers[i];
      return null;
    }

    aliveTowers(team) { return this.towers.filter((t) => t.team === team && t.alive); }

    // 优先打：射程内最近的敌方兵；没有则打最近的建筑/塔
    pickTarget(u) {
      const foe = 1 - u.team;
      let best = null;
      let bestD = Infinity;
      if (u.targets !== 'buildings') {
        for (let i = 0; i < this.units.length; i++) {
          const o = this.units[i];
          if (o.team !== u.team) {
            const d = CR.dist(u.x, u.y, o.x, o.y);
            if (d < bestD && d <= 6.2) { bestD = d; best = o; }
          }
        }
      }
      if (!best) {
        // 建筑类（含加农炮）与塔
        for (let i = 0; i < this.units.length; i++) {
          const o = this.units[i];
          if (o.team !== u.team && o.kind === 'building') {
            const d = CR.dist(u.x, u.y, o.x, o.y);
            if (d < bestD) { bestD = d; best = o; }
          }
        }
        const towers = this.aliveTowers(foe);
        // 同一条路上的公主塔优先；没塔了才去打国王塔
        let princesses = towers.filter((t) => t.kind === 'princess');
        const pool = princesses.length ? princesses : towers;
        for (let i = 0; i < pool.length; i++) {
          const t = pool[i];
          const d = CR.dist(u.x, u.y, t.x, t.y);
          if (d < bestD) { bestD = d; best = t; }
        }
      }
      return best;
    }

    // 需要过河时先走到桥头，再过桥，最后直取目标
    stepToward(u, tx, ty, dt) {
      let gx = tx;
      let gy = ty;
      const crossing = (u.y - CR.MID_Y) * (ty - CR.MID_Y) < 0;
      if (crossing) {
        const b = CR.laneBridge(u.x);
        const ownBottom = u.y > CR.MID_Y;
        const ownEdge = ownBottom ? CR.RIVER.y1 + 0.7 : CR.RIVER.y0 - 0.7;
        const farEdge = ownBottom ? CR.RIVER.y0 - 0.7 : CR.RIVER.y1 + 0.7;
        const atHead = Math.abs(u.x - b.cx) < 0.55;
        if (!atHead && (ownBottom ? u.y > ownEdge - 0.15 : u.y < ownEdge + 0.15)) {
          gx = b.cx;
          gy = ownEdge;
        } else {
          gx = b.cx;
          gy = farEdge;
        }
      }
      const dx = gx - u.x;
      const dy = gy - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001) return 0;
      const step = Math.min(u.speed * dt, d);
      u.x += (dx / d) * step;
      u.y += (dy / d) * step;
      return d - step;
    }

    /* ---------------- 伤害 ---------------- */

    damageUnit(u, amount) {
      u.hp -= amount;
      u.flash = 0.12;
      if (u.hp <= 0) {
        u.dead = true;
        this.blasts.push({ x: u.x, y: u.y, r: 0.7, t: 0, dur: 0.3, color: u.team === 0 ? '#6ec1ff' : '#ff7b7b' });
      }
    }

    hitTower(t, amount) {
      if (!t.alive) return;
      t.hp -= amount;
      t.flash = 0.12;
      t.active = true;
      if (t.hp <= 0) {
        t.hp = 0;
        t.alive = false;
        const foe = 1 - t.team;
        this.players[foe].crowns += t.kind === 'king' ? 3 : 1;
        this.activeKing(t.team);
        this.blasts.push({ x: t.x, y: t.y, r: 1.6, t: 0, dur: 0.6, color: '#ffd166' });
        if (t.kind === 'king') {
          this.finish(foe, '国王塔被摧毁');
        } else if (this.phase === 'overtime') {
          this.finish(foe, '加时赛先下一塔');
        }
      }
    }

    activeKing(team) {
      const king = this.towers.filter((t) => t.team === team && t.kind === 'king')[0];
      if (king) king.active = true;
    }

    /* ---------------- 主循环 ---------------- */

    update(dt) {
      if (this.phase === 'over') return;
      dt = Math.min(dt, 0.05);
      this.clock += dt;

      // 计时
      this.timeLeft -= dt;
      if (this.phase === 'overtime') {
        this.overtimeLeft -= dt;
        if (this.overtimeLeft <= 0) this.timeUp();
      } else if (this.timeLeft <= 0) {
        this.timeUp();
      }

      // 圣水
      const double = this.phase === 'overtime' || this.timeLeft <= CR.DOUBLE_ELIXIR_AT;
      const rate = double ? 2 : 1;
      this.players.forEach((p) => {
        if (p.elixir < CR.ELIXIR_MAX) {
          p.elixir = Math.min(CR.ELIXIR_MAX, p.elixir + (dt / CR.ELIXIR_PERIOD) * rate);
        }
      });

      // 单位
      this.retarget -= dt;
      const doRetarget = this.retarget <= 0;
      if (doRetarget) this.retarget = 0.22;

      for (let i = 0; i < this.units.length; i++) {
        const u = this.units[i];
        if (u.dead) continue;
        if (u.spawn > 0) { u.spawn -= dt; continue; }
        if (u.life > 0) {
          u.life -= dt;
          if (u.life <= 0) { u.dead = true; continue; }
        }
        if (u.flash > 0) u.flash -= dt;
        if (u.cd > 0) u.cd -= dt;

        if (doRetarget || !u.target || (u.target.hp !== undefined && u.target.hp <= 0) || u.target.dead) {
          u.target = this.pickTarget(u);
        }
        const target = u.target;
        if (!target) continue;

        let tx, ty, tr;
        if (target.radius === undefined) continue;
        tx = target.x; ty = target.y; tr = target.radius;
        const d = CR.dist(u.x, u.y, tx, ty);
        const reach = u.range + tr;

        if (d > reach) {
          if (u.speed > 0) this.stepToward(u, tx, ty, dt);
        } else if (u.cd <= 0) {
          u.cd = u.hitSpeed;
          if (u.splash > 0) {
            this.blasts.push({ x: tx, y: ty, r: u.splash, t: 0, dur: 0.28, color: u.team === 0 ? '#8fd0ff' : '#ffb0b0' });
            this.units.forEach((o) => {
              if (o.team !== u.team && !o.dead && CR.dist(o.x, o.y, tx, ty) <= u.splash + o.radius) {
                this.damageUnit(o, u.dmg);
              }
            });
            const tw = this.towers.filter((t) => t.team !== u.team && t.alive && CR.dist(t.x, t.y, tx, ty) <= u.splash + t.radius);
            tw.forEach((t) => this.hitTower(t, u.dmg));
          } else if (target.card) {
            this.damageUnit(target, u.dmg);
          } else {
            this.hitTower(target, u.dmg);
          }
          if (u.ranged) {
            this.bolts.push({ x0: u.x, y0: u.y, x1: tx, y1: ty, t: 0, dur: 0.16, team: u.team });
          }
        }

        // 限制在场地内
        u.x = CR.clamp(u.x, 0.4, CR.COLS - 0.4);
        u.y = CR.clamp(u.y, 0.4, CR.ROWS - 0.4);
      }
      this.units = this.units.filter((u) => !u.dead);

      // 塔攻击
      this.towers.forEach((t) => {
        if (!t.alive || !t.active) return;
        if (t.flash > 0) t.flash -= dt;
        if (t.cd > 0) t.cd -= dt;
        let best = null;
        let bestD = Infinity;
        this.units.forEach((u) => {
          if (u.team === t.team || u.dead) return;
          const d = CR.dist(u.x, u.y, t.x, t.y);
          if (d <= t.range && d < bestD) { bestD = d; best = u; }
        });
        if (best && t.cd <= 0) {
          t.cd = t.hitSpeed;
          this.damageUnit(best, t.dmg);
          this.bolts.push({ x0: t.x, y0: t.y - 0.4, x1: best.x, y1: best.y, t: 0, dur: 0.18, team: t.team, tower: true });
        }
      });

      // 特效
      this.bolts = this.bolts.filter((b) => { b.t += dt; return b.t < b.dur; });
      this.blasts = this.blasts.filter((b) => { b.t += dt; return b.t < b.dur; });
      if (this.events.length > 40) this.events.splice(0, this.events.length - 40);
    }

    timeUp() {
      if (this.phase === 'overtime') {
        const c0 = this.players[0].crowns;
        const c1 = this.players[1].crowns;
        if (c0 === c1) this.finish(-1, '加时赛战平');
        else this.finish(c0 > c1 ? 0 : 1, '加时赛结束');
        return;
      }
      const c0 = this.players[0].crowns;
      const c1 = this.players[1].crowns;
      if (c0 !== c1) { this.finish(c0 > c1 ? 0 : 1, '常规时间结束'); return; }
      this.phase = 'overtime';
      this.overtimeLeft = CR.OVERTIME;
      this.timeLeft = 0;
      this.events.push({ t: 'overtime' });
    }

    finish(winner, reason) {
      if (this.phase === 'over') return;
      this.phase = 'over';
      this.result = { winner: winner, reason: reason };
      this.events.push({ t: 'over', winner: winner });
    }

    /* ---------------- 快照（联机下发） ---------------- */

    snapshot() {
      return {
        ph: this.phase,
        tl: Math.max(0, Math.round(this.timeLeft * 10) / 10),
        ov: Math.max(0, Math.round(this.overtimeLeft * 10) / 10),
        e: this.players.map((p) => Math.round(p.elixir * 10) / 10),
        cr: this.players.map((p) => p.crowns),
        h: this.players.map((p) => p.hand.slice()),
        nx: this.players.map((p) => p.next),
        tw: this.towers.filter((t) => t.alive || t.kind === 'king').map((t) => [t.id, Math.max(0, Math.round(t.hp))]),
        u: this.units.map((u) => [u.id, u.team, u.card, Math.round(u.x * 100) / 100, Math.round(u.y * 100) / 100, Math.max(0, Math.round(u.hp))])
      };
    }
  }

  return { Game: Game };
})();
