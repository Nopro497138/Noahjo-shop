// db-client.js
// Kleines CommonJS-Modul, das lowdb per dynamic import initialisiert und cached.
// So vermeidest du ERR_REQUIRE_ESM wenn lowdb ESM-only ist.

const fs = require('fs');
const path = require('path');

let _db = null;
let _dbFile = null;

async function init(dbFilePath) {
  if (_db && _dbFile === dbFilePath) return _db; // bereits init
  const DATA_DIR = path.dirname(dbFilePath);
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // dynamic import - vermeidet ERR_REQUIRE_ESM
  const lowdb = await import('lowdb');
  const lowdbNode = await import('lowdb/node');

  const { Low } = lowdb;
  const { JSONFile } = lowdbNode;

  const adapter = new JSONFile(dbFilePath);
  const db = new Low(adapter);
  await db.read();
  db.data ||= {
    users: [],
    products: [],
    reviews: [],
    orders: [],
    messages: []
  };

  // seed products wenn leer
  if (!db.data.products || db.data.products.length === 0) {
    db.data.products = [
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
    await db.write();
    console.log('Seeded products to', dbFilePath);
  }

  _db = db;
  _dbFile = dbFilePath;
  return _db;
}

function getDb() {
  if (!_db) throw new Error('DB not initialized. Call init(dbFilePath) first.');
  return _db;
}

module.exports = {
  init,
  getDb
};
