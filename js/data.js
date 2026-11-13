'use strict';

/* ============================================================
   常量、场地几何、卡牌与塔的数值表
   单位统一用「格」为坐标单位，渲染时乘 TILE
   ============================================================ */

var CR = (function () {
  const COLS = 14;
  const ROWS = 22;
  const TILE = 36;

  const RIVER = { y0: 10, y1: 12 };
  const BRIDGES = [
    { x0: 2.6, x1: 4.6, cx: 3.6 },
    { x0: 9.4, x1: 11.4, cx: 10.4 }
  ];

  const MID_Y = (RIVER.y0 + RIVER.y1) / 2;

  const ELIXIR_MAX = 10;
  const ELIXIR_PERIOD = 2.8;
  const OVERTIME = 60;
  const REGULAR = 180;
  const DOUBLE_ELIXIR_AT = 60; // 剩余 60 秒起双倍圣水

  // 每方三座塔：两座公主塔 + 一座国王塔
  const TOWERS = [
    // team 0（下方）
    { id: 'k0', team: 0, kind: 'king', x: 7, y: 19.4 },
    { id: 'p0l', team: 0, kind: 'princess', x: 3, y: 16.4 },
    { id: 'p0r', team: 0, kind: 'princess', x: 11, y: 16.4 },
    // team 1（上方）
    { id: 'k1', team: 1, kind: 'king', x: 7, y: 2.6 },
    { id: 'p1l', team: 1, kind: 'princess', x: 3, y: 5.6 },
    { id: 'p1r', team: 1, kind: 'princess', x: 11, y: 5.6 }
  ];

  const TOWER_STATS = {
    king: { hp: 2600, dmg: 78, hitSpeed: 1.0, range: 7.5, radius: 1.12 },
    princess: { hp: 1500, dmg: 62, hitSpeed: 0.8, range: 7.0, radius: 1.0 }
  };

  /* ---------------- 卡牌 ---------------- */
  // targets: 'all'（可打兵也可打塔/建筑）、'buildings'（只打建筑与塔）
  // kind: 'troop' | 'building' | 'spell'

  const CARDS = [
    {
      id: 'knight', name: '骑士', emoji: '🛡️', cost: 3, kind: 'troop', count: 1,
      hp: 720, dmg: 82, hitSpeed: 1.1, range: 0.85, speed: 1.55, targets: 'all', radius: 0.42,
      color: '#8fb4ea'
    },
    {
      id: 'archers', name: '弓箭手', emoji: '🏹', cost: 3, kind: 'troop', count: 2,
      hp: 250, dmg: 44, hitSpeed: 0.9, range: 4.6, speed: 1.5, targets: 'all', radius: 0.32, ranged: true,
      color: '#7fd8a8'
    },
    {
      id: 'musketeer', name: '火枪手', emoji: '🔫', cost: 4, kind: 'troop', count: 1,
      hp: 360, dmg: 96, hitSpeed: 1.0, range: 5.6, speed: 1.5, targets: 'all', radius: 0.36, ranged: true,
      color: '#9fd0ff'
    },
    {
      id: 'giant', name: '巨人', emoji: '🦍', cost: 5, kind: 'troop', count: 1,
      hp: 2100, dmg: 128, hitSpeed: 1.5, range: 0.95, speed: 1.15, targets: 'buildings', radius: 0.56,
      color: '#f0b27a'
    },
    {
      id: 'goblins', name: '哥布林', emoji: '👺', cost: 2, kind: 'troop', count: 3,
      hp: 165, dmg: 46, hitSpeed: 0.7, range: 0.7, speed: 2.2, targets: 'all', radius: 0.3,
      color: '#9be36b'
    },
    {
      id: 'minipekka', name: '小皮卡', emoji: '🤖', cost: 4, kind: 'troop', count: 1,
      hp: 940, dmg: 330, hitSpeed: 1.6, range: 0.8, speed: 1.85, targets: 'all', radius: 0.44,
      color: '#c9a6ff'
    },
    {
      id: 'cannon', name: '加农炮', emoji: '💣', cost: 3, kind: 'building', count: 1,
      hp: 460, dmg: 74, hitSpeed: 0.9, range: 5.4, speed: 0, targets: 'all', radius: 0.5,
      life: 30, color: '#ffd166'
    },
    {
      id: 'fireball', name: '火球', emoji: '🔥', cost: 4, kind: 'spell', count: 1,
      spellDmg: 330, spellRadius: 1.9, radius: 0.5, color: '#ff7b4a'
    },
    {
      id: 'arrows', name: '万箭齐发', emoji: '☄️', cost: 3, kind: 'spell', count: 1,
      spellDmg: 132, spellRadius: 3.1, radius: 0.5, color: '#ffd166'
    },
    {
      id: 'valkyrie', name: '女武神', emoji: '🪓', cost: 4, kind: 'troop', count: 1,
      hp: 940, dmg: 132, hitSpeed: 1.5, range: 0.9, speed: 1.5, targets: 'all', radius: 0.46,
      splash: 1.15, color: '#ff9ec4'
    },
    {
      id: 'skeletons', name: '骷髅兵', emoji: '💀', cost: 1, kind: 'troop', count: 3,
      hp: 62, dmg: 32, hitSpeed: 0.6, range: 0.6, speed: 2.4, targets: 'all', radius: 0.26,
      color: '#d8dee9'
    },
    {
      id: 'hog', name: '野猪骑士', emoji: '🐗', cost: 4, kind: 'troop', count: 1,
      hp: 820, dmg: 158, hitSpeed: 1.4, range: 0.85, speed: 2.5, targets: 'buildings', radius: 0.46,
      color: '#e8a87c'
    },
    {
      id: 'zap', name: '小电', emoji: '⚡', cost: 2, kind: 'spell', count: 1,
      spellDmg: 190, spellRadius: 1.6, stun: 0.45, radius: 0.5, color: '#7fe3ff'
    },
    {
      id: 'rocket', name: '火箭', emoji: '🚀', cost: 6, kind: 'spell', count: 1,
      spellDmg: 700, spellRadius: 1.7, radius: 0.5, color: '#ff9f43'
    },
    {
      id: 'golem', name: '石头人', emoji: '🗿', cost: 8, kind: 'troop', count: 1,
      hp: 4200, dmg: 240, hitSpeed: 1.5, range: 0.95, speed: 0.9, targets: 'buildings', radius: 0.62,
      splits: 'golemite', splitCount: 2, color: '#b8b2a6'
    },
    {
      id: 'golemite', name: '小石头人', emoji: '🪨', cost: 0, kind: 'troop', count: 1, hidden: true,
      hp: 1100, dmg: 95, hitSpeed: 1.5, range: 0.9, speed: 1.2, targets: 'buildings', radius: 0.34,
      color: '#9d968a'
    },
    {
      id: 'darkprince', name: '黑骑士', emoji: '🐴', cost: 4, kind: 'troop', count: 1,
      hp: 1000, dmg: 150, hitSpeed: 1.4, range: 0.9, speed: 1.9, targets: 'all', radius: 0.46,
      splash: 1.05, charge: true, chargeDist: 1.7, color: '#8f8ff0'
    },
    {
      id: 'barbarians', name: '野蛮人', emoji: '⚔️', cost: 5, kind: 'troop', count: 4,
      hp: 430, dmg: 90, hitSpeed: 1.4, range: 0.85, speed: 1.7, targets: 'all', radius: 0.34,
      color: '#e8c07c'
    },
    {
      id: 'bomber', name: '炸弹人', emoji: '🧨', cost: 3, kind: 'troop', count: 1,
      hp: 280, dmg: 118, hitSpeed: 1.5, range: 4.0, speed: 1.5, targets: 'all', radius: 0.3,
      ranged: true, splash: 1.05, color: '#ffb870'
    },
    {
      id: 'skeletonarmy', name: '骷髅军团', emoji: '🦴', cost: 3, kind: 'troop', count: 12,
      hp: 60, dmg: 30, hitSpeed: 0.9, range: 0.6, speed: 2.3, targets: 'all', radius: 0.22,
      color: '#e4e8f0'
    },
    {
      id: 'wizard', name: '法师', emoji: '🧙', cost: 5, kind: 'troop', count: 1,
      hp: 720, dmg: 185, hitSpeed: 1.4, range: 5.0, speed: 1.5, targets: 'all', radius: 0.36,
      ranged: true, splash: 1.0, color: '#b39dff'
    },
    {
      id: 'witch', name: '女巫', emoji: '🧙‍♀️', cost: 5, kind: 'troop', count: 1,
      hp: 700, dmg: 120, hitSpeed: 1.3, range: 4.6, speed: 1.3, targets: 'all', radius: 0.36,
      ranged: true, splash: 0.9, color: '#c9b6ff',
      summon: { card: 'skeletons', count: 3, interval: 7, first: 1.6 }
    }
  ];

  const CARD_BY_ID = {};
  CARDS.forEach(function (c) { CARD_BY_ID[c.id] = c; });

  const DEFAULT_DECK = ['knight', 'archers', 'musketeer', 'giant', 'goblins', 'cannon', 'fireball', 'hog'];

  /* ---------------- 几何工具 ---------------- */

  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function inRiver(y) { return y > CR.RIVER.y0 - 0.05 && y < CR.RIVER.y1 + 0.05; }

  function onBridge(x) {
    for (let i = 0; i < BRIDGES.length; i++) {
      if (x >= BRIDGES[i].x0 - 0.15 && x <= BRIDGES[i].x1 + 0.15) return BRIDGES[i];
    }
    return null;
  }

  function laneBridge(x) {
    return Math.abs(x - BRIDGES[0].cx) <= Math.abs(x - BRIDGES[1].cx) ? BRIDGES[0] : BRIDGES[1];
  }

  // 某方可以下牌的区域
  function canDeployAt(team, x, y) {
    if (x < 0.6 || x > COLS - 0.6 || y < 0.6 || y > ROWS - 0.6) return false;
    if (team === 0 ? y < CR.RIVER.y1 + 0.2 : y > CR.RIVER.y0 - 0.2) return false;
    for (let i = 0; i < TOWERS.length; i++) {
      const t = TOWERS[i];
      const st = TOWER_STATS[t.kind];
      if (dist(x, y, t.x, t.y) < st.radius + 0.6) return false;
    }
    return true;
  }

  return {
    COLS: COLS, ROWS: ROWS, TILE: TILE,
    RIVER: RIVER, BRIDGES: BRIDGES, MID_Y: MID_Y,
    ELIXIR_MAX: ELIXIR_MAX, ELIXIR_PERIOD: ELIXIR_PERIOD,
    REGULAR: REGULAR, OVERTIME: OVERTIME, DOUBLE_ELIXIR_AT: DOUBLE_ELIXIR_AT,
    TOWERS: TOWERS, TOWER_STATS: TOWER_STATS,
    CARDS: CARDS, CARD_BY_ID: CARD_BY_ID, DEFAULT_DECK: DEFAULT_DECK,
    dist: dist, clamp: clamp, inRiver: inRiver, onBridge: onBridge, laneBridge: laneBridge,
    canDeployAt: canDeployAt
  };
})();
