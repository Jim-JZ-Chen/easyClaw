// ============================================================
//  cards.js — 卡牌数据库（逻辑层，零 DOM 依赖）
// ============================================================

const CARDS = {
  // ── 初始牌组 ──────────────────────────────────────────────
  strike: {
    id: 'strike', name: '斩击', cost: 1, type: 'ATTACK',
    rarity: 'BASIC', desc: '造成 {dmg} 点伤害。',
    params: { dmg: 6 },
    effect(ctx) { ctx.dealDamage(ctx.target, ctx.calc(6)); }
  },
  defend: {
    id: 'defend', name: '防御', cost: 1, type: 'SKILL',
    rarity: 'BASIC', desc: '获得 {block} 点格挡。',
    params: { block: 5 },
    effect(ctx) { ctx.gainBlock(ctx.player, ctx.calcBlock(5)); }
  },
  bash: {
    id: 'bash', name: '重击', cost: 2, type: 'ATTACK',
    rarity: 'BASIC', desc: '造成 {dmg} 点伤害，施加 2 层易伤。',
    params: { dmg: 8 },
    effect(ctx) {
      ctx.dealDamage(ctx.target, ctx.calc(8));
      ctx.applyStatus(ctx.target, 'vulnerable', 2);
    }
  },

  // ── 攻击牌 ────────────────────────────────────────────────
  cleave: {
    id: 'cleave', name: '横扫', cost: 1, type: 'ATTACK',
    rarity: 'COMMON', desc: '对所有敌人造成 {dmg} 点伤害。',
    params: { dmg: 8 },
    effect(ctx) { ctx.enemies.forEach(e => ctx.dealDamage(e, ctx.calc(8))); }
  },
  twin_strike: {
    id: 'twin_strike', name: '连击', cost: 1, type: 'ATTACK',
    rarity: 'COMMON', desc: '造成两次 {dmg} 点伤害。',
    params: { dmg: 5 },
    effect(ctx) {
      ctx.dealDamage(ctx.target, ctx.calc(5));
      ctx.dealDamage(ctx.target, ctx.calc(5));
    }
  },
  pommel_strike: {
    id: 'pommel_strike', name: '剑柄猛击', cost: 1, type: 'ATTACK',
    rarity: 'COMMON', desc: '造成 {dmg} 点伤害，摸 1 张牌。',
    params: { dmg: 9 },
    effect(ctx) {
      ctx.dealDamage(ctx.target, ctx.calc(9));
      ctx.draw(1);
    }
  },
  perfected_strike: {
    id: 'perfected_strike', name: '精准一击', cost: 2, type: 'ATTACK',
    rarity: 'COMMON', desc: '造成 {dmg} 点伤害。每有一张"击"牌额外 +2 伤害。',
    params: { dmg: 6 },
    effect(ctx) {
      const strikeCount = [...ctx.player.hand, ...ctx.player.deck, ...ctx.player.discard]
        .filter(c => c.id.includes('strike')).length;
      ctx.dealDamage(ctx.target, ctx.calc(6 + strikeCount * 2));
    }
  },
  whirlwind: {
    id: 'whirlwind', name: '旋风斩', cost: -1, type: 'ATTACK',
    rarity: 'UNCOMMON', desc: '消耗所有能量，对所有敌人造成 {dmg}×能量 点伤害。',
    params: { dmg: 5 },
    effect(ctx) {
      const e = ctx.player.energy;
      ctx.enemies.forEach(en => {
        for (let i = 0; i < e; i++) ctx.dealDamage(en, ctx.calc(5));
      });
      ctx.spendEnergy(e);
    }
  },
  body_slam: {
    id: 'body_slam', name: '猛冲', cost: 1, type: 'ATTACK',
    rarity: 'UNCOMMON', desc: '造成等同于自身格挡值的伤害。',
    params: { dmg: 0 },
    effect(ctx) { ctx.dealDamage(ctx.target, ctx.calc(ctx.player.block)); }
  },
  sword_boomerang: {
    id: 'sword_boomerang', name: '回旋剑', cost: 1, type: 'ATTACK',
    rarity: 'UNCOMMON', desc: '随机攻击敌人 3 次，每次 {dmg} 点伤害。',
    params: { dmg: 3 },
    effect(ctx) {
      for (let i = 0; i < 3; i++) {
        const t = ctx.enemies[Math.floor(Math.random() * ctx.enemies.length)];
        ctx.dealDamage(t, ctx.calc(3));
      }
    }
  },
  headbutt: {
    id: 'headbutt', name: '头槌', cost: 1, type: 'ATTACK',
    rarity: 'UNCOMMON', desc: '造成 {dmg} 点伤害，将弃牌堆顶部一张牌放回牌堆顶。',
    params: { dmg: 9 },
    effect(ctx) {
      ctx.dealDamage(ctx.target, ctx.calc(9));
      if (ctx.player.discard.length > 0) {
        const card = ctx.player.discard.pop();
        ctx.player.deck.unshift(card);
        ctx.log(`${card.name} 被放回牌堆顶。`);
      }
    }
  },
  reckless_charge: {
    id: 'reckless_charge', name: '鲁莽冲锋', cost: 0, type: 'ATTACK',
    rarity: 'UNCOMMON', desc: '造成 {dmg} 点伤害，将一张负伤加入弃牌堆。',
    params: { dmg: 7 },
    effect(ctx) {
      ctx.dealDamage(ctx.target, ctx.calc(7));
      ctx.addToDiscard('wound');
    }
  },

  // ── 技能牌 ────────────────────────────────────────────────
  shrug_it_off: {
    id: 'shrug_it_off', name: '甩开', cost: 1, type: 'SKILL',
    rarity: 'COMMON', desc: '获得 {block} 点格挡，摸 1 张牌。',
    params: { block: 8 },
    effect(ctx) { ctx.gainBlock(ctx.player, ctx.calcBlock(8)); ctx.draw(1); }
  },
  true_grit: {
    id: 'true_grit', name: '真正的勇气', cost: 1, type: 'SKILL',
    rarity: 'COMMON', desc: '获得 {block} 点格挡，随机废除手中一张牌。',
    params: { block: 7 },
    effect(ctx) {
      ctx.gainBlock(ctx.player, ctx.calcBlock(7));
      if (ctx.player.hand.length > 1) {
        const idx = Math.floor(Math.random() * ctx.player.hand.length);
        const removed = ctx.player.hand.splice(idx, 1)[0];
        ctx.log(`废除了 ${removed.name}。`);
      }
    }
  },
  armaments: {
    id: 'armaments', name: '装甲', cost: 1, type: 'SKILL',
    rarity: 'COMMON', desc: '获得 {block} 点格挡，升级手中一张牌本回合。',
    params: { block: 5 },
    effect(ctx) { ctx.gainBlock(ctx.player, ctx.calcBlock(5)); }
  },
  entrench: {
    id: 'entrench', name: '深挖壕沟', cost: 2, type: 'SKILL',
    rarity: 'UNCOMMON', desc: '将当前格挡值翻倍。',
    params: {},
    effect(ctx) { ctx.player.block *= 2; ctx.log(`格挡翻倍至 ${ctx.player.block}。`); }
  },
  disarm: {
    id: 'disarm', name: '缴械', cost: 1, type: 'SKILL',
    rarity: 'UNCOMMON', desc: '使目标失去 2 点力量，废除此牌。',
    params: {},
    exhaust: true,
    effect(ctx) { ctx.applyStatus(ctx.target, 'strength', -2); }
  },
  war_cry: {
    id: 'war_cry', name: '战吼', cost: 0, type: 'SKILL',
    rarity: 'UNCOMMON', desc: '摸 2 张牌，废除此牌。',
    params: {},
    exhaust: true,
    effect(ctx) { ctx.draw(2); }
  },

  // ── 能力牌 ────────────────────────────────────────────────
  flex: {
    id: 'flex', name: '怒气', cost: 0, type: 'POWER',
    rarity: 'COMMON', desc: '获得 2 点力量，回合结束时失去 2 点力量。',
    params: {},
    effect(ctx) {
      ctx.applyStatus(ctx.player, 'strength', 2);
      ctx.applyStatus(ctx.player, 'strength_down', 2);
    }
  },
  inflame: {
    id: 'inflame', name: '激怒', cost: 1, type: 'POWER',
    rarity: 'UNCOMMON', desc: '永久获得 2 点力量。',
    params: {},
    effect(ctx) { ctx.applyStatus(ctx.player, 'strength', 2); }
  },
  combust: {
    id: 'combust', name: '燃烧', cost: 1, type: 'POWER',
    rarity: 'UNCOMMON', desc: '每回合损失 1 HP，对所有敌人造成 5 点伤害。',
    params: {},
    effect(ctx) { ctx.applyStatus(ctx.player, 'combust', 5); }
  },
  barricade: {
    id: 'barricade', name: '路障', cost: 3, type: 'POWER',
    rarity: 'RARE', desc: '格挡不再在回合开始时清零。',
    params: {},
    effect(ctx) { ctx.applyStatus(ctx.player, 'barricade', 1); }
  },
  demon_form: {
    id: 'demon_form', name: '恶魔形态', cost: 3, type: 'POWER',
    rarity: 'RARE', desc: '每回合开始获得 2 点力量。',
    params: {},
    effect(ctx) { ctx.applyStatus(ctx.player, 'demon_form', 2); }
  },

  // ── 特殊牌（非战斗） ──────────────────────────────────────
  wound: {
    id: 'wound', name: '负伤', cost: -2, type: 'STATUS',
    rarity: 'SPECIAL', desc: '无法打出。',
    params: {},
    unplayable: true,
    effect(ctx) {}
  }
};

// 将描述中的 {key} 替换为 params 中的实际数值
function interpolateDesc(desc, params) {
  if (!params) return desc;
  return desc.replace(/\{(\w+)\}/g, (_, key) => params[key] !== undefined ? params[key] : `{${key}}`);
}

// 返回卡牌实例副本（描述已插值）
function getCard(id) {
  const template = CARDS[id];
  if (!template) return null;
  const card = { ...template };
  card.desc = interpolateDesc(card.desc, card.params);
  return card;
}

// 所有可奖励卡牌池（排除初始和特殊牌）
function getRewardPool() {
  return Object.values(CARDS).filter(c =>
    c.rarity !== 'BASIC' && c.rarity !== 'SPECIAL'
  ).map(c => c.id);
}

if (typeof module !== 'undefined') module.exports = { CARDS, getCard, getRewardPool };
