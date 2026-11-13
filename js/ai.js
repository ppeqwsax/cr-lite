'use strict';

/* ============================================================
   电脑对手：一个够用的贪心 AI
   - 兵线压力大时先防守
   - 圣水富余就推塔
   - 会用法术清成群的小兵
   ============================================================ */

var AI = (function () {
  const LEVELS = {
    easy: { think: 1.9, jitter: 0.7, skip: 0.28, push: 8.5, spellMin: 3 },
    normal: { think: 1.25, jitter: 0.45, skip: 0.12, push: 7.2, spellMin: 3 },
    hard: { think: 0.85, jitter: 0.3, skip: 0.04, push: 6.2, spellMin: 2 }
  };

  function ownHalfY(team) { return team === 1 ? 0 : 20; }

  function nearestTower(game, team, x, y) {
    const ts = game.aliveTowers(team);
    let best = null;
    let bd = Infinity;
    ts.forEach((t) => {
      const d = CR.dist(t.x, t.y, x, y);
      if (d < bd) { bd = d; best = t; }
    });
    return best;
  }

  class Bot {
    constructor(team, level) {
      this.team = team;
      this.cfg = LEVELS[level] || LEVELS.normal;
      this.timer = 1.4;
    }

    update(dt, game) {
      if (game.phase !== 'playing' && game.phase !== 'overtime') return;
      this.timer -= dt;
      if (this.timer > 0) return;
      this.timer = this.cfg.think + Math.random() * this.cfg.jitter;
      if (Math.random() < this.cfg.skip) return;

      const p = game.players[this.team];
      const affordable = [];
      p.hand.forEach((id, i) => {
        const c = CR.CARD_BY_ID[id];
        if (c && c.cost <= p.elixir) affordable.push({ i: i, card: c });
      });
      if (!affordable.length) return;

      const foe = 1 - this.team;
      // 自己半场里的敌人
      const threats = game.units.filter((u) =>
        u.team === foe && (this.team === 1 ? u.y < CR.RIVER.y1 + 1.5 : u.y > CR.RIVER.y0 - 1.5));
      const king = game.towers.filter((t) => t.team === this.team && t.kind === 'king')[0];

      // 1) 成群小兵 → 法术
      if (threats.length >= this.cfg.spellMin) {
        const spell = affordable.filter((a) => a.card.kind === 'spell')
          .sort((a, b) => b.card.spellRadius - a.card.spellRadius)[0];
        if (spell) {
          let sx = 0;
          let sy = 0;
          threats.forEach((u) => { sx += u.x; sy += u.y; });
          sx /= threats.length;
          sy /= threats.length;
          const res = game.play(this.team, spell.i, CR.clamp(sx, 1, CR.COLS - 1), CR.clamp(sy, 1, CR.ROWS - 1));
          if (res.ok) return;
        }
      }

      // 2) 防守：把兵下在威胁前面
      if (threats.length) {
        const threat = threats.sort((a, b) => {
          const ka = king ? CR.dist(a.x, a.y, king.x, king.y) : 0;
          const kb = king ? CR.dist(b.x, b.y, king.x, king.y) : 0;
          return ka - kb;
        })[0];
        const ground = affordable.filter((a) => a.card.kind !== 'spell')
          .sort((a, b) => (b.card.hp || 0) - (a.card.hp || 0));
        if (ground.length) {
          const pick = ground[0];
          const y = CR.clamp(threat.y + (this.team === 1 ? -1.1 : 1.1), 1, CR.ROWS - 1);
          const x = CR.clamp(threat.x, 1, CR.COLS - 1);
          if (CR.canDeployAt(this.team, x, y)) {
            const res = game.play(this.team, pick.i, x, y);
            if (res.ok) return;
          }
        }
      }

      // 3) 进攻：圣水够了就从桥边推
      if (p.elixir >= this.cfg.push) {
        const troops = affordable.filter((a) => a.card.kind === 'troop')
          .sort((a, b) => (b.card.hp || 0) - (a.card.hp || 0));
        if (troops.length) {
          const pick = troops[0];
          const bridge = CR.BRIDGES[Math.random() < 0.5 ? 0 : 1];
          const x = CR.clamp(bridge.cx + (Math.random() * 0.8 - 0.4), 1, CR.COLS - 1);
          const y = this.team === 1 ? CR.RIVER.y0 - 1.3 : CR.RIVER.y1 + 1.3;
          if (CR.canDeployAt(this.team, x, y)) {
            const res = game.play(this.team, pick.i, x, y);
            if (res.ok) return;
          }
        }
      }

      // 4) 没事干：补个建筑 / 任意可下的牌（低费优先）
      if (p.elixir >= CR.ELIXIR_MAX - 0.5) {
        const cheap = affordable.filter((a) => a.card.kind !== 'spell')
          .sort((a, b) => a.card.cost - b.card.cost)[0];
        if (cheap) {
          const tower = nearestTower(game, this.team, 7, ownHalfY(this.team));
          const x = tower ? tower.x : 7;
          const y = this.team === 1 ? 8.4 : 13.6;
          if (CR.canDeployAt(this.team, x, y)) game.play(this.team, cheap.i, x, y);
        }
      }
    }
  }

  return { Bot: Bot, LEVELS: LEVELS };
})();
