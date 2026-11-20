const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database('wms.db');

// Tabel Users
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'staff',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Tabel Barang (DENGAN KOLOM HPP)
db.exec(`
  CREATE TABLE IF NOT EXISTS barang (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku TEXT UNIQUE NOT NULL,
    artikel TEXT NOT NULL,
    kategori TEXT,
    size TEXT,
    stok INTEGER DEFAULT 0,
    hpp INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Tabel Transaksi
db.exec(`
  CREATE TABLE IF NOT EXISTS transaksi (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barang_id INTEGER NOT NULL,
    tipe TEXT NOT NULL, 
    sub_tipe TEXT,
    jumlah INTEGER NOT NULL,
    keterangan TEXT,
    user_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (barang_id) REFERENCES barang(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Tabel Log Aktivitas
db.exec(`
  CREATE TABLE IF NOT EXISTS log_aktivitas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    aksi TEXT,
    keterangan TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Kolom penanda Pengiriman Kilat (barang keluar Shopee via kilat)
if (!db.prepare('PRAGMA table_info(transaksi)').all().some(c => c.name === 'kilat')) {
  db.exec('ALTER TABLE transaksi ADD COLUMN kilat INTEGER DEFAULT 0');
}

// Tabel Rincian (vendor, marketplace, alasan return, reseller, affiliate) - bisa diubah lewat MODE DEVELOPER
db.exec(`
  CREATE TABLE IF NOT EXISTS rincian (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    grup TEXT NOT NULL,
    nama TEXT NOT NULL,
    urutan INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (grup, nama)
  )
`);

// Penanda migrasi satu kali (supaya data yang sudah dihapus tidak muncul lagi saat server restart)
db.exec('CREATE TABLE IF NOT EXISTS migrasi (kunci TEXT PRIMARY KEY, waktu DATETIME DEFAULT CURRENT_TIMESTAMP)');
const sudahMigrasi = k => !!db.prepare('SELECT 1 FROM migrasi WHERE kunci = ?').get(k);
const tandaiMigrasi = k => db.prepare('INSERT OR IGNORE INTO migrasi (kunci) VALUES (?)').run(k);

if (!sudahMigrasi('seed_rincian_v1')) {
  const awal = {
    'masuk': ['VENDOR OYOD', 'VENDOR AEP', 'VENDOR IIP', 'VENDOR UPEP', 'VENDOR DENI', 'VENDOR YASIR', 'VENDOR TAUFIQ', 'VENDOR OPI', 'VENDOR YUDI', 'VENDOR FEBRY'],
    'return-masuk': ['GAGAL COD', 'PENGEMBALIAN', 'TUKAR SIZE', 'SALAH STICKER', 'PERBAIKAN VENDOR', 'PEMBATALAN'],
    'keluar': ['SHOPEE', 'TIKTOK', 'LAZADA', 'OFFLINE/WA', 'WEBSITE'],
    'return-keluar': ['PERBAIKAN VENDOR', 'TUKAR SIZE', 'SALAH SIZE'],
    'affiliate': [],
    'reseller': ['JYF STAR', 'ARADA', 'TRAGEN']
  };
  const ins = db.prepare('INSERT OR IGNORE INTO rincian (grup, nama, urutan) VALUES (?, ?, ?)');
  db.transaction(() => {
    Object.entries(awal).forEach(([grup, daftar]) => daftar.forEach((nama, i) => ins.run(grup, nama, i + 1)));
    tandaiMigrasi('seed_rincian_v1');
  })();
}

// Hapus akun user zahra (sekali saja). Riwayat transaksi/log lama tetap ada, hanya tidak terhubung ke akun.
if (!sudahMigrasi('hapus_user_zahra_v1')) {
  db.transaction(() => {
    const z = db.prepare("SELECT id FROM users WHERE username = 'zahra'").get();
    if (z) {
      db.prepare('UPDATE transaksi SET user_id = NULL WHERE user_id = ?').run(z.id);
      db.prepare('UPDATE log_aktivitas SET user_id = NULL WHERE user_id = ?').run(z.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(z.id);
    }
    tandaiMigrasi('hapus_user_zahra_v1');
  })();
}

// Seed User Bawaan
const users = ['firman', 'ikbal', 'tedi', 'siti'];
const defaultPassword = 'jyfteam';
const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)');

users.forEach(u => {
  const hash = bcrypt.hashSync(defaultPassword, 10);
  const role = u === 'firman' ? 'admin' : 'staff';
  insertUser.run(u, hash, role);
});

console.log('✅ Database siap & user default dibuat');
module.exports = db;