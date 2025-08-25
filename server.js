/* server.js - Noahjo shop (lowdb entfernt, simples file-basiertes JSON-DB ersetzt es)
   - Kein lowdb / kein ESM mehr -> sollte auf Railway ohne ERR_REQUIRE_ESM laufen.
   - /webhook uses express.raw BEFORE express.json
   - serves ./public with SPA fallback
*/

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http');

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this';
const PORT = process.env.PORT || 3001;
const DB_FILE = process.env.DATABASE_FILE || path.join(__dirname, 'data', 'db.json');

let stripe = null;
if (STRIPE_SECRET_KEY) stripe = require('stripe')(STRIPE_SECRET_KEY);

/* ---------- small safe id generator (no external deps) ---------- */
function generateId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/* ---------- simple file-based JSON DB wrapper (replacement for lowdb) ---------- */
/* Usage in code remains the same: await db.read(); ... db.data ... await db.write(); */
const db = {
  filePath: DB_FILE,
  data: null,

  async _ensureDir() {
    const dir = path.dirname(this.filePath);
    try {
      await fs.promises.mkdir(dir, { recursive: true });
    } catch (e) {
      // ignore
    }
  },

  async read() {
    await this._ensureDir();
    try {
      const txt = await fs.promises.readFile(this.filePath, 'utf8');
      this.data = JSON.parse(txt);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // file missing -> initialize structure
        this.data = {
          users: [],
          products: [],
          reviews: [],
          orders: [],
          messages: []
        };
        // write seeds below if needed
      } else {
        // rethrow other errors
        throw err;
      }
    }

    // ensure keys exist
    this.data ||= {};
    this.data.users ||= [];
    this.data.products ||= [];
    this.data.reviews ||= [];
    this.data.orders ||= [];
    this.data.messages ||= [];

    // seed products if empty
    if (!this.data.products || this.data.products.length === 0) {
      this.data.products = [
        {
          id: 'prod-1',
          title: 'Nebula Headset',
          category: 'Accessories',
          price: 79.99,
          short_desc: 'Wireless gaming headset with spatial audio and nebula lighting.',
          long_desc: 'Immersive over-ear headset built for long sessions. 50mm drivers, low-latency wireless mode, breathable memory-foam cushions and subtle nebula RGB.',
          images: ['/images/headset-1.jpg','/images/headset-2.jpg']
        },
        {
          id: 'prod-2',
          title: 'Void Runner Hoodie',
          category: 'Apparel',
          price: 49.99,
          short_desc: 'Comfort-fit hoodie with glow-in-dark print.',
          long_desc: 'Premium cotton-blend hoodie featuring reflective galaxy print.',
          images: ['/images/hoodie-1.jpg']
        },
        {
          id: 'prod-3',
          title: 'Meteor Grip',
          category: 'Accessories',
          price: 12.99,
          short_desc: 'Tactical phone grip inspired by meteor textures.',
          long_desc: 'Slim profile grip with anti-slip texture.',
          images: ['/images/grip-1.jpg']
        }
      ];
      // we'll write below (caller should call write if they want it persisted immediately)
    }
  },

  async write() {
    await this._ensureDir();
    const tmp = this.filePath + '.tmp';
    const dataStr = JSON.stringify(this.data || {}, null, 2);
    // atomic write: write tmp then rename
    await fs.promises.writeFile(tmp, dataStr, 'utf8');
    await fs.promises.rename(tmp, this.filePath);
  }
};

/* ---------- bootstrap (init or run) ---------- */
(async () => {
  try {
    const isInitOnly = process.argv.includes('--init-db');

    // Initialize DB (read or create + seed in-memory)
    await db.read();
    // persist seeded data if file was missing or products seeded
    await db.write();

    if (isInitOnly) {
      console.log('DB init complete (init-only).');
      process.exit(0);
    }

    /* ---------- express app ---------- */
    const app = express();
    app.use(cors());

    /* webhook must be raw before express.json */
    app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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

        await db.read();
        const exists = db.data.orders.find(o => o.stripe_session_id === stripeSessionId);
        if (!exists) {
          const newOrder = {
            id: generateId(),
            stripe_session_id: stripeSessionId,
            user_id: userId,
            user_email: customer_email,
            amount_total,
            currency,
            status: 'paid',
            created_at: new Date().toISOString()
          };
          db.data.orders.push(newOrder);
          await db.write();
          try { if (typeof io !== 'undefined' && io) io.to('admins').emit('order:created', newOrder); } catch(e){}
        }
      }

      res.json({ received: true });
    });

    /* parse JSON for other routes */
    app.use(express.json());

    /* static frontend */
    const publicPath = path.join(__dirname, 'public');
    app.use('/images', express.static(path.join(publicPath, 'images')));
    app.use(express.static(publicPath));

    /* helper: sign token */
    function signToken(user) {
      const payload = { id: user.id, email: user.email, is_admin: !!user.is_admin };
      return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
    }

    /* auth middleware */
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

    /* ---------- API routes (file-backed DB) ---------- */

    // Register
    app.post('/api/auth/register', async (req, res) => {
      const { email, password, makeAdmin } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      await db.read();
      const exists = db.data.users.find(u => u.email === email.toLowerCase());
      if (exists) return res.status(400).json({ error: 'Email already in use' });
      const pwHash = await bcrypt.hash(password, 10);
      const newUser = { id: Number(Date.now()), email: email.toLowerCase(), password_hash: pwHash, is_admin: makeAdmin ? 1 : 0, created_at: new Date().toISOString() };
      db.data.users.push(newUser);
      await db.write();
      const token = signToken(newUser);
      res.json({ token, user: { id: newUser.id, email: newUser.email, is_admin: !!newUser.is_admin } });
    });

    // Login
    app.post('/api/auth/login', async (req, res) => {
      const { email, password } = req.body;
      if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
      await db.read();
      const row = db.data.users.find(u => u.email === email.toLowerCase());
      if (!row) return res.status(400).json({ error: 'Invalid credentials' });
      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
      const token = signToken(row);
      res.json({ token, user: { id: row.id, email: row.email, is_admin: !!row.is_admin } });
    });

    // Products
    app.get('/api/products', async (req, res) => {
      await db.read();
      res.json(db.data.products || []);
    });

    // Reviews get
    app.get('/api/products/:id/reviews', async (req, res) => {
      const productId = req.params.id;
      await db.read();
      const rows = db.data.reviews.filter(r => r.product_id === productId).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
      res.json(rows);
    });

    // Reviews post
    app.post('/api/products/:id/reviews', authenticate, async (req, res) => {
      const productId = req.params.id;
      const { rating, text } = req.body;
      const userId = req.user.id;
      const userEmail = req.user.email;
      if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating 1-5 required' });

      await db.read();
      const exist = db.data.reviews.find(r => r.product_id === productId && r.author_id === userId);
      if (exist) return res.status(400).json({ error: 'You already reviewed this product' });

      const newReview = { id: generateId(), product_id: productId, author_id: userId, author_email: userEmail, rating, text: text || null, created_at: new Date().toISOString() };
      db.data.reviews.push(newReview);
      await db.write();
      res.json(newReview);
    });

    // Delete review
    app.delete('/api/reviews/:id', authenticate, async (req, res) => {
      const id = req.params.id;
      const userId = req.user.id;
      const isAdmin = !!req.user.is_admin;
      await db.read();
      const row = db.data.reviews.find(r => r.id === id);
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (row.author_id !== userId && !isAdmin) return res.status(403).json({ error: 'Not authorized' });
      db.data.reviews = db.data.reviews.filter(r => r.id !== id);
      await db.write();
      res.json({ ok: true });
    });

    // Make admin (dev only)
    app.post('/api/make-admin', authenticate, async (req, res) => {
      const targetEmail = req.body.email;
      if (!req.user.is_admin) return res.status(403).json({ error: 'Only admins' });
      await db.read();
      const user = db.data.users.find(u => u.email === targetEmail.toLowerCase());
      if (!user) return res.status(404).json({ error: 'User not found' });
      user.is_admin = 1;
      await db.write();
      res.json({ ok: true });
    });

    // Checkout (Stripe)
    app.post('/api/create-checkout-session', authenticate, async (req, res) => {
      if (!stripe) return res.status(500).json({ error: 'Stripe not configured. Set STRIPE_SECRET_KEY in env.' });
      const items = req.body.items;
      if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No items' });

      const line_items = items.map(it => ({
        price_data: {
          currency: 'usd',
          product_data: { name: it.title },
          unit_amount: Math.round(it.price * 100)
        },
        quantity: it.qty || 1
      }));

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items,
          mode: 'payment',
          success_url: (process.env.APP_URL || 'http://localhost:3000') + '/success?session_id={CHECKOUT_SESSION_ID}',
          cancel_url: (process.env.APP_URL || 'http://localhost:3000') + '/cancel',
          metadata: { user_id: req.user.id }
        });
        res.json({ url: session.url });
      } catch (err) {
        console.error('stripe', err);
        res.status(500).json({ error: 'Stripe error' });
      }
    });

    // Orders endpoints
    app.get('/api/orders/mine', authenticate, async (req, res) => {
      await db.read();
      const rows = db.data.orders.filter(o => o.user_id === req.user.id).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at));
      res.json(rows);
    });

    app.get('/api/orders', authenticate, async (req, res) => {
      if (!req.user.is_admin) return res.status(403).json({ error: 'Only admins' });
      await db.read();
      res.json(db.data.orders.sort((a,b)=> new Date(b.created_at)-new Date(a.created_at)));
    });

    app.get('/api/orders/by-session/:session', async (req, res) => {
      const s = req.params.session;
      await db.read();
      const row = db.data.orders.find(o => o.stripe_session_id === s);
      if (!row) return res.status(404).json({ error: 'Not found' });
      res.json(row);
    });

    // Messages for an order
    app.get('/api/orders/:id/messages', authenticate, async (req, res) => {
      const orderId = req.params.id;
      await db.read();
      const order = db.data.orders.find(o => o.id === orderId || String(o.id) === String(orderId));
      if (!order) return res.status(404).json({ error: 'Order not found' });
      if (order.user_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ error: 'Not authorized' });
      const rows = db.data.messages.filter(m => m.order_id === orderId).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
      res.json(rows);
    });

    /* SPA fallback: return index.html for non-API GETs */
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      const indexFile = path.join(publicPath, 'index.html');
      if (fs.existsSync(indexFile)) return res.sendFile(indexFile);
      return res.status(404).send('index.html not found on server. Place your frontend in /public');
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

      socket.on('joinOrder', async (orderId, cb) => {
        try {
          await db.read();
          const order = db.data.orders.find(o => o.id === orderId || String(o.id) === String(orderId));
          if (!order) return cb && cb({ error: 'Order not found' });
          if (order.user_id !== user.id && !user.is_admin) return cb && cb({ error: 'Not authorized' });
          const room = `order:${orderId}`;
          socket.join(room);
          const messages = db.data.messages.filter(m => m.order_id === orderId).sort((a,b)=> new Date(a.created_at)-new Date(b.created_at));
          cb && cb({ ok: true, messages });
        } catch (err) { cb && cb({ error: 'Server error' }); }
      });

      socket.on('message', async (payload, cb) => {
        try {
          const { orderId, text } = payload;
          await db.read();
          const order = db.data.orders.find(o => o.id === orderId || String(o.id) === String(orderId));
          if (!order) return cb && cb({ error: 'Order not found' });
          if (order.user_id !== socket.user.id && !socket.user.is_admin) return cb && cb({ error: 'Not authorized' });
          const sender_role = socket.user.is_admin ? 'admin' : 'user';
          const msg = { id: generateId(), order_id: orderId, sender_id: socket.user.id, sender_role, text, created_at: new Date().toISOString() };
          db.data.messages.push(msg);
          await db.write();
          const room = `order:${orderId}`;
          io.to(room).emit('message', msg);
          cb && cb({ ok: true, msg });
        } catch (err) {
          console.error('socket message error', err);
          cb && cb({ error: 'Server error' });
        }
      });
    });

    server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
  } catch (err) {
    console.error('Fatal startup error', err);
    process.exit(1);
  }
})();
