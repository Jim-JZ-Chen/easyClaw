// ============================================================
//  enemies.js — 敌人数据库（逻辑层，零 DOM 依赖）
// ============================================================

// 意图类型
const INTENT = {
  ATTACK: 'ATTACK',
  DEFEND: 'DEFEND',
  BUFF:   'BUFF',
  DEBUFF: 'DEBUFF',
  UNKNOWN:'UNKNOWN'
};

// 敌人模板
const ENEMY_TEMPLATES = {

  // ── 普通敌人 ──────────────────────────────────────────────
  louse: {
    id: 'louse', name: '酸虱', icon: '🐛',
    hp: [10, 15], block: 0,
    statuses: {},
    intentCycle: ['ATTACK', 'ATTACK', 'DEFEND'],
    actions: {
      ATTACK: (e, p, rng) => ({ type: INTENT.ATTACK, dmg: rng(5, 7), desc: `攻击 ${rng(5,7)}` }),
      DEFEND: (e, p, rng) => ({ type: INTENT.DEFEND, block: 6, desc: '防御 6' }),
    }
  },

  cultist: {
    id: 'cultist', name: '邪教徒', icon: '🧙',
    hp: [48, 56], block: 0,
    statuses: {},
    intentCycle: ['BUFF', 'ATTACK', 'ATTACK', 'ATTACK'],
    actions: {
      BUFF:   (e, p, rng) => ({ type: INTENT.BUFF, status: 'strength', amount: 3, desc: '仪式 +3力量' }),
      ATTACK: (e, p, rng) => ({ type: INTENT.ATTACK, dmg: 6 + (e.statuses.strength || 0), desc: `黑暗刺击 ${6 + (e.statuses.strength || 0)}` }),
    }
  },

  jaw_worm: {
    id: 'jaw_worm', name: '颚虫', icon: '🪱',
    hp: [40, 44], block: 0,
    statuses: {},
    intentCycle: ['ATTACK', 'DEFEND_BUFF', 'ATTACK', 'ATTACK'],
    actions: {
      ATTACK:       (e, p, rng) => ({ type: INTENT.ATTACK, dmg: 11, desc: '撕咬 11' }),
      DEFEND_BUFF:  (e, p, rng) => ({ type: INTENT.DEFEND, block: 6, status: 'strength', amount: 3, desc: '猛冲 格挡6 力量+3' }),
    }
  },

  slime: {
    id: 'slime', name: '黏液', icon: '🟢',
    hp: [65, 70], block: 0,
    statuses: {},
    intentCycle: ['ATTACK', 'DEBUFF', 'ATTACK', 'DEFEND'],
    actions: {
      ATTACK: (e, p, rng) => ({ type: INTENT.ATTACK, dmg: 8, times: 2, desc: '黏附 8×2' }),
      DEBUFF: (e, p, rng) => ({ type: INTENT.DEBUFF, status: 'slimed', amount: 1, desc: '滑溜 +1' }),
      DEFEND: (e, p, rng) => ({ type: INTENT.DEFEND, block: 9, desc: '固化 9' }),
    }
  },

  // ── 精英敌人 ──────────────────────────────────────────────
  gremlin_nob: {
    id: 'gremlin_nob', name: '哥布林头目', icon: '👺',
    hp: [82, 86], block: 0,
    statuses: {},
    intentCycle: ['BUFF', 'ATTACK', 'ATTACK', 'DEBUFF', 'ATTACK'],
    elite: true,
    actions: {
      BUFF:   (e, p, rng) => ({ type: INTENT.BUFF, status: 'strength', amount: 3, desc: '怒吼 力量+3' }),
      ATTACK: (e, p, rng) => {
        const dmg = 14 + (e.statuses.strength || 0);
        return { type: INTENT.ATTACK, dmg, desc: `强力一击 ${dmg}` };
      },
      DEBUFF: (e, p, rng) => ({ type: INTENT.DEBUFF, status: 'vulnerable', amount: 2, desc: '挑衅 易伤2' }),
    }
  },

  // ── Boss ──────────────────────────────────────────────────
  hexaghost: {
    id: 'hexaghost', name: '六角幽灵', icon: '👻',
    hp: [250, 250], block: 0,
    statuses: {},
    intentCycle: ['ACTIVATE', 'ATTACK', 'ATTACK', 'DEBUFF', 'ATTACK', 'ATTACK', 'BURN'],
    elite: false, boss: true,
    actions: {
      ACTIVATE: (e, p, rng) => ({ type: INTENT.BUFF, desc: '苏醒（预判玩家HP）' }),
      ATTACK:   (e, p, rng) => ({ type: INTENT.ATTACK, dmg: 6, times: 6, desc: '六重灼烧 6×6' }),
      DEBUFF:   (e, p, rng) => ({ type: INTENT.DEBUFF, status: 'vulnerable', amount: 2, desc: '灼热之焰 易伤2' }),
      BURN:     (e, p, rng) => ({ type: INTENT.ATTACK, dmg: 18, times: 3, desc: '熊熊燃烧 18×3', addBurns: true }),
    }
  },

  slime_boss: {
    id: 'slime_boss', name: '黏液Boss', icon: '💚',
    hp: [140, 140], block: 0,
    statuses: {},
    intentCycle: ['ATTACK', 'DEBUFF', 'ATTACK', 'SPLIT'],
    elite: false, boss: true,
    actions: {
      ATTACK: (e, p, rng) => ({ type: INTENT.ATTACK, dmg: 35, desc: '黏液波 35' }),
      DEBUFF: (e, p, rng) => ({ type: INTENT.DEBUFF, status: 'slimed', amount: 3, desc: '腐蚀 黏液3' }),
      SPLIT:  (e, p, rng) => ({ type: INTENT.BUFF, desc: '分裂！', split: true }),
    }
  }
};

/**
 * 创建一个敌人实例
 * @param {string} templateId
 * @param {function} rng - 随机整数函数 (min, max) => int
 */
function createEnemy(templateId, rng) {
  const tmpl = ENEMY_TEMPLATES[templateId];
  if (!tmpl) throw new Error(`Unknown enemy: ${templateId}`);
  const hp = Array.isArray(tmpl.hp)
    ? rng(tmpl.hp[0], tmpl.hp[1])
    : tmpl.hp;
  return {
    ...tmpl,
    instanceId: `${templateId}_${Date.now()}_${rng(0, 9999)}`,
    maxHp: hp,
    hp,
    block: 0,
    statuses: { ...tmpl.statuses },
    intentIndex: 0,
    currentIntent: null,
    alive: true,
  };
}

/**
 * 计算敌人当前意图
 */
function computeIntent(enemy, player, rng) {
  const cycle = enemy.intentCycle;
  const key = cycle[enemy.intentIndex % cycle.length];
  const action = enemy.actions[key];
  return action ? action(enemy, player, rng) : { type: INTENT.UNKNOWN, desc: '???' };
}

// 每个房间对应的敌人配置
const ROOM_ENEMIES = {
  // floor => [可能的敌人组合]
  1: [
    ['louse', 'louse'],
    ['cultist'],
    ['jaw_worm'],
    ['louse', 'cultist'],
  ],
  2: [
    ['slime'],
    ['jaw_worm', 'louse'],
    ['cultist', 'cultist'],
    ['slime', 'louse'],
  ],
  3: [
    ['slime', 'jaw_worm'],
    ['cultist', 'slime'],
    ['jaw_worm', 'jaw_worm'],
  ],
  elite: [['gremlin_nob']],
  boss1: [['slime_boss']],
  boss2: [['hexaghost']],
};

function getEnemiesForRoom(floor, type, rng) {
  if (type === 'ELITE') return ROOM_ENEMIES.elite[0];
  if (type === 'BOSS') return floor <= 1 ? ROOM_ENEMIES.boss1[0] : ROOM_ENEMIES.boss2[0];
  const pool = ROOM_ENEMIES[Math.min(floor, 3)];
  return pool[rng(0, pool.length - 1)];
}

if (typeof module !== 'undefined') {
  module.exports = { ENEMY_TEMPLATES, INTENT, createEnemy, computeIntent, getEnemiesForRoom };
}
