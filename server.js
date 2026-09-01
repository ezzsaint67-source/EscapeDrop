// server.js — глобальная система для Case Spinner (исправленная)
import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import fs from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Настройка CORS для Telegram
app.use(cors({
  origin: ['https://t.me', 'https://web.telegram.org', 'http://localhost:3000', 'https://*.onrender.com'],
  credentials: true
}));
app.use(express.json());

// Раздача статики
app.use(express.static('public'));

// ===== БАЗА ДАННЫХ =====
const DB_FILE = path.join(__dirname, 'server.json');

// Инициализация БД
let db = {
  users: {},
  drops: [],
  promo: {}
};

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf8');
      db = JSON.parse(data);
      console.log('✅ База данных загружена');
    } else {
      console.log('⚠️ Файл БД не найден, создан новый');
      initDB();
    }
  } catch (e) {
    console.error('❌ Ошибка загрузки БД:', e);
    initDB();
  }
  saveDB();
}

function initDB() {
  db = {
    users: {},
    drops: [],
    promo: {
      'DEMO2025': { reward: 25, used: false },
      'CASESPINNER': { reward: 50, used: false },
      'HELLO': { reward: 15, used: false },
      'TGSTART': { reward: 30, used: false },
      'WELCOME': { reward: 20, used: false }
    }
  };
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) {
    console.error('❌ Ошибка сохранения БД:', e);
  }
}

loadDB();

// ===== ВСПОМОГАТЕЛЬНЫЕ =====
function getOrCreateUser(id, username) {
  if (!id) {
    id = randomUUID();
  }
  
  if (!db.users[id]) {
    const displayName = username || 'user_' + id.slice(0, 6);
    db.users[id] = {
      id: id,
      username: displayName,
      balance: 100,
      wins: 0,
      spins: 0,
      inventory: [],
      createdAt: Date.now()
    };
    saveDB();
    console.log(`👤 Новый пользователь: ${displayName} (${id})`);
  }
  
  // Обновляем username, если изменился
  if (username && db.users[id].username !== username) {
    db.users[id].username = username;
    saveDB();
  }
  
  return db.users[id];
}

function addDrop(username, item) {
  db.drops.unshift({
    username: username,
    item: item,
    timestamp: Date.now()
  });
  // Оставляем только последние 200 дропов
  if (db.drops.length > 200) {
    db.drops.length = 200;
  }
  saveDB();
}

function getWeighted(items) {
  const valid = items.filter(x => x.chance > 0);
  if (valid.length === 0) return items[0];
  
  let r = Math.random() * 100;
  for (const item of valid) {
    if (r < item.chance) return item;
    r -= item.chance;
  }
  return valid[valid.length - 1];
}

// ===== ДАННЫЕ КЕЙСОВ =====
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
  try {
    const id = req.query.id || randomUUID();
    const username = req.query.username || 'user';
    const user = getOrCreateUser(id, username);
    const recent = db.drops.slice(0, 50);
    
    res.json({
      user: {
        id: user.id,
        username: user.username,
        balance: user.balance,
        wins: user.wins,
        spins: user.spins,
        inventory: user.inventory
      },
      drops: recent
    });
  } catch (e) {
    console.error('❌ Ошибка в /api/state:', e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/spin', (req, res) => {
  try {
    const { id, username, caseName } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'ID пользователя обязателен' });
    }
    
    if (!caseName) {
      return res.status(400).json({ error: 'Название кейса обязательно' });
    }

    const user = getOrCreateUser(id, username);
    const caseData = CASE_DATA[caseName];
    
    if (!caseData) {
      return res.status(400).json({ error: 'Кейс не найден' });
    }

    if (user.balance < caseData.cost) {
      return res.status(400).json({ error: 'Недостаточно DEMO' });
    }

    // Выбираем победителя
    const winner = getWeighted(caseData.items);
    
    // Обновляем баланс и статистику
    user.balance -= caseData.cost;
    user.spins += 1;
    user.wins += 1;
    user.inventory.push({ 
      ...winner, 
      wonAt: Date.now() 
    });

    // Добавляем в глобальные дропы
    addDrop(user.username, winner);
    
    // Сохраняем
    saveDB();

    // Отправляем ответ
    res.json({
      winner: winner,
      user: {
        id: user.id,
        username: user.username,
        balance: user.balance,
        wins: user.wins,
        spins: user.spins,
        inventory: user.inventory
      }
    });
    
    console.log(`🎰 Спин: ${user.username} выиграл ${winner.name}`);
    
  } catch (e) {
    console.error('❌ Ошибка в /api/spin:', e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

app.post('/api/promo', (req, res) => {
  try {
    const { id, username, code } = req.body;
    
    if (!id || !code) {
      return res.status(400).json({ error: 'Неверный запрос' });
    }

    const user = getOrCreateUser(id, username);
    const promo = db.promo[code.toUpperCase()];

    if (!promo) {
      return res.status(400).json({ error: 'Промокод не найден' });
    }

    if (promo.used) {
      return res.status(400).json({ error: 'Промокод уже использован' });
    }

    // Активируем промокод
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
    
    console.log(`🎁 Промокод ${code} активирован пользователем ${user.username}`);
    
  } catch (e) {
    console.error('❌ Ошибка в /api/promo:', e);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// ===== WebSocket =====
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`✅ Сервер запущен на порту ${port}`);
});

const wss = new WebSocketServer({ 
  server,
  path: '/ws'
});

// Храним всех клиентов
const clients = new Set();

wss.on('connection', (ws) => {
  console.log('🔗 Новое WebSocket подключение');
  clients.add(ws);
  
  // Отправляем последние дропы при подключении
  try {
    ws.send(JSON.stringify({
      type: 'drops',
      drops: db.drops.slice(0, 30)
    }));
  } catch (e) {
    console.error('❌ Ошибка отправки дропов:', e);
  }

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      // Игнорируем невалидные сообщения
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('🔌 WebSocket отключён');
  });
});

// Функция для широковещательной рассылки
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      try {
        client.send(message);
      } catch (e) {
        // Игнорируем ошибки отправки
      }
    }
  });
}

// Перехватываем добавление дропа для отправки через WebSocket
const originalAddDrop = addDrop;
addDrop = function(username, item) {
  originalAddDrop(username, item);
  
  // Отправляем новый дроп всем подключённым клиентам
  if (db.drops.length > 0) {
    broadcast({
      type: 'drop',
      drop: db.drops[0]
    });
  }
};

// ===== Health check для Render =====
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    users: Object.keys(db.users).length,
    drops: db.drops.length
  });
});

// ===== Админка =====
app.get('/admin', (req, res) => {
  res.json({
    users: Object.keys(db.users).length,
    drops: db.drops.length,
    promo: db.promo,
    clients: clients.size
  });
});

// Сохраняем БД каждые 30 секунд
setInterval(saveDB, 30000);

console.log('🚀 Сервер готов к работе!');
