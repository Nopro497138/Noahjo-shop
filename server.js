/* server.js - Express server with DB init, Stripe webhook, static serve + SPA fallback */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this';
const PORT = process.env.PORT || 3001;
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'db.sqlite');

let stripe = null;
if (STRIPE_SECRET_KEY) {
  stripe = require('stripe')(STRIPE_SECRET_KEY);
}

/* ---------- DB Init (auto) ---------- */
function initDbIfMissing(dbFilePath) {
  const DATA_DIR = path.dirname(dbFilePath);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (fs.existsSync(dbFilePath)) {
    console.log('Database file exists:', dbFilePath);
    return;
  }

  console.log('Creating database and seeding data at', dbFilePath);
  const db = new Database(dbFilePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.exec(`
    CREATE TABLE products (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      category TEXT,
      price REAL NOT NULL,
      short_desc TEXT,
      long_desc TEXT,
      images TEXT DEFAULT '[]'
    );
  `);

  db.exec(`
    CREATE TABLE reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id TEXT NOT NULL,
      author_id INTEGER NOT NULL,
      author_email TEXT,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (author_id) REFERENCES users(id)
    );
  `);
  db.exec(`CREATE UNIQUE INDEX idx_one_review_per_user ON reviews(product_id, author_id);`);

  db.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_session_id TEXT UNIQUE,
      user_id INTEGER,
      user_email TEXT,
      amount_total INTEGER,
      currency TEXT,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  db.exec(`
    CREATE TABLE messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      sender_id INTEGER,
      sender_role TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    );
  `);

  const products = [
    {
      id: 'prod-1', title: 'Nebula Headset', category: 'Accessories', price: 79.99,
      short_desc: 'Wireless gaming headset with spatial audio and nebula lighting.',
      long_desc: 'Immersive over-ear headset built for long sessions. 50mm drivers, low-latency wireless mode, breathable memory-foam cushions and subtle nebula RGB.',
      images: JSON.stringify(['/images/headset-1.jpg','/images/headset-2.jpg'])
    },
    {
      id: 'prod-2', title: 'Void Runner Hoodie', category: 'Apparel', price: 49.99,
      short_desc: 'Comfort-fit hoodie with glow-in-dark print.',
      long_desc: 'Premium cotton-blend hoodie featuring reflective galaxy print.',
      images: JSON.stringify(['/images/hoodie-1.jpg'])
    },
    {
      id: 'prod-3', title: 'Meteor Grip', category: 'Accessories', price: 12.99,
      short_desc: 'Tactical phone grip inspired by meteor textures.',
      long_desc: 'Slim profile grip with anti-slip texture.',
      images: JSON.stringify(['/images/grip-1.jpg'])
    }
  ];

  const insert = db.prepare('INSERT INTO products (id,title,category,price,short_desc,long_desc,images) VALUES (@id,@title,@category,@price,@short_desc,@long_desc,@images)');
  const insertMany = db.transaction((rows) => { for (const r of rows) insert.run(r); });
  insertMany(products);

  db.close();
  console.log('DB created and seeded.');
}

/* support --init-db */
if (process.argv.includes('--init-db')) {
  initDbIfMissing(DB_FILE);
  console.log('Init finished. Exiting.');
  process.exit(0);
}

initDbIfMissing(DB_FILE);

/* open DB */
const db = new Database(DB_FILE, { readonly: false });
db.pragma('foreign_keys = ON');

/* express app */
const app = express();
app.use(cors());

/* Serve /webhook raw BEFORE express.json */
app.post('/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe) return res.status(400).send('Stripe not configured');
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err && err.message ? err.message : err);
    return res.status(400).send(`Webhook Error: ${err && err.message ? err.message : err}`);
  }

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const session = event.data.object;
    const stripeSessionId = session.id;
    const userId = session.metadata && session.metadata.user_id ? Number(session.metadata.user_id) : null;
    const amount_total = session.amount_total || null;
    const currency = session.currency || null;
    const customer_email = session.customer_details ? session.customer_details.email : (session.customer_email || null);

    try {
      const exists = db.prepare('SELECT id FROM orders WHERE stripe_session_id = ?').get(stripeSessionId);
      if (!exists) {
        const insert = db.prepare('INSERT INTO orders (stripe_session_id, user_id, user_email, amount_total, currency, status) VALUES (?, ?, ?, ?, ?, ?)');
        const info = insert.run(stripeSessionId, userId, customer_email, amount_total, currency, 'paid');
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
        try { if (typeof io !== 'undefined' && io) io.to('admins').emit('order:created', order); } catch (e) { }
      }
    } catch (e) {
      console.error('Error inserting order from webhook', e);
    }
  }

  res.json({ received: true });
});

/* parse JSON for other routes */
app.use(express.json());

/* --------- Static frontend serving (public) and SPA fallback --------- */
const publicPath = path.join(__dirname, 'public');
// Serve static assets (index.html, css, js, images, ...)
app.use(express.static(publicPath));

// If a GET request prefers HTML and didn't match a static file, return index.html (SPA fallback)
app.get('*', (req, res, next) => {
  if (req.method !== 'GET' || !req.accepts('html')) return next();
  const indexFile = path.join(publicPath, 'index.html');
  if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
  return res.status(404).send('index.html not found on server. Place your frontend in /public');
});

/* ---------- Helper functions & minimal API ---------- */
function signToken(user) {
  const payload = { id: user.id, email: user.email, is_admin: !!user.is_admin };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function authenticate(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing auth' });
  const token = auth.split(' ')[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/* Minimal API endpoints (you can expand these) */
app.get('/api/ping', (req, res) => res.json({ ok: true }));
app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT id,title,category,price,short_desc,long_desc,images FROM products').all();
  const parsed = rows.map(r => ({ ...r, images: JSON.parse(r.images || '[]') }));
  res.json(parsed);
});

/* ---------- HTTP server + socket.io ---------- */
const server = http.createServer(app);
const { Server } = require('socket.io');
const io = new Server(server, { cors: { origin: '*' } });

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (e) {
    return next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  const user = socket.user;
  if (user.is_admin) socket.join('admins');

  socket.on('joinOrder', (orderId, cb) => {
    try {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) return cb && cb({ error: 'Order not found' });
      if (order.user_id !== user.id && !user.is_admin) return cb && cb({ error: 'Not authorized' });
      const room = `order:${orderId}`;
      socket.join(room);
      const messages = db.prepare('SELECT * FROM messages WHERE order_id = ? ORDER BY created_at ASC').all(orderId);
      cb && cb({ ok: true, messages });
    } catch (err) {
      cb && cb({ error: 'Server error' });
    }
  });

  socket.on('message', (payload, cb) => {
    try {
      const { orderId, text } = payload;
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) return cb && cb({ error: 'Order not found' });
      if (order.user_id !== user.id && !user.is_admin) return cb && cb({ error: 'Not authorized' });
      const sender_role = user.is_admin ? 'admin' : 'user';
      const insert = db.prepare('INSERT INTO messages (order_id, sender_id, sender_role, text) VALUES (?, ?, ?, ?)');
      const info = insert.run(orderId, user.id, sender_role, text);
      const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
      const room = `order:${orderId}`;
      io.to(room).emit('message', msg);
      cb && cb({ ok: true, msg });
    } catch (err) {
      console.error('socket message error', err);
      cb && cb({ error: 'Server error' });
    }
  });
});

/* ---------- Start server ---------- */
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
