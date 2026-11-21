// Logika baca & validasi file Excel untuk transaksi masuk / keluar.
// Sengaja dibuat "murni" (tanpa akses database / library excel) supaya mudah diuji.

const MAKS_BARIS = 5000;
const MAKS_ERROR_DITAMPILKAN = 50;

// Konfigurasi tiap halaman transaksi.
//  - detail: nama kolom ke-5 (null = tidak ada kolom itu)
//  - alias : nama kolom lain yang tetap dikenali
//  - grup  : grup rincian di tabel "rincian" untuk validasi (null = tidak divalidasi)
//  - opsional: kolom ke-5 boleh kosong
const KONFIG = {
  'masuk':            { label: 'BARANG MASUK',      detail: 'vendor',      alias: ['vendor', 'supplier'],                          grup: 'masuk',         tipeDb: 'masuk',         arah: 1 },
  'keluar':           { label: 'BARANG KELUAR',     detail: 'marketplace', alias: ['marketplace', 'marketpleace', 'akun'],         grup: 'keluar',        tipeDb: 'keluar',        arah: -1 },
  'pengiriman-kilat': { label: 'PENGIRIMAN KILAT',  detail: null,          alias: [],                                              grup: null,            tipeDb: 'keluar',        arah: -1 },
  'return-masuk':     { label: 'RETURN MASUK',      detail: 'asal retur',  alias: ['asal retur', 'asalretur', 'asal', 'alasan'],   grup: 'return-masuk',  tipeDb: 'return-masuk',  arah: 1 },
  'return-keluar':    { label: 'RETURN KELUAR',     detail: 'asal retur',  alias: ['asal retur', 'asalretur', 'asal', 'alasan'],   grup: 'return-keluar', tipeDb: 'return-keluar', arah: -1 },
  'affiliate':        { label: 'AFFILIATE',         detail: null,          alias: ['affiliate', 'akun affiliate', 'akun'],         grup: 'affiliate',     tipeDb: 'affiliate',     arah: -1, opsional: true },
  'reseller':         { label: 'RESELLER',          detail: 'keterangan',  alias: ['keterangan', 'reseller', 'akun reseller'],     grup: 'reseller',      tipeDb: 'reseller',      arah: -1 }
};

const ALIAS_UMUM = {
  tanggal: ['tanggal', 'tgl', 'date'],
  barcode: ['barcode', 'sku', 'kode barcode'],
  artikel: ['artikel', 'nama artikel', 'nama barang'],
  qty:     ['qty', 'jumlah', 'quantity']
};

const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
const kosong = v => v === null || v === undefined || String(v).trim() === '';

function kolomTemplate(tipe) {
  const k = KONFIG[tipe];
  const kolom = ['tanggal', 'barcode', 'artikel', 'qty'];
  if (k.detail) kolom.push(k.detail === 'asal retur' ? 'asal retur' : k.detail);
  return kolom;
}

// Ubah isi sel tanggal -> 'YYYY-MM-DD' (atau null kalau tidak valid)
function parseTanggal(v) {
  let y, m, d;
  if (typeof v === 'number') {
    if (!(v > 20000 && v < 80000)) return null;               // bukan nomor seri tanggal Excel
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else if (v instanceof Date && !isNaN(v)) {
    y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate();
  } else {
    const s = String(v == null ? '' : v).trim();
    let t;
    if ((t = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[T\s].*)?$/))) { y = +t[1]; m = +t[2]; d = +t[3]; }
    else if ((t = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/))) { d = +t[1]; m = +t[2]; y = +t[3]; if (y < 100) y += 2000; }  // format Indonesia: hari/bulan/tahun
    else return null;
  }
  const cek = new Date(Date.UTC(y, m - 1, d));
  if (cek.getUTCFullYear() !== y || cek.getUTCMonth() !== m - 1 || cek.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseBarcode(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v == null ? '' : v).trim();
}

function parseQty(v) {
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/**
 * rows : array of array hasil baca sheet (baris pertama/tajuk ikut)
 * ctx  : {
 *   cariBarang(barcode) -> { id, sku, artikel, stok } | undefined,
 *   daftarRincian(grup) -> ['NAMA', ...],
 *   normalisasiNama(grup, nama) -> 'NAMA'
 * }
 * return { ok:true, items, peringatan } atau { ok:false, errors, totalError, pesan }
 */
function prosesTransaksiExcel(rows, tipe, ctx) {
  const k = KONFIG[tipe];
  if (!k) return { ok: false, errors: [], totalError: 1, pesan: 'Tipe transaksi tidak dikenal' };

  if (rows.length - 1 > MAKS_BARIS) {
    return { ok: false, errors: [], totalError: 1, pesan: `File terlalu besar. Maksimal ${MAKS_BARIS} baris per upload.` };
  }

  // --- cari baris tajuk (maks 5 baris pertama) ---
  const aliasDetail = [...(k.detail ? [k.detail] : []), ...k.alias].map(norm);
  let barisTajuk = -1, idx = null;
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const peta = {};
    rows[i].forEach((sel, c) => {
      const n = norm(sel);
      if (!n) return;
      for (const [kunci, daftar] of Object.entries(ALIAS_UMUM)) {
        if (daftar.map(norm).includes(n) && peta[kunci] === undefined) peta[kunci] = c;
      }
      if ((k.detail || k.opsional) && aliasDetail.includes(n) && peta.detail === undefined) peta.detail = c;
    });
    if (peta.barcode !== undefined && peta.qty !== undefined) { barisTajuk = i; idx = peta; break; }
  }
  if (barisTajuk < 0) {
    return { ok: false, errors: [], totalError: 1,
      pesan: `Baris judul kolom tidak ditemukan. Baris pertama file harus: ${kolomTemplate(tipe).join(', ').toUpperCase()}` };
  }
  const kurang = [];
  if (idx.tanggal === undefined) kurang.push('TANGGAL');
  if (k.detail && idx.detail === undefined) kurang.push(k.detail.toUpperCase());
  if (kurang.length) {
    return { ok: false, errors: [], totalError: 1, pesan: `Kolom wajib tidak ada: ${kurang.join(', ')}` };
  }

  // --- rincian yang valid (vendor / marketplace / dst) ---
  let daftarValid = [];
  let petaValid = new Map();
  if (k.grup) {
    daftarValid = ctx.daftarRincian(k.grup);
    daftarValid.forEach(n => petaValid.set(n.toUpperCase(), n));
  }

  const errors = [];
  const items = [];
  const peringatan = [];
  const stokBerjalan = new Map();   // stok simulasi per barang, supaya total baris yang sama tidak melebihi stok
  const catatError = (baris, pesan) => errors.push({ baris, pesan });

  for (let i = barisTajuk + 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.every(kosong)) continue;
    const baris = i + 1;                          // nomor baris seperti di Excel
    const jumlahError = errors.length;

    const tanggal = parseTanggal(r[idx.tanggal]);
    if (!tanggal) catatError(baris, kosong(r[idx.tanggal]) ? 'Tanggal kosong' : `Tanggal "${r[idx.tanggal]}" tidak valid (pakai format 2026-11-21 atau 21/11/2026)`);

    const barcode = parseBarcode(r[idx.barcode]);
    let barang;
    if (!barcode) catatError(baris, 'Barcode kosong');
    else {
      barang = ctx.cariBarang(barcode);
      if (!barang) catatError(baris, `Barcode "${barcode}" tidak terdaftar di data barang`);
    }

    const qty = parseQty(r[idx.qty]);
    if (qty === null) catatError(baris, `Qty "${r[idx.qty]}" harus angka bulat minimal 1`);

    // kolom ke-5 (vendor / marketplace / asal retur / keterangan)
    let subTipe;
    if (tipe === 'pengiriman-kilat') subTipe = 'SHOPEE';
    else {
      const mentah = idx.detail === undefined ? '' : r[idx.detail];
      if (kosong(mentah)) {
        if (k.opsional) subTipe = '-';
        else catatError(baris, `Kolom ${k.detail.toUpperCase()} kosong`);
      } else {
        const nama = ctx.normalisasiNama(k.grup, mentah);
        if (daftarValid.length === 0) subTipe = nama;
        else if (petaValid.has(nama)) subTipe = petaValid.get(nama);
        else catatError(baris, `${k.detail || 'Akun'} "${String(mentah).trim()}" belum terdaftar. Pilihan: ${daftarValid.slice(0, 12).join(', ')}${daftarValid.length > 12 ? ', ...' : ''}`);
      }
    }

    // stok cukup? (hanya untuk transaksi yang mengurangi stok)
    if (barang && qty !== null && k.arah < 0) {
      const sisa = stokBerjalan.has(barang.id) ? stokBerjalan.get(barang.id) : barang.stok;
      if (sisa < qty) catatError(baris, `Stok ${barang.sku} tidak cukup (sisa ${sisa}, diminta ${qty})`);
      else stokBerjalan.set(barang.id, sisa - qty);
    }

    if (errors.length === jumlahError) {
      // artikel di Excel hanya pelengkap; barcode yang jadi acuan. Beri peringatan bila beda.
      if (idx.artikel !== undefined && !kosong(r[idx.artikel]) &&
          String(r[idx.artikel]).trim().toUpperCase() !== String(barang.artikel).trim().toUpperCase()) {
        peringatan.push({ baris, pesan: `Artikel di file "${String(r[idx.artikel]).trim()}" berbeda dengan data barang "${barang.artikel}" (barcode ${barang.sku})` });
      }
      items.push({ barang, qty, tanggal, subTipe });
    }
  }

  if (errors.length) {
    return { ok: false, errors: errors.slice(0, MAKS_ERROR_DITAMPILKAN), totalError: errors.length,
      pesan: `${errors.length} kesalahan ditemukan. Tidak ada data yang disimpan — perbaiki file lalu upload ulang.` };
  }
  if (items.length === 0) {
    return { ok: false, errors: [], totalError: 1, pesan: 'File tidak berisi data transaksi.' };
  }
  return { ok: true, items, peringatan: peringatan.slice(0, MAKS_ERROR_DITAMPILKAN), totalPeringatan: peringatan.length };
}

module.exports = { KONFIG, kolomTemplate, parseTanggal, prosesTransaksiExcel };
