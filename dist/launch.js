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
  { name: "Slime Bug", sprite: ["      ", " .--. ", "(o  o)", " `--` "] },
  { name: "Goblin Lint", sprite: ["  ,,  ", " (><) ", " /||\\ ", "  /\\  "] },
  { name: "Dơi Null", sprite: ["      ", "/\\  /\\", "\\(oo)/", "  vv  "] },
  { name: "Xương Rò Rỉ", sprite: ["  __  ", " (xx) ", " -||- ", "  /\\  "] },
  { name: "Nấm Race", sprite: [" .--. ", "(o..o)", " |  | ", ' "--" '] }
];
var BOSSES = [
  { name: "Rồng Merge Conflict", sprite: ["  /\\_/\\", " <(@@)>", "/|_vv_|", " /    \\"] },
  { name: "Quỷ Deadlock", sprite: [" )\\ /( ", " (OwO) ", "<|###|>", " /   \\ "] }
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
  const kind = Object.hasOwn(body, "kind") ? body.kind : undefined;
  if (typeof kind !== "string")
    return null;
  if (PLAIN_KINDS.has(kind))
    return { kind };
  if (kind !== "hero")
    return null;
  const field = (name) => Object.hasOwn(body, name) ? body[name] : undefined;
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
