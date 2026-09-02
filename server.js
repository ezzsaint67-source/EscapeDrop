const express = require("express");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 10000;
const HOST = "0.0.0.0";

app.use(express.json());
app.use(express.static(__dirname));

const wss = new WebSocket.Server({
  server,
  path: "/ws"
});

// =========================
// CASES
// =========================

const cases = {
  Secret: {
    name: "Secret",
    cost: 10,
    items: [
      { name: "Golden Mask", chance: 67 },
      { name: "Candy Dominus", chance: 23 },
      { name: "Canada", chance: 10 }
    ]
  },

  Common: {
    name: "Common",
    cost: 5,
    items: [
      { name: "Candy Crown", chance: 90 },
      { name: "Shell Crown", chance: 10 }
    ]
  }
};

// =========================
// PROMO CODES
// =========================

const promoCodes = {
  WELCOME: 25,
  CASE2026: 50,
  BONUS: 100
};

// =========================
// DATA
// =========================

const users = new Map();
const drops = [];

const MAX_DROPS = 100;

// =========================
// USER
// =========================

function getUser(id, username = "User") {
  if (!users.has(id)) {
    users.set(id, {
      id,
      username,
      balance: 100,
      wins: 0,
      spins: 0,
      inventory: [],
      usedPromos: []
    });
  }

  const user = users.get(id);

  if (username && username !== "User") {
    user.username = username;
  }

  return user;
}

// =========================
// RANDOM ITEM
// =========================

function getWinner(caseName) {
  const box = cases[caseName];

  if (!box) {
    return null;
  }

  const random = Math.random() * 100;

  let current = 0;

  for (const item of box.items) {
    current += item.chance;

    if (random <= current) {
      return item;
    }
  }

  return box.items[box.items.length - 1];
}

// =========================
// BROADCAST
// =========================

function broadcast(data) {
  const message = JSON.stringify(data);

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// =========================
// STATE
// =========================

app.get("/api/state", (req, res) => {
  const id = req.query.id || crypto.randomUUID();
  const username = req.query.username || "User";

  const user = getUser(id, username);

  res.json({
    user,
    drops: drops.slice(-30).reverse()
  });
});

// =========================
// SPIN
// =========================

app.post("/api/spin", (req, res) => {
  try {
    const {
      id,
      username,
      caseName
    } = req.body;

    if (!id) {
      return res.status(400).json({
        error: "User ID is required"
      });
    }

    if (!cases[caseName]) {
      return res.status(400).json({
        error: "Case does not exist"
      });
    }

    const user = getUser(id, username);
    const selectedCase = cases[caseName];

    if (user.balance < selectedCase.cost) {
      return res.status(400).json({
        error: "Not enough DEMO"
      });
    }

    // Снимаем стоимость кейса
    user.balance -= selectedCase.cost;

    // Выбираем предмет
    const winner = getWinner(caseName);

    // Статистика
    user.spins++;
    user.wins++;

    // Добавляем предмет в инвентарь
    user.inventory.push({
      name: winner.name,
      caseName,
      time: Date.now()
    });

    // Создаём запись о выпадении
    const drop = {
      id: crypto.randomUUID(),
      username: user.username,
      item: winner.name,
      caseName,
      time: Date.now()
    };

    drops.push(drop);

    if (drops.length > MAX_DROPS) {
      drops.shift();
    }

    // Отправляем всем пользователям
    broadcast({
      type: "drop",
      drop
    });

    broadcast({
      type: "drops",
      drops: drops.slice(-30).reverse()
    });

    res.json({
      success: true,
      user,
      winner
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// =========================
// PROMO
// =========================

app.post("/api/promo", (req, res) => {
  try {
    const {
      id,
      username,
      code
    } = req.body;

    if (!id) {
      return res.status(400).json({
        error: "User ID is required"
      });
    }

    const user = getUser(id, username);

    const promo = String(code || "")
      .trim()
      .toUpperCase();

    if (!promoCodes[promo]) {
      return res.status(400).json({
        error: "Promo code not found"
      });
    }

    if (user.usedPromos.includes(promo)) {
      return res.status(400).json({
        error: "Promo already used"
      });
    }

    const amount = promoCodes[promo];

    user.balance += amount;
    user.usedPromos.push(promo);

    res.json({
      success: true,
      amount,
      user
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Server error"
    });
  }
});

// =========================
// WEBSOCKET
// =========================

wss.on("connection", socket => {
  console.log("WebSocket connected");

  socket.send(JSON.stringify({
    type: "drops",
    drops: drops.slice(-30).reverse()
  }));

  socket.on("close", () => {
    console.log("WebSocket disconnected");
  });
});

// =========================
// HEALTH CHECK
// =========================

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok"
  });
});

// =========================
// FRONTEND
// =========================

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// =========================
// START
// =========================

server.listen(PORT, HOST, () => {
  console.log(`EscapeDrop server started on port ${PORT}`);
});
