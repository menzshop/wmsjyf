const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const xlsx = require('xlsx');
const db = require('./database');
const { KONFIG, kolomTemplate, prosesTransaksiExcel } = require('./transaksi-excel');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json());
app.use(express.static('../frontend'));
const upload = multer({ dest: 'uploads/' });
const uploadMemori = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ============ AUTH ============
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username?.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ success: false, message: 'Username atau password salah' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
});

// 4 role: developer (semua fitur), admin (semua kecuali Mode Developer & Kelola Akun),
// staff (scan + riwayat scan + Reports), demo (hanya lihat).
const ROLE_VALID = ['developer', 'admin', 'staff', 'demo'];

function authMiddleware(req, res, next) {
  let token;
  try {
    token = jwt.verify(req.headers.authorization?.split(' ')[1], JWT_SECRET);
  } catch (err) { return res.status(401).json({ success: false, message: 'Token invalid' }); }
  // Role dibaca dari database (bukan dari isi token), jadi perubahan role langsung berlaku
  // dan akun yang sudah dihapus tidak bisa lagi memakai token lamanya.
  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(token.id);
  if (!user) return res.status(401).json({ success: false, message: 'Akun tidak ditemukan. Silakan login ulang.' });
  req.user = { id: user.id, username: user.username, role: user.role };
  // Demo hanya boleh melihat: semua permintaan selain GET ditolak di server.
  if (user.role === 'demo' && req.method !== 'GET') {
    return res.status(403).json({ success: false, message: 'Akun Demo hanya bisa melihat, tidak bisa mengubah data.' });
  }
  next();
}

function perluRole(...diizinkan) {
  return (req, res, next) => {
    if (!diizinkan.includes(req.user.role)) return res.status(403).json({ success: false, message: 'Akses ditolak. Role Anda tidak memiliki izin untuk fitur ini.' });
    next();
  };
}
// Developer + Admin (fitur admin biasa: stok, HPP satuan, tambah/hapus barang, upload SO, import, backup, Log Aktivitas)
const adminMiddleware = perluRole('developer', 'admin');
// Developer saja (Mode Developer: rincian, reset data, edit HPP massal; serta Kelola Akun)
const developerMiddleware = perluRole('developer');

// Data akun yang sedang login (role terbaru dari database) - dipakai frontend supaya perubahan role langsung terlihat
app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: { id: req.user.id, username: req.user.username, role: req.user.role } });
});

function catatLog(userId, username, aksi, keterangan) {
  try { db.prepare('INSERT INTO log_aktivitas (user_id, username, aksi, keterangan) VALUES (?, ?, ?, ?)').run(userId, username, aksi, keterangan); } 
  catch (err) { console.error("Gagal log:", err.message); }
}

// ============ BARANG ============
app.get('/api/barang', authMiddleware, (req, res) => {
  res.json({ success: true, data: db.prepare('SELECT * FROM barang ORDER BY artikel ASC').all() });
});
app.get('/api/barang/sku/:sku', authMiddleware, (req, res) => {
  const b = db.prepare('SELECT * FROM barang WHERE LOWER(sku) = LOWER(?)').get(decodeURIComponent(req.params.sku).trim());
  if (b) res.json({ success: true, data: b }); else res.status(404).json({ success: false });
});

app.put('/api/barang/:id/hpp', authMiddleware, adminMiddleware, (req, res) => {
  db.prepare('UPDATE barang SET hpp = ? WHERE id = ?').run(parseInt(req.body.hpp) || 0, req.params.id);
  res.json({ success: true });
});

// Edit HPP massal — developer saja. Hanya kolom HPP yang diubah; stok tidak pernah disentuh.
app.put('/api/barang-hpp-massal', authMiddleware, developerMiddleware, (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ success: false, message: 'Tidak ada perubahan HPP yang dikirim.' });
  if (items.length > 2000) return res.status(400).json({ success: false, message: 'Maksimal 2000 SKU per penyimpanan.' });

  const find = db.prepare('SELECT id, sku, hpp FROM barang WHERE LOWER(sku) = LOWER(?)');
  const update = db.prepare('UPDATE barang SET hpp = ? WHERE id = ?');
  const changes = [];
  const tidakDitemukan = [];
  const seen = new Set();

  for (const item of items) {
    const sku = String(item?.sku ?? '').trim();
    const hpp = Number(String(item?.hpp ?? '').replace(/[^0-9-]/g, ''));
    if (!sku || !Number.isInteger(hpp) || hpp < 0) continue;
    const key = sku.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const barang = find.get(sku);
    if (!barang) { tidakDitemukan.push(sku); continue; }
    if (Number(barang.hpp) !== hpp) changes.push({ id: barang.id, sku: barang.sku, sebelum: Number(barang.hpp) || 0, sesudah: hpp });
  }

  const simpan = db.transaction(() => {
    for (const c of changes) update.run(c.sesudah, c.id);
  });
  simpan();

  if (changes.length) {
    catatLog(req.user.id, req.user.username, 'EDIT HPP MASSAL', `Memperbarui HPP ${changes.length} SKU; tidak ditemukan ${tidakDitemukan.length}.`);
  }
  res.json({ success: true, updated: changes.length, notFound: tidakDitemukan, message: `HPP berhasil diperbarui: ${changes.length} SKU.` });
});

// Template Excel HPP massal — developer saja.
app.get('/api/barang-hpp-massal/template', authMiddleware, developerMiddleware, (req, res) => {
  const ws = xlsx.utils.aoa_to_sheet([['SKU', 'HPP'], ['CONTOH-SKU', 125000]]);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'HPP');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=template_hpp_massal.xlsx');
  res.send(buffer);
});

// Upload Excel HPP massal — format wajib: SKU, HPP. Stok tidak disentuh.
app.post('/api/barang-hpp-massal/excel', authMiddleware, developerMiddleware, uploadMemori.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'File Excel belum dipilih.' });
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });
    if (!rows.length) return res.status(400).json({ success: false, message: 'Excel kosong.' });

    const find = db.prepare('SELECT id, sku, hpp FROM barang WHERE LOWER(sku) = LOWER(?)');
    const update = db.prepare('UPDATE barang SET hpp = ? WHERE id = ?');
    const changes = [];
    const tidakDitemukan = [];
    const invalid = [];
    const seen = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const sku = String(row.SKU ?? row.sku ?? row['SKU (BARCODE)'] ?? '').trim();
      const rawHpp = row.HPP ?? row.hpp ?? '';
      const hpp = Number(String(rawHpp).replace(/[^0-9-]/g, ''));
      if (!sku || rawHpp === '' || !Number.isInteger(hpp) || hpp < 0) { invalid.push(i + 2); continue; }
      const key = sku.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const barang = find.get(sku);
      if (!barang) { tidakDitemukan.push(sku); continue; }
      if (Number(barang.hpp) !== hpp) changes.push({ id: barang.id, sku: barang.sku, sebelum: Number(barang.hpp) || 0, sesudah: hpp });
    }

    const simpan = db.transaction(() => {
      for (const c of changes) update.run(c.sesudah, c.id);
    });
    simpan();

    catatLog(req.user.id, req.user.username, 'UPLOAD HPP MASSAL', `Excel memperbarui ${changes.length} SKU; tidak ditemukan ${tidakDitemukan.length}; baris invalid ${invalid.length}.`);
    res.json({ success: true, updated: changes.length, notFound: tidakDitemukan, invalidRows: invalid, message: `Upload selesai: ${changes.length} SKU diperbarui.` });
  } catch (err) {
    console.error('Gagal membaca Excel HPP massal:', err);
    res.status(400).json({ success: false, message: 'File Excel tidak valid atau tidak bisa dibaca.' });
  }
});

app.put('/api/barang/:id/stok', authMiddleware, adminMiddleware, (req, res) => {
  db.prepare('UPDATE barang SET stok = ? WHERE id = ?').run(parseInt(req.body.stok_baru), req.params.id);
  res.json({ success: true });
});

app.post('/api/barang', authMiddleware, adminMiddleware, (req, res) => {
  const { sku, artikel, kategori, size, stok, hpp } = req.body;
  if (!sku || !artikel) return res.status(400).json({ success: false, message: 'SKU & Artikel wajib diisi' });
  try {
    db.prepare('INSERT INTO barang (sku, artikel, kategori, size, stok, hpp) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sku, artikel, kategori || '-', size || '-', parseInt(stok) || 0, parseInt(hpp) || 0);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ success: false, message: 'SKU sudah ada' }); }
});

app.delete('/api/barang/:id', authMiddleware, adminMiddleware, (req, res) => {
  const brg = db.prepare('SELECT sku FROM barang WHERE id = ?').get(req.params.id);
  catatLog(req.user.id, req.user.username, 'HAPUS BARANG', `Menghapus SKU: ${brg ? brg.sku : req.params.id}`);
  db.prepare('DELETE FROM transaksi WHERE barang_id = ?').run(req.params.id);
  db.prepare('DELETE FROM barang WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ============ MANAJEMEN USER ============
app.get('/api/users', authMiddleware, developerMiddleware, (req, res) => {
  res.json({ success: true, data: db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id ASC').all() });
});
app.post('/api/users', authMiddleware, developerMiddleware, (req, res) => {
  const { username, password } = req.body;
  const role = req.body.role || 'staff';
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username & Password wajib diisi' });
  if (!ROLE_VALID.includes(role)) return res.status(400).json({ success: false, message: 'Role tidak valid' });
  try {
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username.toLowerCase().trim(), bcrypt.hashSync(password, 10), role);
    catatLog(req.user.id, req.user.username, 'TAMBAH AKUN', `${username.toLowerCase().trim()} (${role})`);
    res.json({ success: true });
  } catch (err) { res.status(400).json({ success: false, message: 'Username sudah ada' }); }
});
// Ubah role dan/atau reset password akun lain (developer saja)
app.put('/api/users/:id', authMiddleware, developerMiddleware, (req, res) => {
  const target = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ success: false, message: 'Akun tidak ditemukan' });
  const { role, password } = req.body;
  if (role === undefined && !password) return res.status(400).json({ success: false, message: 'Tidak ada perubahan' });
  if (role !== undefined) {
    if (!ROLE_VALID.includes(role)) return res.status(400).json({ success: false, message: 'Role tidak valid' });
    if (target.id === req.user.id && role !== target.role) return res.status(400).json({ success: false, message: 'Tidak bisa mengubah role akun sendiri' });
  }
  if (password && String(password).length < 6) return res.status(400).json({ success: false, message: 'Password minimal 6 karakter' });
  db.transaction(() => {
    if (role !== undefined) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
    if (password) db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), target.id);
  })();
  const perubahan = [];
  if (role !== undefined && role !== target.role) perubahan.push(`role ${target.role} -> ${role}`);
  if (password) perubahan.push('reset password');
  catatLog(req.user.id, req.user.username, 'UBAH AKUN', `${target.username}: ${perubahan.join(', ') || 'tanpa perubahan'}`);
  res.json({ success: true });
});
app.delete('/api/users/:id', authMiddleware, developerMiddleware, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ success: false, message: 'Tidak bisa hapus akun sendiri' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/logs', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ success: true, data: db.prepare('SELECT * FROM log_aktivitas ORDER BY id DESC LIMIT 500').all() });
});

// ============ RINCIAN (VENDOR, MARKETPLACE, ALASAN RETURN, RESELLER, AFFILIATE) ============
const GRUP_RINCIAN = ['masuk', 'return-masuk', 'keluar', 'return-keluar', 'affiliate', 'reseller'];

function daftarRincian(grup) {
  return db.prepare('SELECT id, nama FROM rincian WHERE grup = ? ORDER BY urutan ASC, id ASC').all(grup);
}

function normalisasiNama(grup, nama) {
  let n = String(nama || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (grup === 'masuk' && n && !n.startsWith('VENDOR ')) n = 'VENDOR ' + n;
  return n;
}

app.get('/api/rincian', authMiddleware, (req, res) => {
  const data = {};
  GRUP_RINCIAN.forEach(g => { data[g] = daftarRincian(g); });
  res.json({ success: true, data });
});

app.post('/api/rincian', authMiddleware, developerMiddleware, (req, res) => {
  const grup = req.body.grup;
  if (!GRUP_RINCIAN.includes(grup)) return res.status(400).json({ success: false, message: 'Grup tidak valid' });
  const nama = normalisasiNama(grup, req.body.nama);
  if (!nama || nama === 'VENDOR') return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
  if (nama.length > 40) return res.status(400).json({ success: false, message: 'Nama maksimal 40 karakter' });
  const urutan = (db.prepare('SELECT MAX(urutan) as m FROM rincian WHERE grup = ?').get(grup).m || 0) + 1;
  try {
    db.prepare('INSERT INTO rincian (grup, nama, urutan) VALUES (?, ?, ?)').run(grup, nama, urutan);
  } catch (err) { return res.status(400).json({ success: false, message: 'Rincian sudah ada' }); }
  catatLog(req.user.id, req.user.username, 'TAMBAH RINCIAN', `${grup.toUpperCase()}: ${nama}`);
  res.json({ success: true });
});

app.put('/api/rincian/:id', authMiddleware, developerMiddleware, (req, res) => {
  const r = db.prepare('SELECT * FROM rincian WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ success: false, message: 'Rincian tidak ditemukan' });
  const nama = normalisasiNama(r.grup, req.body.nama);
  if (!nama || nama === 'VENDOR') return res.status(400).json({ success: false, message: 'Nama wajib diisi' });
  if (nama.length > 40) return res.status(400).json({ success: false, message: 'Nama maksimal 40 karakter' });
  if (nama === r.nama) return res.json({ success: true });
  if (db.prepare('SELECT 1 FROM rincian WHERE grup = ? AND nama = ?').get(r.grup, nama)) {
    return res.status(400).json({ success: false, message: 'Nama sudah dipakai rincian lain' });
  }
  // Nama baru ikut diterapkan ke transaksi lama supaya angka di dashboard tidak hilang
  db.transaction(() => {
    db.prepare('UPDATE rincian SET nama = ? WHERE id = ?').run(nama, r.id);
    db.prepare('UPDATE transaksi SET sub_tipe = ? WHERE tipe = ? AND sub_tipe = ?').run(nama, r.grup, r.nama);
  })();
  catatLog(req.user.id, req.user.username, 'EDIT RINCIAN', `${r.grup.toUpperCase()}: ${r.nama} -> ${nama}`);
  res.json({ success: true });
});

app.delete('/api/rincian/:id', authMiddleware, developerMiddleware, (req, res) => {
  const r = db.prepare('SELECT * FROM rincian WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ success: false, message: 'Rincian tidak ditemukan' });
  db.prepare('DELETE FROM rincian WHERE id = ?').run(r.id); // riwayat transaksi lama tidak dihapus
  catatLog(req.user.id, req.user.username, 'HAPUS RINCIAN', `${r.grup.toUpperCase()}: ${r.nama}`);
  res.json({ success: true });
});

// ============ TRANSAKSI ============
app.post('/api/transaksi', authMiddleware, (req, res) => {
  const { sku, jumlah, marketplace, sub_tipe, tanggal_transaksi } = req.body;
  let tipe = req.body.tipe;
  const qty = parseInt(jumlah);
  if (!sku || !tipe || !qty || qty < 1) return res.status(400).json({ success: false, message: 'Data tidak lengkap' });

  const barang = db.prepare('SELECT * FROM barang WHERE sku = ?').get(sku);
  if (!barang) return res.status(404).json({ success: false, message: 'SKU tidak terdaftar' });

  let detailTipe = sub_tipe || marketplace || '-';
  let kilat = 0;
  let labelLog = String(tipe).toUpperCase();

  if (tipe === 'pengiriman-kilat') {
    // Pengiriman Kilat = orderan Shopee -> tercatat sebagai BARANG KELUAR, marketplace SHOPEE
    tipe = 'keluar'; detailTipe = 'SHOPEE'; kilat = 1; labelLog = 'PENGIRIMAN KILAT';
  } else if (GRUP_RINCIAN.includes(tipe)) {
    const daftar = daftarRincian(tipe).map(r => r.nama);
    if (daftar.length > 0 && !daftar.includes(detailTipe)) {
      return res.status(400).json({ success: false, message: `Rincian "${detailTipe}" tidak terdaftar. Muat ulang halaman.` });
    }
  } else {
    return res.status(400).json({ success: false, message: 'Tipe transaksi tidak dikenal' });
  }

  let newStok = barang.stok;
  if (tipe === 'masuk' || tipe === 'return-masuk') newStok += qty;
  else {
    if (barang.stok < qty) return res.status(400).json({ success: false, message: 'Stok tidak cukup' });
    newStok -= qty;
  }

  const waktuTransaksi = tanggal_transaksi ? new Date(tanggal_transaksi).toISOString() : new Date().toISOString();

  db.transaction(() => {
    db.prepare('UPDATE barang SET stok=? WHERE id=?').run(newStok, barang.id);
    db.prepare('INSERT INTO transaksi (barang_id, tipe, sub_tipe, jumlah, user_id, created_at, kilat) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(barang.id, tipe, detailTipe, qty, req.user.id, waktuTransaksi, kilat);
  })();

  catatLog(req.user.id, req.user.username, 'TRANSAKSI', `${labelLog} - ${qty} pcs (SKU: ${sku}) - ${detailTipe}`);
  res.json({ success: true, stok_baru: newStok });
});

// ============ RIWAYAT SCAN (LIHAT, UBAH, HAPUS) ============
// Dipakai di semua halaman scan. Staff & admin sama-sama boleh mengoreksi; setiap koreksi tercatat di Log Aktivitas.
// Kunci = nama halaman scan di menu; isinya = filter ke tabel transaksi.
const HALAMAN_RIWAYAT = {
  'masuk':            { tipe: 'masuk',         kilat: 0 },
  'return-masuk':     { tipe: 'return-masuk',  kilat: 0 },
  'keluar':           { tipe: 'keluar',        kilat: 0 },
  'return-keluar':    { tipe: 'return-keluar', kilat: 0 },
  'affiliate':        { tipe: 'affiliate',     kilat: 0 },
  'pengiriman-kilat': { tipe: 'keluar',        kilat: 1 },
  'reseller':         { tipe: 'reseller',      kilat: 0 }
};
const arahStok = tipe => (tipe === 'masuk' || tipe === 'return-masuk') ? 1 : -1;
class GalatBisnis extends Error {}

app.get('/api/riwayat-scan/:halaman', authMiddleware, (req, res) => {
  const h = HALAMAN_RIWAYAT[req.params.halaman];
  if (!h) return res.status(404).json({ success: false, message: 'Halaman tidak dikenal' });

  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const where = ['t.tipe = ?', 'COALESCE(t.kilat, 0) = ?'];
  const param = [h.tipe, h.kilat];

  const tgl = /^\d{4}-\d{2}-\d{2}$/;
  if (tgl.test(req.query.start || '')) { where.push('DATE(t.created_at) >= ?'); param.push(req.query.start); }
  if (tgl.test(req.query.end || ''))   { where.push('DATE(t.created_at) <= ?'); param.push(req.query.end); }

  const q = String(req.query.q || '').trim().toLowerCase();
  if (q) {
    const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
    where.push(`(LOWER(b.sku) LIKE ? ESCAPE '\\' OR LOWER(b.artikel) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(t.sub_tipe, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(u.username, '')) LIKE ? ESCAPE '\\')`);
    param.push(like, like, like, like);
  }

  const dari = `FROM transaksi t JOIN barang b ON b.id = t.barang_id LEFT JOIN users u ON u.id = t.user_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(t.jumlah), 0) AS qty ${dari}`).get(...param);
  const data = db.prepare(`
    SELECT t.id, t.tipe, t.sub_tipe, t.jumlah, COALESCE(t.kilat, 0) AS kilat, DATE(t.created_at) AS tanggal,
           t.diubah_at, t.diubah_oleh, b.sku, b.artikel, b.size, u.username AS petugas
    ${dari}
    ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?
  `).all(...param, limit, offset);

  res.json({ success: true, data, total: total.n, total_qty: total.qty, limit, offset });
});

app.put('/api/transaksi/:id', authMiddleware, (req, res) => {
  const trx = db.prepare('SELECT * FROM transaksi WHERE id = ?').get(req.params.id);
  if (!trx) return res.status(404).json({ success: false, message: 'Data scan tidak ditemukan (mungkin sudah dihapus)' });

  const qty = parseInt(req.body.jumlah);
  if (!qty || qty < 1) return res.status(400).json({ success: false, message: 'Qty minimal 1' });

  const skuBaru = String(req.body.sku || '').trim();
  if (!skuBaru) return res.status(400).json({ success: false, message: 'SKU / barcode wajib diisi' });
  const brgLama = db.prepare('SELECT * FROM barang WHERE id = ?').get(trx.barang_id);
  const brgBaru = db.prepare('SELECT * FROM barang WHERE LOWER(sku) = LOWER(?)').get(skuBaru);
  if (!brgBaru) return res.status(404).json({ success: false, message: `SKU "${skuBaru}" tidak terdaftar di data barang` });

  // Tanggal: hanya diganti kalau memang berbeda, supaya jam aslinya tidak berubah
  let waktuBaru = trx.created_at;
  const tglBaru = String(req.body.tanggal || '').trim();
  if (tglBaru) {
    const cek = new Date(`${tglBaru}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tglBaru) || isNaN(cek) || cek.toISOString().slice(0, 10) !== tglBaru) {
      return res.status(400).json({ success: false, message: 'Format tanggal tidak valid' });
    }
    const tglLama = db.prepare('SELECT DATE(created_at) AS d FROM transaksi WHERE id = ?').get(trx.id).d;
    if (tglBaru !== tglLama) waktuBaru = `${tglBaru}T00:00:00.000Z`;
  }

  // Keterangan (vendor / marketplace / alasan retur / reseller / affiliate)
  let subBaru = trx.sub_tipe;
  if (trx.kilat) subBaru = 'SHOPEE';
  else if (req.body.sub_tipe !== undefined) {
    const s = String(req.body.sub_tipe || '').replace(/\s+/g, ' ').trim();
    if (s !== (trx.sub_tipe || '')) {
      const daftar = daftarRincian(trx.tipe).map(r => r.nama);
      if (daftar.length > 0 && !daftar.includes(s)) {
        return res.status(400).json({ success: false, message: `Keterangan "${s}" tidak terdaftar. Muat ulang halaman.` });
      }
      subBaru = s || '-';
    }
  }

  const arah = arahStok(trx.tipe);
  const updStok = db.prepare('UPDATE barang SET stok = ? WHERE id = ?');
  try {
    db.transaction(() => {
      if (brgLama.id === brgBaru.id) {
        const stokAkhir = brgLama.stok + arah * (qty - trx.jumlah);
        if (stokAkhir < 0) throw new GalatBisnis(`Stok ${brgLama.sku} tidak cukup untuk perubahan ini (stok sekarang ${brgLama.stok}).`);
        updStok.run(stokAkhir, brgLama.id);
      } else {
        const stokLama = brgLama.stok - arah * trx.jumlah;   // batalkan efek scan lama
        if (stokLama < 0) throw new GalatBisnis(`Stok ${brgLama.sku} tidak cukup untuk membatalkan scan lama (stok sekarang ${brgLama.stok}, scan lama ${trx.jumlah}).`);
        const stokBaru = brgBaru.stok + arah * qty;          // terapkan ke SKU yang benar
        if (stokBaru < 0) throw new GalatBisnis(`Stok ${brgBaru.sku} tidak cukup (stok sekarang ${brgBaru.stok}, diminta ${qty}).`);
        updStok.run(stokLama, brgLama.id);
        updStok.run(stokBaru, brgBaru.id);
      }
      db.prepare('UPDATE transaksi SET barang_id = ?, jumlah = ?, sub_tipe = ?, created_at = ?, diubah_at = ?, diubah_oleh = ? WHERE id = ?')
        .run(brgBaru.id, qty, subBaru, waktuBaru, new Date().toISOString(), req.user.username, trx.id);
    })();
  } catch (err) {
    if (err instanceof GalatBisnis) return res.status(400).json({ success: false, message: err.message });
    console.error('Gagal ubah transaksi:', err.message);
    return res.status(500).json({ success: false, message: 'Gagal menyimpan perubahan' });
  }

  catatLog(req.user.id, req.user.username, 'EDIT TRANSAKSI',
    `${String(trx.tipe).toUpperCase()}${trx.kilat ? ' (KILAT)' : ''} #${trx.id}: ${brgLama.sku} x${trx.jumlah} [${trx.sub_tipe || '-'}] -> ${brgBaru.sku} x${qty} [${subBaru || '-'}]`);
  res.json({ success: true, message: 'Perubahan tersimpan, stok sudah disesuaikan.' });
});

app.delete('/api/transaksi/:id', authMiddleware, (req, res) => {
  const trx = db.prepare('SELECT * FROM transaksi WHERE id = ?').get(req.params.id);
  if (!trx) return res.status(404).json({ success: false, message: 'Data scan tidak ditemukan (mungkin sudah dihapus)' });
  const brg = db.prepare('SELECT * FROM barang WHERE id = ?').get(trx.barang_id);

  try {
    db.transaction(() => {
      // Batalkan efek scan ke stok: scan masuk dikurangi lagi, scan keluar dikembalikan
      const stokAkhir = brg.stok - arahStok(trx.tipe) * trx.jumlah;
      if (stokAkhir < 0) throw new GalatBisnis(`Tidak bisa dihapus: stok ${brg.sku} sekarang ${brg.stok}, sedangkan scan ini menambah ${trx.jumlah} pcs (stok akan minus). Minta admin menyesuaikan stok lebih dulu.`);
      db.prepare('UPDATE barang SET stok = ? WHERE id = ?').run(stokAkhir, brg.id);
      db.prepare('DELETE FROM transaksi WHERE id = ?').run(trx.id);
    })();
  } catch (err) {
    if (err instanceof GalatBisnis) return res.status(400).json({ success: false, message: err.message });
    console.error('Gagal hapus transaksi:', err.message);
    return res.status(500).json({ success: false, message: 'Gagal menghapus data scan' });
  }

  catatLog(req.user.id, req.user.username, 'HAPUS TRANSAKSI',
    `${String(trx.tipe).toUpperCase()}${trx.kilat ? ' (KILAT)' : ''} #${trx.id}: ${brg.sku} x${trx.jumlah} [${trx.sub_tipe || '-'}] tgl ${String(trx.created_at).slice(0, 10)}`);
  res.json({ success: true, message: 'Data scan dihapus, stok sudah disesuaikan.' });
});

// ============ HAPUS SEMUA DATA (MODE DEVELOPER, ADMIN) ============
// Menghapus semua riwayat transaksi & mereset stok. Akun, rincian (vendor/marketplace/dll) dan log aktivitas tetap ada.
app.post('/api/reset-data', authMiddleware, developerMiddleware, (req, res) => {
  if (req.body.konfirmasi !== 'HAPUS SEMUA') return res.status(400).json({ success: false, message: 'Konfirmasi tidak sesuai' });
  const hapusBarang = req.body.hapus_barang === true;
  let jmlTrx = 0, jmlBarang = 0;
  db.transaction(() => {
    jmlTrx = db.prepare('DELETE FROM transaksi').run().changes;
    if (hapusBarang) jmlBarang = db.prepare('DELETE FROM barang').run().changes;
    else jmlBarang = db.prepare('UPDATE barang SET stok = 0').run().changes;
  })();
  catatLog(req.user.id, req.user.username, 'HAPUS SEMUA DATA',
    `${jmlTrx} transaksi dihapus; ` + (hapusBarang ? `${jmlBarang} data barang dihapus` : `stok ${jmlBarang} barang direset ke 0`));
  res.json({ success: true, message: `Selesai: ${jmlTrx} transaksi dihapus, ` + (hapusBarang ? `${jmlBarang} data barang dihapus.` : `stok ${jmlBarang} barang direset ke 0.`) });
});

// ============ UPLOAD EXCEL TRANSAKSI ============
// Template kosong (hanya judul kolom) untuk tiap halaman transaksi
app.get('/api/template-transaksi/:tipe', authMiddleware, (req, res) => {
  const tipe = req.params.tipe;
  const k = KONFIG[tipe];
  if (!k) return res.status(404).json({ success: false, message: 'Tipe transaksi tidak dikenal' });
  const kolom = kolomTemplate(tipe);
  const ws = xlsx.utils.aoa_to_sheet([kolom]);
  ws['!cols'] = kolom.map(c => ({ wch: c === 'artikel' ? 36 : 16 }));
  const petunjuk = [
    ['PETUNJUK UPLOAD ' + k.label],
    ['1. Isi data mulai baris ke-2 pada sheet "Data". Jangan ubah judul kolom.'],
    ['2. tanggal : format 2026-11-21 atau 21/11/2026.'],
    ['3. barcode : harus sama dengan SKU/barcode di data barang. Jika barcode berupa angka panjang, ubah format kolom menjadi Text.'],
    ['4. artikel : pelengkap saja, yang dipakai sistem adalah barcode.'],
    ['5. qty : angka bulat minimal 1.']
  ];
  if (k.detail === 'vendor') petunjuk.push(['6. vendor : cukup tulis nama vendornya, misal OYOD (sistem otomatis menjadi VENDOR OYOD). Nama harus sudah terdaftar.']);
  else if (k.detail) petunjuk.push([`6. ${k.detail} : nama harus sudah terdaftar di Mode Developer.`]);
  petunjuk.push(['Jika ada 1 baris salah, seluruh file ditolak (tidak ada data yang tersimpan) dan daftar kesalahannya ditampilkan.']);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Data');
  const wsP = xlsx.utils.aoa_to_sheet(petunjuk);
  wsP['!cols'] = [{ wch: 110 }];
  xlsx.utils.book_append_sheet(wb, wsP, 'Petunjuk');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', `attachment; filename="Template_${tipe}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.post('/api/upload-transaksi/:tipe', authMiddleware,
  (req, res, next) => uploadMemori.single('file')(req, res, err => {
    if (err) return res.status(400).json({ success: false, message: err.code === 'LIMIT_FILE_SIZE' ? 'File terlalu besar (maksimal 5 MB)' : 'Gagal membaca file' });
    next();
  }),
  (req, res) => {
    const tipe = req.params.tipe;
    const k = KONFIG[tipe];
    if (!k) return res.status(404).json({ success: false, message: 'Tipe transaksi tidak dikenal' });
    if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
    if (!/\.(xlsx|xls|csv)$/i.test(req.file.originalname || '')) {
      return res.status(400).json({ success: false, message: 'Gunakan file Excel (.xlsx / .xls) atau .csv' });
    }

    let rows;
    try {
      const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    } catch (err) {
      return res.status(400).json({ success: false, message: 'File Excel tidak bisa dibaca' });
    }

    const petaBarang = new Map();
    db.prepare('SELECT id, sku, artikel, stok FROM barang').all().forEach(b => petaBarang.set(String(b.sku).trim().toLowerCase(), b));

    const hasil = prosesTransaksiExcel(rows, tipe, {
      cariBarang: kode => petaBarang.get(String(kode).trim().toLowerCase()),
      daftarRincian: grup => daftarRincian(grup).map(r => r.nama),
      normalisasiNama
    });
    if (!hasil.ok) {
      return res.status(400).json({ success: false, message: hasil.pesan, errors: hasil.errors, total_error: hasil.totalError });
    }

    const kilat = tipe === 'pengiriman-kilat' ? 1 : 0;
    const arah = k.arah;
    const updStok = db.prepare('UPDATE barang SET stok = stok + ? WHERE id = ?');
    const insTrx = db.prepare('INSERT INTO transaksi (barang_id, tipe, sub_tipe, jumlah, user_id, created_at, kilat) VALUES (?, ?, ?, ?, ?, ?, ?)');
    let totalQty = 0;
    try {
      db.transaction(() => {
        hasil.items.forEach(it => {
          updStok.run(arah * it.qty, it.barang.id);
          insTrx.run(it.barang.id, k.tipeDb, it.subTipe, it.qty, req.user.id, `${it.tanggal}T00:00:00.000Z`, kilat);
          totalQty += it.qty;
        });
      })();
    } catch (err) {
      console.error('Gagal simpan upload transaksi:', err.message);
      return res.status(500).json({ success: false, message: 'Gagal menyimpan data. Tidak ada data yang tersimpan.' });
    }

    catatLog(req.user.id, req.user.username, 'UPLOAD TRANSAKSI', `${k.label} - ${hasil.items.length} baris, ${totalQty} pcs (file: ${req.file.originalname})`);
    res.json({
      success: true,
      message: `Berhasil menyimpan ${hasil.items.length} baris (${totalQty} pcs) ke ${k.label}.`,
      jumlah_baris: hasil.items.length, total_qty: totalQty,
      peringatan: hasil.peringatan, total_peringatan: hasil.totalPeringatan
    });
  });

// ============ DASHBOARD REKAP ============
app.get('/api/dashboard-rekap', authMiddleware, (req, res) => {
  const startDate = req.query.start || new Date().toISOString().split('T')[0];
  const endDate = req.query.end || new Date().toISOString().split('T')[0];

  const totalStokSaatIni = db.prepare('SELECT SUM(stok) as total FROM barang').get().total || 0;
  const totalNilaiAset = db.prepare('SELECT SUM(stok * hpp) as total FROM barang').get().total || 0;

  const perSub = db.prepare('SELECT sub_tipe, SUM(jumlah) as total FROM transaksi WHERE tipe = ? AND DATE(created_at) BETWEEN ? AND ? GROUP BY sub_tipe');
  const totals = {};
  const rincian = {};
  GRUP_RINCIAN.forEach(g => {
    const rows = perSub.all(g, startDate, endDate);
    const map = {};
    rows.forEach(r => { map[r.sub_tipe] = r.total; });
    totals[g] = rows.reduce((a, r) => a + (r.total || 0), 0);
    rincian[g] = daftarRincian(g).map(r => ({ id: r.id, nama: r.nama, total: map[r.nama] || 0 }));
  });

  const kilat = db.prepare("SELECT SUM(jumlah) as total FROM transaksi WHERE tipe = 'keluar' AND kilat = 1 AND DATE(created_at) BETWEEN ? AND ?").get(startDate, endDate).total || 0;

  res.json({
    success: true,
    data: {
      stok_total: totalStokSaatIni,
      total_aset: totalNilaiAset,
      masuk: totals['masuk'],
      keluar: totals['keluar'] + totals['reseller'],   // marketplace (sudah termasuk Pengiriman Kilat) + Reseller
      return_masuk: totals['return-masuk'],
      return_keluar: totals['return-keluar'],
      affiliate: totals['affiliate'],
      reseller: totals['reseller'],
      pengiriman_kilat: kilat,               // bagian dari keluar & Shopee
      rincian
    }
  });
});

// ============ LAPORAN OUTLET ============
app.get('/api/laporan-outlet', authMiddleware, (req, res) => {
  const startDate = req.query.start || new Date().toISOString().split('T')[0];
  const endDate = req.query.end || new Date().toISOString().split('T')[0];
  
  const query = `
    SELECT 
      t.sub_tipe as marketplace, 
      SUM(t.jumlah) as total_qty, 
      SUM(t.jumlah * b.hpp) as total_hpp
    FROM transaksi t
    JOIN barang b ON t.barang_id = b.id
    WHERE t.tipe IN ('keluar', 'reseller') 
      AND DATE(t.created_at) BETWEEN ? AND ?
    GROUP BY t.sub_tipe
  `;
  
  const data = db.prepare(query).all(startDate, endDate);
  res.json({ success: true, data });
});

// ============ LAPORAN COMPARE ============
app.get('/api/laporan-compare', authMiddleware, (req, res) => {
  const { start1, end1, start2, end2 } = req.query;
  
  if (!start1 || !end1 || !start2 || !end2) {
    return res.status(400).json({ success: false, message: 'Tanggal perbandingan tidak lengkap' });
  }

  const getQtyTotal = (start, end) => {
    const query = `SELECT SUM(jumlah) as total FROM transaksi WHERE tipe IN ('keluar', 'reseller') AND DATE(created_at) BETWEEN ? AND ?`;
    const result = db.prepare(query).get(start, end);
    return result.total || 0;
  };

  const qty1 = getQtyTotal(start1, end1);
  const qty2 = getQtyTotal(start2, end2);

  res.json({ success: true, data: { qty1, qty2 } });
});

// ============ LAPORAN DAILY ============
app.get('/api/laporan-daily', authMiddleware, (req, res) => {
  const startDate = req.query.start;
  const endDate = req.query.end;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'Tanggal tidak lengkap' });
  }

  const query = `
    SELECT 
      DATE(created_at) as tanggal, 
      SUM(jumlah) as total_qty
    FROM transaksi
    WHERE tipe IN ('keluar', 'reseller') 
      AND DATE(created_at) BETWEEN ? AND ?
    GROUP BY DATE(created_at)
  `;
  
  const data = db.prepare(query).all(startDate, endDate);
  res.json({ success: true, data });
});

// ============ LAPORAN MONTHLY ============
app.get('/api/laporan-monthly', authMiddleware, (req, res) => {
  const startDate = req.query.start;
  const endDate = req.query.end;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'Tanggal tidak lengkap' });
  }

  const query = `
    SELECT 
      strftime('%Y-%m', created_at) as bulan, 
      SUM(jumlah) as total_qty
    FROM transaksi
    WHERE tipe IN ('keluar', 'reseller') 
      AND DATE(created_at) BETWEEN ? AND ?
    GROUP BY strftime('%Y-%m', created_at)
  `;
  
  const data = db.prepare(query).all(startDate, endDate);
  res.json({ success: true, data });
});

// ============ LAPORAN BEST SELLER ============
app.get('/api/laporan-bestseller', authMiddleware, (req, res) => {
  const startDate = req.query.start;
  const endDate = req.query.end;
  
  if (!startDate || !endDate) {
    return res.status(400).json({ success: false, message: 'Tanggal tidak lengkap' });
  }

  const query = `
    SELECT 
      b.artikel, 
      b.size, 
      SUM(t.jumlah) as total_qty
    FROM transaksi t
    JOIN barang b ON t.barang_id = b.id
    WHERE t.tipe IN ('keluar', 'reseller') 
      AND DATE(t.created_at) BETWEEN ? AND ?
    GROUP BY b.artikel, b.size
    ORDER BY total_qty DESC
    LIMIT 50
  `;
  
  const data = db.prepare(query).all(startDate, endDate);
  res.json({ success: true, data });
});

// ============ EXPORT & IMPORT ============
app.get('/api/export-excel', authMiddleware, (req, res) => {
  const barang = db.prepare('SELECT sku as SKU, artikel as ARTIKETL, kategori as KATEGORI, size as SIZE, stok as STOK, hpp as HPP FROM barang').all();
  const worksheet = xlsx.utils.json_to_sheet(barang);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Data_Barang");
  const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="Laporan_Stok_JYF.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// ============ BACKUP DATABASE (ADMIN) ============
// Salinan konsisten wms.db (aman dipakai walau ada transaksi berjalan), dikirim sebagai file unduhan.
app.get('/api/backup-db', authMiddleware, adminMiddleware, async (req, res) => {
  const tmp = path.join(os.tmpdir(), `wms-backup-${Date.now()}-${process.pid}.db`);
  const hapusTmp = () => fs.unlink(tmp, () => {});
  try {
    await db.backup(tmp);
    catatLog(req.user.id, req.user.username, 'BACKUP DATABASE', 'Mengunduh backup wms.db');
    res.download(tmp, 'wms.db', err => {
      hapusTmp();
      if (err && !res.headersSent) res.status(500).json({ success: false, message: 'Gagal mengirim file backup' });
    });
  } catch (err) {
    hapusTmp();
    console.error('Gagal backup database:', err.message);
    res.status(500).json({ success: false, message: 'Gagal membuat backup database' });
  }
});

app.post('/api/import-csv', authMiddleware, adminMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
  const workbook = xlsx.readFile(req.file.path);
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  let successCount = 0;
  const stmt = db.prepare('INSERT OR IGNORE INTO barang (sku, artikel, kategori, size, stok, hpp) VALUES (?, ?, ?, ?, ?, ?)');

  data.forEach(row => {
    const sku = (row.SKU || row.sku || '').toString().trim();
    const artikel = (row.ARTIKETL || row.ARTIKEL || row.artikel || '').toString().trim();
    const kategori = (row.KATEGORI || row.kategori || '').toString().trim();
    const stok = parseInt(row.STOK || row.stok || 0);
    const hpp = parseInt(row.HPP || row.hpp || 0);
    if (!sku || !artikel || sku.toLowerCase() === 'sku') return;

    let size = '-';
    const katLower = kategori.toLowerCase();
    if (katLower.includes('sepatu') || katLower.includes('sandal')) {
      const match = artikel.match(/\b(3[0-9]|4[0-9])\b/); 
      if (match) size = match[0];
    }
    const info = stmt.run(sku, artikel, kategori, size, stok, hpp);
    if (info.changes > 0) successCount++;
  });
  fs.unlinkSync(req.file.path);
  catatLog(req.user.id, req.user.username, 'IMPORT EXCEL', `Import ${successCount} data barang baru`);
  res.json({ success: true, message: `Berhasil import ${successCount} data baru.` });
});

app.post('/api/upload-so', authMiddleware, adminMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'File tidak ditemukan' });
  const workbook = xlsx.readFile(req.file.path);
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]]);
  let successCount = 0;
  const stmt = db.prepare(`INSERT INTO barang (sku, artikel, kategori, size, stok, hpp) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sku) DO UPDATE SET stok = excluded.stok, artikel = excluded.artikel, kategori = excluded.kategori, hpp = excluded.hpp`);

  data.forEach(row => {
    const sku = (row.SKU || row.sku || '').toString().trim();
    const artikel = (row.ARTIKETL || row.ARTIKEL || row.artikel || '').toString().trim();
    const kategori = (row.KATEGORI || row.kategori || '').toString().trim();
    const stok = parseInt(row.STOK || row.stok || 0);
    const hpp = parseInt(row.HPP || row.hpp || 0);
    if (!sku || !artikel || sku.toLowerCase() === 'sku') return;

    let size = '-';
    const katLower = kategori.toLowerCase();
    if (katLower.includes('sepatu') || katLower.includes('sandal')) {
      const match = artikel.match(/\b(3[0-9]|4[0-9])\b/); 
      if (match) size = match[0];
    }
    stmt.run(sku, artikel, kategori, size, stok, hpp);
    successCount++;
  });
  fs.unlinkSync(req.file.path);
  catatLog(req.user.id, req.user.username, 'UPLOAD SO', `Sinkronisasi stok ${successCount} data`);
  res.json({ success: true, message: `Berhasil menyinkronkan ${successCount} data hasil SO.` });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
