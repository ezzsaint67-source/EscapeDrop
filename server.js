// server.js — глобальная система для Case Spinner
import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs';
import { randomUUID } from 'crypto';

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// ===== БАЗА ДАННЫХ (файл) =====
const DB_FILE = 'server.json';

let db = {
  users: {},      // id: { id, username, balance, wins, spins, inventory, createdAt }
  drops: [],      // [{ username, item, timestamp }]
  promo: {}       // code: { used: false, reward: 25 }
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
    }
  } catch (e) {
    console.warn('Не удалось загрузить БД, создана новая');
  }
  // Инициализируем demo-промокоды
  if (!db.promo || Object.keys(db.promo).length === 0) {
    db.promo = {
      'DEMO2025': { reward: 25, used: false },
      'CASESPINNER': { reward: 50, used: false },
      'HELLO': { reward: 15, used: false }
    };
  }
  saveDB();
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

loadDB();

// ===== ВСПОМОГАТЕЛЬНЫЕ =====
function getOrCreateUser(id, username) {
  if (!db.users[id]) {
    db.users[id] = {
      id,
      username: username || 'user_' + id.slice(0, 6),
      balance: 100,
      wins: 0,
      spins: 0,
      inventory: [],
      createdAt: Date.now()
    };
    saveDB();
  }
  // Обновляем username, если изменился
  if (username && db.users[id].username !== username) {
    db.users[id].username = username;
    saveDB();
  }
  return db.users[id];
}

function addDrop(username, item) {
  db.drops.unshift({ username, item, timestamp: Date.now() });
  if (db.drops.length > 200) db.drops.length = 200;
  saveDB();
}

function getWeighted(items) {
  const valid = items.filter(x => x.chance > 0);
  let r = Math.random() * 100;
  for (const item of valid) {
    if (r < item.chance) return item;
    r -= item.chance;
  }
  return valid[valid.length - 1] || items[0];
}

// ===== ДАННЫЕ КЕЙСОВ (серверная логика) =====
const IMG_DOMINUS = 'https://github.com/saintezz/DropKeyboard/blob/main/c8e14aec-b504-4d87-915a-dee1c2e706b0.jpg?raw=true';

const CASE_DATA = {
  secret: {
    cost: 10,
    items: [
      { name: 'Golden Mask', chance: 67, img: null, emoji: 'X' },
      { name: 'Candy Dominus', chance: 23, img: IMG_DOMINUS, emoji: null },
      { name: 'Canada', chance: 10, img: null, emoji: 'X' }
    ]
  },
  common: {
    cost: 5,
    items: [
      { name: 'Candy Crown', chance: 90, img: null, emoji: 'X' },
      { name: 'Shell Crown', chance: 10, img: null, emoji: 'X' }
    ]
  }
};

// ===== REST API =====
app.get('/api/state', (req, res) => {
  const id = req.query.id || randomUUID();
  const username = req.query.username || 'user';
  const user = getOrCreateUser(id, username);
  // Отдаём последние 50 дропов
  const recent = db.drops.slice(0, 50);
  res.json({ user, drops: recent });
});

app.post('/api/spin', (req, res) => {
  const { id, username, caseName } = req.body;
  if (!id || !caseName) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  const user = getOrCreateUser(id, username);
  const caseData = CASE_DATA[caseName];
  if (!caseData) {
    return res.status(400).json({ error: 'Кейс не найден' });
  }

  if (user.balance < caseData.cost) {
    return res.status(400).json({ error: 'Недостаточно DEMO' });
  }

  // Спин
  const winner = getWeighted(caseData.items);
  user.balance -= caseData.cost;
  user.spins += 1;
  user.wins += 1;
  user.inventory.push({ ...winner, wonAt: Date.now() });

  // Сохраняем дроп в глобальную ленту
  addDrop(user.username, winner);

  saveDB();

  res.json({
    winner,
    user: {
      id: user.id,
      username: user.username,
      balance: user.balance,
      wins: user.wins,
      spins: user.spins,
      inventory: user.inventory
    }
  });
});

app.post('/api/promo', (req, res) => {
  const { id, username, code } = req.body;
  if (!id || !code) {
    return res.status(400).json({ error: 'Неверный запрос' });
  }

  const user = getOrCreateUser(id, username);
  const promo = db.promo[code];

  if (!promo) {
    return res.status(400).json({ error: 'Промокод не найден' });
  }

  if (promo.used) {
    return res.status(400).json({ error: 'Промокод уже использован' });
  }

  // Активируем
  promo.used = true;
  user.balance += promo.reward || 25;
  saveDB();

  res.json({
    message: `Промокод активирован! +${promo.reward || 25} DEMO`,
    user: {
      id: user.id,
      username: user.username,
      balance: user.balance,
      wins: user.wins,
      spins: user.spins,
      inventory: user.inventory
    }
  });
});

// ===== WebSocket =====
const server = app.listen(port, () => {
  console.log(`✅ Сервер запущен на http://localhost:${port}`);
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  // При подключении отправляем последние дропы
  ws.send(JSON.stringify({
    type: 'drops',
    drops: db.drops.slice(0, 30)
  }));

  // Отправляем новые дропы всем подключённым клиентам
  const broadcast = (data) => {
    wss.clients.forEach(client => {
      if (client.readyState === 1) {
        client.send(JSON.stringify(data));
      }
    });
  };

  // Перехватываем добавление дропа через saveDB
  const originalSave = saveDB;
  saveDB = function() {
    originalSave();
    // Если добавился новый дроп — уведомляем
    if (db.drops.length > 0) {
      const last = db.drops[0];
      broadcast({
        type: 'drop',
        drop: last
      });
    }
  };

  ws.on('close', () => {
    // Восстанавливаем saveDB, если никто не подключён
    if (wss.clients.size === 0) {
      saveDB = originalSave;
    }
  });
});

console.log(`✅ WebSocket сервер запущен`);

// ===== Админка для просмотра базы =====
app.get('/admin', (req, res) => {
  res.json({
    users: Object.keys(db.users).length,
    drops: db.drops.length,
    promo: db.promo
  });
});

// ===== Сохраняем БД каждые 30 секунд на всякий случай =====
setInterval(saveDB, 30000);
