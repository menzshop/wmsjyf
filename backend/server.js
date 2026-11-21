const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const xlsx = require('xlsx');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

app.use(cors());
app.use(express.json());
app.use(express.static('../frontend'));
const upload = multer({ dest: 'uploads/' });

// ============ AUTH ============
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username?.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ success: false, message: 'Username atau password salah' });
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token, user: { id: user.id, username: user.username, role: user.role } });
});

function authMiddleware(req, res, next) {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) { return res.status(401).json({ success: false, message: 'Token invalid' }); }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya Admin.' });
  next();
}

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
app.get('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  res.json({ success: true, data: db.prepare('SELECT id, username, role, created_at FROM users ORDER BY id ASC').all() });
});
app.post('/api/users', authMiddleware, adminMiddleware, (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username & Password wajib diisi' });
  try {
    db.prepare('INSERT INTO users (username, password, role) VALUES (?, ?, ?)').run(username.toLowerCase(), bcrypt.hashSync(password, 10), role || 'staff');
    res.json({ success: true });
  } catch (err) { res.status(400).json({ success: false, message: 'Username sudah ada' }); }
});
app.delete('/api/users/:id', authMiddleware, adminMiddleware, (req, res) => {
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

app.post('/api/rincian', authMiddleware, adminMiddleware, (req, res) => {
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

app.put('/api/rincian/:id', authMiddleware, adminMiddleware, (req, res) => {
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

app.delete('/api/rincian/:id', authMiddleware, adminMiddleware, (req, res) => {
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
      keluar: totals['keluar'],              // sudah termasuk Pengiriman Kilat
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
app.get('/api/laporan-outlet', authMiddleware, adminMiddleware, (req, res) => {
  const startDate = req.query.start || new Date().toISOString().split('T')[0];
  const endDate = req.query.end || new Date().toISOString().split('T')[0];
  
  const query = `
    SELECT 
      t.sub_tipe as marketplace, 
      SUM(t.jumlah) as total_qty, 
      SUM(t.jumlah * b.hpp) as total_hpp
    FROM transaksi t
    JOIN barang b ON t.barang_id = b.id
    WHERE t.tipe = 'keluar' 
      AND DATE(t.created_at) BETWEEN ? AND ?
    GROUP BY t.sub_tipe
  `;
  
  const data = db.prepare(query).all(startDate, endDate);
  res.json({ success: true, data });
});

// ============ LAPORAN COMPARE ============
app.get('/api/laporan-compare', authMiddleware, adminMiddleware, (req, res) => {
  const { start1, end1, start2, end2 } = req.query;
  
  if (!start1 || !end1 || !start2 || !end2) {
    return res.status(400).json({ success: false, message: 'Tanggal perbandingan tidak lengkap' });
  }

  const getQtyTotal = (start, end) => {
    const query = `SELECT SUM(jumlah) as total FROM transaksi WHERE tipe = 'keluar' AND DATE(created_at) BETWEEN ? AND ?`;
    const result = db.prepare(query).get(start, end);
    return result.total || 0;
  };

  const qty1 = getQtyTotal(start1, end1);
  const qty2 = getQtyTotal(start2, end2);

  res.json({ success: true, data: { qty1, qty2 } });
});

// ============ LAPORAN DAILY ============
app.get('/api/laporan-daily', authMiddleware, adminMiddleware, (req, res) => {
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
    WHERE tipe = 'keluar' 
      AND DATE(created_at) BETWEEN ? AND ?
    GROUP BY DATE(created_at)
  `;
  
  const data = db.prepare(query).all(startDate, endDate);
  res.json({ success: true, data });
});

// ============ LAPORAN MONTHLY ============
app.get('/api/laporan-monthly', authMiddleware, adminMiddleware, (req, res) => {
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
    WHERE tipe = 'keluar' 
      AND DATE(created_at) BETWEEN ? AND ?
    GROUP BY strftime('%Y-%m', created_at)
  `;
  
  const data = db.prepare(query).all(startDate, endDate);
  res.json({ success: true, data });
});

// ============ LAPORAN BEST SELLER ============
app.get('/api/laporan-bestseller', authMiddleware, adminMiddleware, (req, res) => {
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
    WHERE t.tipe = 'keluar' 
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
