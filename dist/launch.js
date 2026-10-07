// daemon/launch.ts
import { spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname, isAbsolute as isAbsolute2, join as join2 } from "node:path";
import { fileURLToPath } from "node:url";

// daemon/data-dir.ts
import { chmodSync, lstatSync } from "node:fs";
import { isAbsolute, join } from "node:path";
function dataFiles(dataDir) {
  return {
    socket: join(dataDir, "d.sock"),
    lock: join(dataDir, "daemon.lock"),
    world: join(dataDir, "world.json"),
    log: join(dataDir, "daemon.log")
  };
}
function checkDataDir(dataDir) {
  if (!isAbsolute(dataDir))
    throw new Error(`data directory is not absolute: ${dataDir}`);
  const info = lstatSync(dataDir);
  if (info.isSymbolicLink() || !info.isDirectory())
    throw new Error(`data directory is not a directory: ${dataDir}`);
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error(`data directory belongs to another user: ${dataDir}`);
  }
  if ((info.mode & 511) !== 448)
    chmodSync(dataDir, 448);
}

// src/game/catalog.ts
var CLASSES = {
  warrior: {
    label: "Kiếm Sĩ",
    baseHp: 120,
    baseAtk: 10,
    crit: 0.05,
    hpPerLevel: 18,
    atkPerLevel: 2.2,
    names: ["Thạch Sanh", "Gióng", "Bảo Long", "Thiết Hổ"]
  },
  mage: {
    label: "Pháp Sư",
    baseHp: 70,
    baseAtk: 16,
    crit: 0.08,
    hpPerLevel: 10,
    atkPerLevel: 3.4,
    names: ["Mây Tím", "Lam Nguyệt", "Huyền Vũ", "Tinh Sương"]
  },
  ranger: {
    label: "Xạ Thủ",
    baseHp: 90,
    baseAtk: 12,
    crit: 0.25,
    hpPerLevel: 13,
    atkPerLevel: 2.6,
    names: ["Lạc Phong", "Hạc Xám", "Tên Gió", "Ưng Vàng"]
  }
};
var RARITIES = {
  common: { label: "Thường", power: 1, weight: 60, color: "gray" },
  uncommon: { label: "Khá", power: 1.4, weight: 25, color: "green" },
  rare: { label: "Hiếm", power: 2, weight: 10, color: "blue" },
  epic: { label: "Sử Thi", power: 3, weight: 4, color: "magenta" },
  legendary: { label: "Huyền Thoại", power: 4.5, weight: 1, color: "yellow" }
};
var RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"];
var SLOT_ORDER = ["weapon", "armor", "trinket"];
var ITEM_NAMES = {
  weapon: ["Kiếm Gỉ", "Gậy Sồi", "Cung Tre", "Rìu Đá", "Dao Găm", "Thương Sắt"],
  armor: ["Áo Vải", "Giáp Da", "Khiên Gỗ", "Áo Lưới", "Mũ Đồng", "Giáp Vảy"],
  trinket: ["Nhẫn Đồng", "Bùa Hạt", "Ngọc Bích", "Lông Phượng", "Vỏ Ốc", "Chuông Bạc"]
};
var TIERS = {
  normal: { label: "Thường", hp: 1, atk: 1, reward: 1, dropChance: 0.12, luck: 0, color: "white" },
  elite: { label: "Tinh Anh", hp: 2.5, atk: 1.4, reward: 3, dropChance: 0.35, luck: 1, color: "cyan" },
  rare: { label: "Hiếm", hp: 4, atk: 1.6, reward: 6, dropChance: 0.7, luck: 2, color: "magenta" },
  boss: { label: "Boss", hp: 8, atk: 2, reward: 12, dropChance: 1, luck: 2, color: "red" }
};
var MONSTERS = [
  { name: "Xương Rò Rỉ", asset: "skeleton" },
  { name: "Goblin Lint", asset: "goblin" },
  { name: "Nấm Race", asset: "mushroom" },
  { name: "Mắt Bay Null", asset: "flying-eye" }
];
var BOSSES = [
  { name: "Pháp Sư Deadlock", asset: "evil-wizard" },
  { name: "Pháp Sư Merge Conflict", asset: "evil-wizard-2" },
  { name: "Pháp Sư Race Condition", asset: "evil-wizard-3" }
];
var KILLS_PER_STAGE = 10;
var MAX_PARTY = 3;
var MAX_INVENTORY = 24;
var REST_STEPS = 4;
var LOG_SIZE = 6;
var RECRUIT_COST = [0, 150, 900];
var EFFECTS = {
  rally: { side: "heroes", label: "Hô khiến", icon: ">>", steps: 20, charges: 0, power: 0.2, line: "Hô khiến! Cả đội hăng hái." },
  secondWind: { side: "heroes", label: "Tiếp sức", icon: "+", steps: 0, charges: 0, power: 0.15, line: "Tiếp sức! Cả đội hồi máu." },
  trust: { side: "heroes", label: "Tin tưởng", icon: "*", steps: 20, charges: 0, power: 0.1, line: "Tin tưởng! Đòn chí mạng sắc hơn." },
  milestone: { side: "heroes", label: "Cột mốc", icon: "[]", steps: 0, charges: 1, power: 0, line: "Cột mốc! Khiên chặn đòn kế tiếp của quái." },
  calm: { side: "heroes", label: "Tĩnh tâm", icon: "~", steps: 0, charges: 0, power: 1, line: "Tĩnh tâm! Cả đội hồi đầy máu." },
  enrage: { side: "monster", label: "Nổi giận", icon: "!!", steps: 20, charges: 0, power: 0.25, line: "Quái nổi giận!" },
  stoneskin: { side: "monster", label: "Giáp đá", icon: "##", steps: 0, charges: 2, power: 0, line: "Quái khoác giáp đá!" },
  regen: { side: "monster", label: "Tái sinh", icon: "^", steps: 0, charges: 0, power: 0.2, line: "Quái tái sinh!" }
};
var ACTION_EFFECT = {
  prompt: "rally",
  turnDone: "secondWind",
  permissionAllowed: "trust",
  commit: "milestone",
  compact: "calm",
  turnAborted: "enrage",
  permissionDenied: "stoneskin",
  bashFailed: "regen"
};

// src/game/engine.ts
function nextRandom(seed) {
  const s = seed + 1831565813 | 0;
  let t = Math.imul(s ^ s >>> 15, 1 | s);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return [s, ((t ^ t >>> 14) >>> 0) / 4294967296];
}
function rand(g) {
  const [seed, value] = nextRandom(g.seed);
  g.seed = seed;
  return value;
}
function pick(g, list) {
  return list[Math.floor(rand(g) * list.length)];
}
function clone(g) {
  return JSON.parse(JSON.stringify(g));
}
function say(g, line) {
  g.log = [...g.log, line].slice(-LOG_SIZE);
}
function newId(g, prefix) {
  g.nextId += 1;
  return `${prefix}${g.nextId}`;
}
function itemPower(item) {
  return Math.round((4 + item.stage * 2.5) * RARITIES[item.rarity].power * (1 + 0.15 * item.level));
}
function itemValue(item) {
  return Math.max(1, Math.round(itemPower(item) * 1.5));
}
function upgradeCost(item) {
  return itemValue(item) * (item.level + 2);
}
function heroStats(hero) {
  const info = CLASSES[hero.cls];
  const lv = hero.level - 1;
  let maxHp = info.baseHp + info.hpPerLevel * lv;
  let atk = info.baseAtk + info.atkPerLevel * lv;
  let crit = info.crit;
  const { weapon, armor, trinket } = hero.gear;
  if (weapon)
    atk += itemPower(weapon);
  if (armor)
    maxHp += itemPower(armor) * 4;
  if (trinket) {
    atk += itemPower(trinket) * 0.4;
    crit += Math.min(0.25, itemPower(trinket) / 200);
  }
  return { maxHp: Math.round(maxHp), atk: Math.round(atk), crit: Math.min(0.75, crit) };
}
function expToNext(level) {
  return Math.round(20 * Math.pow(level, 1.5));
}
function makeHero(g, cls) {
  const taken = new Set(g.heroes.map((h) => h.name));
  const free = CLASSES[cls].names.filter((n) => !taken.has(n));
  const hero = {
    id: newId(g, "h"),
    name: pick(g, free.length > 0 ? free : CLASSES[cls].names),
    cls,
    level: 1,
    exp: 0,
    hp: 0,
    gear: { weapon: null, armor: null, trinket: null }
  };
  hero.hp = heroStats(hero).maxHp;
  return hero;
}
function spawnMonster(g) {
  let tier = "normal";
  if (g.stageKills >= KILLS_PER_STAGE) {
    tier = "boss";
  } else {
    const roll = rand(g);
    if (roll < 0.04)
      tier = "rare";
    else if (roll < 0.19)
      tier = "elite";
  }
  const kinds = tier === "boss" ? BOSSES : MONSTERS;
  const sprite = Math.floor(rand(g) * kinds.length);
  const kind = kinds[sprite] ?? MONSTERS[0];
  const scale = Math.pow(1.22, g.stage - 1);
  const maxHp = Math.round(30 * scale * TIERS[tier].hp);
  return {
    name: kind.name,
    sprite,
    tier,
    hp: maxHp,
    maxHp,
    atk: Math.max(1, Math.round(4 * Math.pow(1.17, g.stage - 1) * TIERS[tier].atk))
  };
}
function newGame(seed) {
  const g = {
    version: 1,
    seed: seed | 0,
    nextId: 0,
    gold: 0,
    stage: 1,
    stageKills: 0,
    heroes: [],
    inventory: [],
    monster: { name: "", sprite: 0, tier: "normal", hp: 1, maxHp: 1, atk: 1 },
    resting: 0,
    frame: 0,
    log: [],
    stats: { kills: 0, toolCalls: 0, testPasses: 0, itemsFound: 0 },
    effects: []
  };
  g.heroes.push(makeHero(g, "warrior"));
  g.monster = spawnMonster(g);
  say(g, `${g.heroes[0].name} lên đường. Gặp ${g.monster.name}!`);
  return g;
}
function rollRarity(g, luck) {
  const total = RARITY_ORDER.reduce((sum, r) => sum + RARITIES[r].weight, 0);
  let best = 0;
  for (let i = 0;i <= luck; i += 1) {
    let roll = rand(g) * total;
    let index = 0;
    for (const r of RARITY_ORDER) {
      roll -= RARITIES[r].weight;
      if (roll < 0)
        break;
      index += 1;
    }
    best = Math.max(best, Math.min(index, RARITY_ORDER.length - 1));
  }
  return RARITY_ORDER[best];
}
function makeItem(g, luck) {
  const slot = pick(g, SLOT_ORDER);
  return {
    id: newId(g, "i"),
    name: pick(g, ITEM_NAMES[slot]),
    slot,
    rarity: rollRarity(g, luck),
    stage: g.stage,
    level: 0
  };
}
function gainItem(g, item) {
  g.stats.itemsFound += 1;
  g.inventory = [...g.inventory, item];
  if (g.inventory.length > MAX_INVENTORY) {
    const weakest = g.inventory.reduce((low, it) => itemValue(it) < itemValue(low) ? it : low);
    g.inventory = g.inventory.filter((it) => it.id !== weakest.id);
    g.gold += itemValue(weakest);
  }
  say(g, `Nhặt được [${RARITIES[item.rarity].label}] ${item.name}`);
}
function gainExp(g, amount) {
  for (const hero of g.heroes) {
    hero.exp += amount;
    while (hero.exp >= expToNext(hero.level)) {
      hero.exp -= expToNext(hero.level);
      hero.level += 1;
      hero.hp = heroStats(hero).maxHp;
      say(g, `${hero.name} lên cấp ${hero.level}!`);
    }
  }
}
function killMonster(g) {
  const m = g.monster;
  const tier = TIERS[m.tier];
  const scale = Math.pow(1.15, g.stage - 1);
  const gold = Math.round(5 * scale * tier.reward);
  const exp = Math.round(6 * scale * tier.reward);
  g.gold += gold;
  g.stats.kills += 1;
  say(g, `Hạ ${m.name} (+${gold} vàng, +${exp} EXP)`);
  gainExp(g, exp);
  if (rand(g) < tier.dropChance)
    gainItem(g, makeItem(g, tier.luck));
  if (m.tier === "boss") {
    g.stage += 1;
    g.stageKills = 0;
    say(g, `Qua ải! Tiến vào ải ${g.stage}.`);
  } else {
    g.stageKills += 1;
  }
  g.monster = spawnMonster(g);
}
function hasEffect(g, kind) {
  return g.effects.some((e) => e.kind === kind);
}
function useCharge(g, kind) {
  const effect = g.effects.find((e) => e.kind === kind && e.charges > 0);
  if (!effect)
    return false;
  g.effects = g.effects.map((e) => e === effect ? { ...e, charges: e.charges - 1 } : e).filter((e) => e.steps > 0 || e.charges > 0);
  return true;
}
function tickEffects(g) {
  g.effects = g.effects.map((e) => e.steps > 0 ? { ...e, steps: e.steps - 1 } : e).filter((e) => e.steps > 0 || e.charges > 0);
}
function critChance(hero, g) {
  const { crit } = heroStats(hero);
  return hasEffect(g, "trust") ? Math.min(0.75, crit + EFFECTS.trust.power) : crit;
}
function partyAttacks(g, withEffects) {
  for (const hero of g.heroes) {
    if (hero.hp <= 0)
      continue;
    const { atk, crit } = heroStats(hero);
    const damage = rand(g) < (withEffects ? critChance(hero, g) : crit) ? atk * 2 : atk;
    g.monster.hp = Math.max(0, g.monster.hp - damage);
    if (g.monster.hp === 0) {
      killMonster(g);
      return true;
    }
  }
  return false;
}
function stepCombat(state) {
  const g = clone(state);
  g.frame = g.frame === 0 ? 1 : 0;
  if (g.resting > 0) {
    g.resting -= 1;
    if (g.resting === 0) {
      for (const hero of g.heroes)
        hero.hp = heroStats(hero).maxHp;
      say(g, "Cả đội hồi phục, chiến tiếp!");
    }
    return g;
  }
  if (!useCharge(g, "stoneskin")) {
    if (partyAttacks(g, true))
      return g;
    if (hasEffect(g, "rally") && rand(g) < EFFECTS.rally.power && partyAttacks(g, true))
      return g;
  }
  const alive = g.heroes.filter((h) => h.hp > 0);
  if (alive.length > 0) {
    const target = pick(g, alive);
    if (!useCharge(g, "milestone")) {
      const atk = hasEffect(g, "enrage") ? Math.round(g.monster.atk * (1 + EFFECTS.enrage.power)) : g.monster.atk;
      target.hp = Math.max(0, target.hp - atk);
    }
  }
  for (const hero of g.heroes) {
    if (hero.hp > 0)
      hero.hp = Math.min(heroStats(hero).maxHp, hero.hp + Math.ceil(heroStats(hero).maxHp * 0.03));
  }
  if (g.heroes.every((h) => h.hp <= 0)) {
    g.resting = REST_STEPS;
    g.monster.hp = g.monster.maxHp;
    say(g, `Cả đội gục trước ${g.monster.name}... nghỉ một chút.`);
  }
  return g;
}
function step(state) {
  const g = stepCombat(state);
  tickEffects(g);
  return g;
}
function rewardToolCall(state) {
  const g = clone(state);
  g.stats.toolCalls += 1;
  g.gold += 1 + Math.floor(g.stage / 2);
  gainExp(g, 2 + g.stage);
  if (g.resting === 0)
    partyAttacks(g, false);
  return g;
}
function applyAction(state, action) {
  const g = clone(state);
  const kind = ACTION_EFFECT[action];
  const info = EFFECTS[kind];
  if (kind === "secondWind" || kind === "calm") {
    for (const hero of g.heroes) {
      if (hero.hp <= 0)
        continue;
      const max = heroStats(hero).maxHp;
      hero.hp = Math.min(max, hero.hp + Math.round(max * info.power));
    }
  } else if (kind === "regen") {
    g.monster.hp = Math.min(g.monster.maxHp, g.monster.hp + Math.round(g.monster.maxHp * info.power));
  } else {
    g.effects = [...g.effects.filter((e) => e.kind !== kind), { kind, steps: info.steps, charges: info.charges }];
  }
  say(g, info.line);
  return g;
}
function rewardTestPass(state) {
  const g = clone(state);
  g.stats.testPasses += 1;
  const gold = 20 + 10 * g.stage;
  const exp = 30 + 8 * g.stage;
  g.gold += gold;
  say(g, `Test xanh! +${gold} vàng, +${exp} EXP`);
  gainExp(g, exp);
  gainItem(g, makeItem(g, 2));
  return g;
}
function equip(state, heroId, itemId) {
  const g = clone(state);
  const hero = g.heroes.find((h) => h.id === heroId);
  const item = g.inventory.find((it) => it.id === itemId);
  if (!hero || !item)
    return { state, error: "Không tìm thấy anh hùng hoặc vật phẩm." };
  const old = hero.gear[item.slot];
  const before = heroStats(hero).maxHp;
  hero.gear[item.slot] = item;
  g.inventory = g.inventory.filter((it) => it.id !== itemId);
  if (old)
    g.inventory = [...g.inventory, old];
  hero.hp = hero.hp <= 0 ? 0 : Math.max(1, Math.min(heroStats(hero).maxHp, hero.hp + heroStats(hero).maxHp - before));
  say(g, `${hero.name} trang bị ${item.name}`);
  return { state: g };
}
function unequip(state, heroId, slot) {
  const g = clone(state);
  const hero = g.heroes.find((h) => h.id === heroId);
  const item = hero?.gear[slot];
  if (!hero || !item)
    return { state, error: "Ô trang bị đang trống." };
  if (g.inventory.length >= MAX_INVENTORY)
    return { state, error: "Túi đồ đã đầy." };
  hero.gear[slot] = null;
  g.inventory = [...g.inventory, item];
  hero.hp = Math.min(hero.hp, heroStats(hero).maxHp);
  return { state: g };
}
function sell(state, itemId) {
  const g = clone(state);
  const item = g.inventory.find((it) => it.id === itemId);
  if (!item)
    return { state, error: "Không tìm thấy vật phẩm." };
  g.inventory = g.inventory.filter((it) => it.id !== itemId);
  g.gold += itemValue(item);
  say(g, `Bán ${item.name} được ${itemValue(item)} vàng`);
  return { state: g };
}
function upgrade(state, heroId, slot) {
  const g = clone(state);
  const hero = g.heroes.find((h) => h.id === heroId);
  const item = hero?.gear[slot];
  if (!hero || !item)
    return { state, error: "Ô trang bị đang trống." };
  const cost = upgradeCost(item);
  if (g.gold < cost)
    return { state, error: `Cần ${cost} vàng để nâng cấp.` };
  g.gold -= cost;
  item.level += 1;
  say(g, `${item.name} lên +${item.level}`);
  return { state: g };
}
function recruitCost(state) {
  return state.heroes.length >= MAX_PARTY ? null : RECRUIT_COST[state.heroes.length] ?? null;
}
function recruit(state, cls) {
  const cost = recruitCost(state);
  if (cost === null)
    return { state, error: `Đội đã đủ ${MAX_PARTY} người.` };
  if (state.gold < cost)
    return { state, error: `Cần ${cost} vàng để chiêu mộ.` };
  const g = clone(state);
  g.gold -= cost;
  const hero = makeHero(g, cls);
  g.heroes = [...g.heroes, hero];
  say(g, `${hero.name} (${CLASSES[cls].label}) gia nhập đội!`);
  return { state: g };
}
var SLOTS_SET = new Set(SLOT_ORDER);
function isItem(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const it = value;
  return typeof it.id === "string" && typeof it.name === "string" && typeof it.slot === "string" && SLOTS_SET.has(it.slot) && typeof it.rarity === "string" && Object.hasOwn(RARITIES, it.rarity) && Number.isFinite(it.stage) && Number.isFinite(it.level);
}
function isHero(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const h = value;
  const gear = h.gear;
  return typeof h.id === "string" && typeof h.name === "string" && typeof h.cls === "string" && Object.hasOwn(CLASSES, h.cls) && Number.isFinite(h.level) && Number.isFinite(h.exp) && Number.isFinite(h.hp) && typeof gear === "object" && gear !== null && SLOT_ORDER.every((slot) => gear[slot] === null || isItem(gear[slot]) && gear[slot].slot === slot);
}
function isMonster(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const m = value;
  return typeof m.name === "string" && typeof m.tier === "string" && Object.hasOwn(TIERS, m.tier) && Number.isFinite(m.sprite) && Number.isFinite(m.hp) && Number.isFinite(m.maxHp) && Number.isFinite(m.atk);
}
function isEffect(value) {
  if (typeof value !== "object" || value === null)
    return false;
  const e = value;
  return typeof e.kind === "string" && Object.hasOwn(EFFECTS, e.kind) && typeof e.steps === "number" && Number.isFinite(e.steps) && e.steps >= 0 && typeof e.charges === "number" && Number.isFinite(e.charges) && e.charges >= 0;
}
function parseSave(raw) {
  if (typeof raw !== "object" || raw === null)
    return null;
  const g = raw;
  const stats = g.stats;
  const isValid = g.version === 1 && Number.isFinite(g.seed) && Number.isFinite(g.nextId) && Number.isFinite(g.gold) && Number.isFinite(g.stage) && Number.isFinite(g.stageKills) && Number.isFinite(g.resting) && Number.isFinite(g.frame) && Array.isArray(g.heroes) && g.heroes.length > 0 && g.heroes.every(isHero) && Array.isArray(g.inventory) && g.inventory.every(isItem) && isMonster(g.monster) && Array.isArray(g.log) && g.log.every((line) => typeof line === "string") && typeof stats === "object" && stats !== null && Number.isFinite(stats.kills) && Number.isFinite(stats.toolCalls) && Number.isFinite(stats.testPasses) && Number.isFinite(stats.itemsFound);
  if (!isValid)
    return null;
  const effects = Array.isArray(g.effects) ? g.effects.filter(isEffect) : [];
  return { ...raw, effects };
}
function isNewerSave(raw) {
  if (typeof raw !== "object" || raw === null)
    return false;
  const version = raw.version;
  return typeof version === "number" && version > 1;
}

// daemon/protocol.ts
var DAEMON_MARK = "terminal-tales-daemon";
var MAX_BODY_BYTES = 64 * 1024;
var PLAIN_KINDS = new Set([...Object.keys(ACTION_EFFECT), "toolCall", "testPass"]);
var MAX_ID_LENGTH = 64;
function isId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH;
}
function isSlot(value) {
  return typeof value === "string" && SLOT_ORDER.includes(value);
}
function isClass(value) {
  return typeof value === "string" && Object.hasOwn(CLASSES, value);
}
function parseAction(raw) {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const body = raw;
  const field = (name) => Object.hasOwn(body, name) ? body[name] : undefined;
  const kind = field("kind");
  const id = field("id");
  if (typeof kind !== "string" || id !== undefined && !isId(id))
    return null;
  const action = parseKind(kind, field);
  return action === null || id === undefined ? action : { ...action, id };
}
function parseKind(kind, field) {
  if (PLAIN_KINDS.has(kind))
    return { kind };
  if (kind !== "hero")
    return null;
  const op = field("op");
  switch (op) {
    case "equip": {
      const heroId = field("heroId");
      const itemId = field("itemId");
      return isId(heroId) && isId(itemId) ? { kind, op, heroId, itemId } : null;
    }
    case "unequip":
    case "upgrade": {
      const heroId = field("heroId");
      const slot = field("slot");
      return isId(heroId) && isSlot(slot) ? { kind, op, heroId, slot } : null;
    }
    case "sell": {
      const itemId = field("itemId");
      return isId(itemId) ? { kind, op, itemId } : null;
    }
    case "recruit": {
      const cls = field("cls");
      return isClass(cls) ? { kind, op, cls } : null;
    }
    default:
      return null;
  }
}
function applyHero(g, hero) {
  switch (hero.op) {
    case "equip":
      return equip(g, hero.heroId, hero.itemId);
    case "unequip":
      return unequip(g, hero.heroId, hero.slot);
    case "upgrade":
      return upgrade(g, hero.heroId, hero.slot);
    case "sell":
      return sell(g, hero.itemId);
    case "recruit":
      return recruit(g, hero.cls);
  }
}
function applyDaemonAction(g, action) {
  if (action.kind === "hero")
    return applyHero(g, action);
  if (action.kind === "toolCall")
    return { state: rewardToolCall(g) };
  if (action.kind === "testPass")
    return { state: rewardTestPass(g) };
  return { state: applyAction(g, action.kind) };
}
function compareVersions(a, b) {
  const parts = (v) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0;i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0)
      return diff;
  }
  return 0;
}
function buildId(text) {
  let hash = 2166136261;
  for (let i = 0;i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// daemon/launch.ts
function fail(message) {
  console.error(message);
  process.exit(2);
}
var [flag, dataDir] = process.argv.slice(2);
if (flag !== "--detach" || dataDir === undefined || !isAbsolute2(dataDir)) {
  fail("usage: launch.js --detach <absolute data directory>");
}
process.umask(63);
mkdirSync(dataDir, { recursive: true, mode: 448 });
try {
  checkDataDir(dataDir);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
var server = join2(dirname(fileURLToPath(import.meta.url)), "server.js");
var out = openSync(dataFiles(dataDir).log, "a", 384);
var env = {};
for (const name of ["PATH", "HOME", "TT_IDLE_MS"]) {
  const value = process.env[name];
  if (value !== undefined)
    env[name] = value;
}
var child = spawn(process.execPath, [server, DAEMON_MARK, dataDir], {
  cwd: dataDir,
  env,
  detached: true,
  stdio: ["ignore", out, out]
});
child.unref();
console.log(JSON.stringify({ launched: child.pid }));
process.exit(0);
