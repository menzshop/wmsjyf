const API_URL = 'https://wmsjyf-production.up.railway.app/api';

// LOGIN HANDLER
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value.trim().toLowerCase();
        const password = document.getElementById('password').value;
        const errorMsg = document.getElementById('errorMsg');
        const btnLogin = document.getElementById('btnLogin');

        btnLogin.disabled = true; btnLogin.textContent = 'MEMPROSES...';
        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.success) {
                localStorage.setItem('wms_token', data.token);
                localStorage.setItem('wms_user', JSON.stringify(data.user));
                window.location.href = 'dashboard.html';
            } else {
                errorMsg.textContent = String(data.message || '').toUpperCase();
                btnLogin.disabled = false; btnLogin.textContent = 'LOGIN';
            }
        } catch (err) {
            errorMsg.textContent = 'SERVER MATI / TIDAK TERHUBUNG';
            btnLogin.disabled = false; btnLogin.textContent = 'LOGIN';
        }
    });
}

// HELPERS
function getToken() { return localStorage.getItem('wms_token'); }
function getUser() { return JSON.parse(localStorage.getItem('wms_user') || '{}'); }
async function apiFetch(endpoint, options = {}) {
    const res = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${getToken()}`, ...(options.headers || {}) }
    });
    if (res.status === 401) { localStorage.clear(); window.location.href = 'index.html'; return null; }
    return res.json();
}

// DASHBOARD INIT
if (window.location.pathname.includes('dashboard.html')) {
    if (!getToken()) window.location.href = 'index.html';
    else {
        const user = getUser();
        document.getElementById('userName').textContent = user.username || 'User';
        
        if (user.role !== 'admin') {
            document.getElementById('adminButtons').style.display = 'none';
        } else {
            document.getElementById('menu-kelola-akun').style.display = 'block';
            document.getElementById('menu-log-aktivitas').style.display = 'block';
            document.getElementById('menu-developer').style.display = 'block';
        }

        const today = new Date().toISOString().split('T')[0];
        if(document.getElementById('tglMulai')) {
            document.getElementById('tglMulai').value = today;
            document.getElementById('tglAkhir').value = today;
        }

        terapkanDevMode();
        muatRincian();
        muatDashboard();
        showPage('page-dashboard'); 
    }
}

// NAVIGASI & TAB MENU
function showPage(pageId) {
    // 1. Bersihkan semua halaman dan warna biru
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu a').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.reports-tab').forEach(el => el.classList.remove('active'));
    
    // 2. Tampilkan halaman yang dituju
    document.getElementById(pageId).classList.add('active');

     // 3. Tentukan Tab/Menu yang aktif
    if (pageId.startsWith('page-reports-') && pageId !== 'page-reports-product') {
        document.getElementById('menu-reports').classList.add('active');
        
        // Panggil fungsi untuk menyalakan tab yang sesuai
        let tabId = '';
        if (pageId === 'page-reports-product') tabId = 'tab-product';
        if (pageId === 'page-reports-bestseller') tabId = 'tab-bestseller';
        if (pageId === 'page-reports-outlet') tabId = 'tab-outlet';
        if (pageId === 'page-reports-compare') tabId = 'tab-compare';
        if (pageId === 'page-reports-daily') tabId = 'tab-daily';
        if (pageId === 'page-reports-monthly') tabId = 'tab-monthly';

        bukaTab(pageId, tabId);
        // Lanjut ke bawah agar data laporan ikut dimuat otomatis saat halaman dibuka
    } else {
        if(event && event.currentTarget) {
            event.currentTarget.classList.add('active');
        }
    }

    // 4. Fokus ke kotak scan jika membuka menu transaksi
    const pageToIdMap = {
        'page-masuk': 'scanMasuk', 'page-return-masuk': 'scanReturnMasuk',
        'page-keluar': 'scanKeluar', 'page-return-keluar': 'scanReturnKeluar',
        'page-affiliate': 'scanAffiliate', 'page-pengiriman-kilat': 'scanPengirimanKilat', 'page-reseller': 'scanReseller'
    };
    if (pageToIdMap[pageId]) document.getElementById(pageToIdMap[pageId]).focus();

    // 5. Muat data sesuai halaman yang dibuka
    if (pageId === 'page-kelola-akun') muatTabelUsers();
    if (pageId === 'page-log') muatTabelLog();

    const today = new Date().toISOString().split('T')[0];
    
    if (pageId === 'page-reports-product') {
        if(!document.getElementById('tglMulai').value) {
            document.getElementById('tglMulai').value = today;
            document.getElementById('tglAkhir').value = today;
        }
        muatTabelBarang();
    }
    if (pageId === 'page-reports-bestseller') {
        if(!document.getElementById('tglBestSellerMulai').value) {
            const firstDay = new Date();
            firstDay.setDate(1);
            document.getElementById('tglBestSellerMulai').value = firstDay.toISOString().split('T')[0];
            document.getElementById('tglBestSellerAkhir').value = today;
        }
        muatLaporanBestSeller();
    }
    if (pageId === 'page-reports-outlet') {
        if(!document.getElementById('tglOutletMulai').value) {
            document.getElementById('tglOutletMulai').value = today;
            document.getElementById('tglOutletAkhir').value = today;
        }
        muatLaporanOutlet();
    }
    if (pageId === 'page-reports-compare') {
        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        if(!document.getElementById('cmpStart1').value) {
            document.getElementById('cmpStart1').value = lastMonth.toISOString().split('T')[0];
            document.getElementById('cmpEnd1').value = lastMonth.toISOString().split('T')[0];
            document.getElementById('cmpStart2').value = today;
            document.getElementById('cmpEnd2').value = today;
        }
        muatLaporanCompare();
    }
    if (pageId === 'page-reports-daily') {
        const todayDate = new Date();
        const firstDay = new Date(todayDate.setDate(todayDate.getDate() - todayDate.getDay() + 1));
        const lastDay = new Date(todayDate.setDate(todayDate.getDate() - todayDate.getDay() + 7));
        if(!document.getElementById('tglDailyMulai').value) {
            document.getElementById('tglDailyMulai').value = firstDay.toISOString().split('T')[0];
            document.getElementById('tglDailyAkhir').value = lastDay.toISOString().split('T')[0];
        }
        muatLaporanDaily();
    }
    if (pageId === 'page-reports-monthly') {
        const todayDate = new Date();
        const firstDay = new Date(todayDate.getFullYear(), 0, 1);
        if(!document.getElementById('tglMonthlyMulai').value) {
            document.getElementById('tglMonthlyMulai').value = firstDay.toISOString().split('T')[0];
            document.getElementById('tglMonthlyAkhir').value = todayDate.toISOString().split('T')[0];
        }
        muatLaporanMonthly();
    }
}

// FUNGSI BARU UNTUK PINDAH TAB LAPORAN (100% WORK)
function bukaTab(pageId, tabId) {
    // Sembunyikan semua halaman dan hapus warna biru dari semua tab
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu a').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.reports-tab').forEach(el => el.classList.remove('active'));
    
    // Tampilkan halaman yang dituju
    document.getElementById(pageId).classList.add('active');
    
    // Nyalakan menu sidebar Reports
    document.getElementById('menu-reports').classList.add('active');
    
    // Nyalakan tab yang diklik
    document.getElementById(tabId).classList.add('active');
    // ID tab dipakai di setiap halaman laporan; sorot juga tab milik halaman yang sedang tampil
    document.querySelectorAll('#' + pageId + ' #' + tabId).forEach(el => el.classList.add('active'));
}
// DATA BARANG & SEARCH & PAGINATION
let semuaDataBarang = [];
let dataBarangFiltered = []; 
let halamanSekarang = 1;
let limitPerHalaman = 50;

async function muatTabelBarang() {
    const res = await apiFetch('/barang');
    if (!res || !res.data) return;
    semuaDataBarang = res.data;
    filterTabelBarang();
}

function filterTabelBarang() {
    const keyword = document.getElementById('searchBarang').value.toLowerCase();
    dataBarangFiltered = semuaDataBarang.filter(b => 
        b.sku.toLowerCase().includes(keyword) || b.artikel.toLowerCase().includes(keyword)
    );
    halamanSekarang = 1;
    renderTabelBarang();
}

function ubahLimitBarang() {
    limitPerHalaman = parseInt(document.getElementById('limitBarang').value);
    halamanSekarang = 1;
    renderTabelBarang();
}

function pindahHalaman(halaman) {
    halamanSekarang = halaman;
    renderTabelBarang();
}

function renderTabelBarang() {
    const tbody = document.getElementById('tabelDataBarang');
    const totalData = dataBarangFiltered.length;
    const totalHalaman = Math.ceil(totalData / limitPerHalaman) || 1;
    
    if (halamanSekarang > totalHalaman) halamanSekarang = totalHalaman;
    if (halamanSekarang < 1) halamanSekarang = 1;

    const startIndex = (halamanSekarang - 1) * limitPerHalaman;
    const endIndex = startIndex + limitPerHalaman;
    const dataDitampilkan = dataBarangFiltered.slice(startIndex, endIndex);

    if (dataDitampilkan.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="row-note">BARANG TIDAK DITEMUKAN</td></tr>';
    } else {
        const isAdmin = getUser().role === 'admin';
        
        tbody.innerHTML = dataDitampilkan.map(b => {
            const hppFormat = (b.hpp || 0).toLocaleString('id-ID');
            
            return `
            <tr>
                <td class="sku"><strong>${b.sku}</strong></td>
                <td>${b.artikel}</td>
                <td>${b.kategori || '-'}</td>
                <td><span class="badge badge-size">${b.size !== '-' ? b.size : '-'}</span></td>
                
                <td>
                    <div class="stepper">
                        ${isAdmin ? `<button class="btn btn-secondary btn-sm" onclick="ubahStok(${b.id}, ${b.stok - 1})">-</button>` : ''}
                        <strong>${b.stok}</strong>
                        ${isAdmin ? `<button class="btn btn-secondary btn-sm" onclick="ubahStok(${b.id}, ${b.stok + 1})">+</button>` : ''}
                    </div>
                </td>
                
                <td>
                    ${isAdmin ? `
                        <div class="hpp-edit">
                            <span>Rp</span>
                            <input type="text" value="${hppFormat}" oninput="formatInputRupiah(this)" onchange="ubahHpp(${b.id}, this.value)">
                        </div>
                    ` : `Rp ${hppFormat}`}
                </td>

                <td>
                    ${isAdmin ? `<button class="btn btn-danger btn-sm" onclick="hapusBarang(${b.id})">HAPUS</button>` : `<span class="no-access">TANPA AKSES</span>`}
                </td>
            </tr>
        `}).join('');
    }

    const paginationDiv = document.getElementById('paginationBarang');
    let tombolHtml = '';
    tombolHtml += `<button class="btn btn-secondary btn-sm" onclick="pindahHalaman(${halamanSekarang - 1})" ${halamanSekarang === 1 ? 'disabled' : ''}>&laquo; PREV</button>`;
    let startPage = Math.max(1, halamanSekarang - 2);
    let endPage = Math.min(totalHalaman, startPage + 4);
    if (endPage - startPage < 4) startPage = Math.max(1, endPage - 4);
    for (let i = startPage; i <= endPage; i++) {
        let activeClass = i === halamanSekarang ? 'btn-primary' : 'btn-secondary';
        tombolHtml += `<button class="btn ${activeClass} btn-sm" onclick="pindahHalaman(${i})">${i}</button>`;
    }
    tombolHtml += `<button class="btn btn-secondary btn-sm" onclick="pindahHalaman(${halamanSekarang + 1})" ${halamanSekarang === totalHalaman ? 'disabled' : ''}>NEXT &raquo;</button>`;
    paginationDiv.innerHTML = tombolHtml;
}

async function hapusBarang(id) {
    if (!confirm('YAKIN INGIN MENGHAPUS BARANG INI?')) return;
    const res = await apiFetch(`/barang/${id}`, { method: 'DELETE' });
    if (res && res.success) { muatTabelBarang(); muatDashboard(); }
}

async function ubahHpp(id, nilai) {
    const angkaBersih = parseInt(nilai.replace(/\./g, '')) || 0;
    const res = await apiFetch(`/barang/${id}/hpp`, { method: 'PUT', body: JSON.stringify({ hpp: angkaBersih }) });
    if (!res || !res.success) { alert('GAGAL MENGUBAH HPP'); muatTabelBarang(); }
}

async function ubahStok(id, stokBaru) {
    if (stokBaru < 0) return alert('STOK TIDAK BOLEH MINUS!');
    const res = await apiFetch(`/barang/${id}/stok`, { method: 'PUT', body: JSON.stringify({ stok_baru: stokBaru }) });
    if (res && res.success) { muatTabelBarang(); muatDashboard(); } 
    else alert('GAGAL MENGUBAH STOK');
}

function formatInputRupiah(input) {
    let value = input.value.replace(/[^0-9]/g, ''); 
    if (value) {
        input.value = parseInt(value).toLocaleString('id-ID'); 
    } else {
        input.value = '';
    }
}

// LOGIKA SCAN
let keranjang = { masuk: [], 'return-masuk': [], keluar: [], 'return-keluar': [], affiliate: [], 'pengiriman-kilat': [], reseller: [] };

async function handleScan(event, tipe) {
    const dateMap = {
        'masuk': 'tglMasuk', 'return-masuk': 'tglReturnMasuk',
        'keluar': 'tglKeluar', 'return-keluar': 'tglReturnKeluar',
        'affiliate': 'tglAffiliate', 'pengiriman-kilat': 'tglPengirimanKilat', 'reseller': 'tglReseller'
    };
    
    const dateInput = document.getElementById(dateMap[tipe]);
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];

    if (event.key === 'Enter') {
        processScan(event.target.value.trim(), tipe, event.target);
        return;
    }
    
    clearTimeout(window.scanTimeout);
    window.scanTimeout = setTimeout(() => {
        const val = event.target.value.trim();
        if (val) processScan(val, tipe, event.target);
    }, 300);
}

async function processScan(sku, tipe, inputElement) {
    if (!sku) return;
    inputElement.value = '';

    const res = await apiFetch(`/barang/sku/${encodeURIComponent(sku)}`);
    if (res && res.success) {
        const b = res.data;
        const index = keranjang[tipe].findIndex(item => item.sku === b.sku);
        if (index !== -1) keranjang[tipe][index].qty += 1;
        else keranjang[tipe].push({ sku: b.sku, artikel: b.artikel, size: b.size, qty: 1 });
        renderScanList(tipe);
    } else {
        alert('SKU TIDAK DITEMUKAN DI DATA BARANG!');
    }
}

function renderScanList(tipe) {
    let formattedTipe = tipe.replace(/\b\w/g, l => l.toUpperCase()); 
    if (tipe === 'return-masuk') formattedTipe = 'Return-masuk';
    if (tipe === 'return-keluar') formattedTipe = 'Return-keluar';
    if (tipe === 'pengiriman-kilat') formattedTipe = 'Pengiriman-kilat';

    const ul = document.getElementById(`riwayatScan${formattedTipe}`);
    const data = keranjang[tipe];

    if (data.length === 0) {
        ul.innerHTML = '<li class="scan-empty">BELUM ADA BARANG DI-SCAN</li>';
        return;
    }

    ul.innerHTML = [...data].reverse().map((item, index) => {
        const realIndex = data.length - 1 - index;
        return `
            <li>
                <div class="scan-item-info">
                    <span class="scan-sku">${item.sku}</span>
                    <span class="scan-meta">${item.artikel} (SIZE: ${item.size !== '-' ? item.size : '-'})</span>
                </div>
                <div class="scan-item-actions">
                    <input type="number" class="qty-input" min="1" value="${item.qty}" onchange="ubahQty('${tipe}', ${realIndex}, this.value)">
                    <button class="btn-hapus-scan" onclick="hapusDariKeranjang('${tipe}', ${realIndex})" aria-label="HAPUS"><svg class="ico" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
            </li>
        `;
    }).join('');
}

function ubahQty(tipe, index, nilai) {
    const qtyBaru = parseInt(nilai);
    if (qtyBaru && qtyBaru > 0) keranjang[tipe][index].qty = qtyBaru;
    else { keranjang[tipe][index].qty = 1; renderScanList(tipe); }
}

function hapusDariKeranjang(tipe, index) {
    keranjang[tipe].splice(index, 1);
    renderScanList(tipe);
}

async function simpanKeranjang(tipe) {
    if (keranjang[tipe].length === 0) return alert('LIST MASIH KOSONG!');
    
    let subTipe = null;
    let labelConfirm = "";
    const dateMap = { 'masuk': 'tglMasuk', 'return-masuk': 'tglReturnMasuk', 'keluar': 'tglKeluar', 'return-keluar': 'tglReturnKeluar', 'affiliate': 'tglAffiliate', 'pengiriman-kilat': 'tglPengirimanKilat', 'reseller': 'tglReseller' };
    
    const tanggalInput = document.getElementById(dateMap[tipe]);
    const tanggalTransaksi = tanggalInput ? tanggalInput.value : new Date().toISOString().split('T')[0];
    if (!tanggalTransaksi) return alert('SILAKAN ISI TANGGAL TRANSAKSI TERLEBIH DAHULU!');

    if (tipe === 'keluar') { subTipe = document.getElementById('marketplaceKeluar').value; labelConfirm = `MARKETPLACE ${subTipe}`; } 
    else if (tipe === 'masuk') { subTipe = document.getElementById('vendorMasuk').value; labelConfirm = `VENDOR ${subTipe}`; } 
    else if (tipe === 'return-masuk') { subTipe = document.getElementById('alasanReturnMasuk').value; labelConfirm = `ALASAN ${subTipe}`; } 
    else if (tipe === 'return-keluar') { subTipe = document.getElementById('alasanReturnKeluar').value; labelConfirm = `ALASAN ${subTipe}`; } 
    else if (tipe === 'reseller') { subTipe = document.getElementById('resellerTujuan').value; labelConfirm = `RESELLER ${subTipe}`; } 
    else if (tipe === 'affiliate') {
        const selAff = document.getElementById('affiliateTujuan');
        subTipe = (selAff && selAff.options.length) ? selAff.value : null;
        labelConfirm = subTipe ? `AFFILIATE ${subTipe}` : 'AFFILIATE';
    }
    else if (tipe === 'pengiriman-kilat') { subTipe = 'SHOPEE'; labelConfirm = 'PENGIRIMAN KILAT (SHOPEE)'; }
    else { labelConfirm = tipe; }

    if (!subTipe && !['affiliate', 'pengiriman-kilat'].includes(tipe)) return alert('PILIHAN RINCIAN KOSONG. TAMBAHKAN DULU LEWAT MODE DEVELOPER.');

    if (!confirm(`SIMPAN TRANSAKSI ${labelConfirm} DENGAN TANGGAL ${tanggalTransaksi}?`)) return;

    const dataKirim = keranjang[tipe].map(item => ({
        sku: item.sku, tipe: tipe, jumlah: item.qty, sub_tipe: subTipe, marketplace: subTipe, tanggal_transaksi: tanggalTransaksi
    }));

    try {
        for (let item of dataKirim) {
            const res = await apiFetch('/transaksi', { method: 'POST', body: JSON.stringify(item) });
            if (!res.success) throw new Error(res.message);
        }
        alert('SEMUA TRANSAKSI BERHASIL DISIMPAN!');
        keranjang[tipe] = []; 
        renderScanList(tipe);
        muatDashboard();
        muatTabelBarang();
    } catch (err) {
        alert('GAGAL MENYIMPAN: ' + String(err.message).toUpperCase());
    }
}

// RINCIAN (VENDOR, MARKETPLACE, DLL) - DIAMBIL DARI DATABASE
let rincianCache = { masuk: [], 'return-masuk': [], keluar: [], 'return-keluar': [], affiliate: [], reseller: [] };
let dashboardRincian = null;

function esc(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function muatRincian() {
    const res = await apiFetch('/rincian');
    if (!res || !res.success) return;
    rincianCache = res.data;
    isiSelectRincian();
}

function isiSelectRincian() {
    const peta = {
        'masuk': 'vendorMasuk', 'return-masuk': 'alasanReturnMasuk', 'keluar': 'marketplaceKeluar',
        'return-keluar': 'alasanReturnKeluar', 'reseller': 'resellerTujuan', 'affiliate': 'affiliateTujuan'
    };
    Object.entries(peta).forEach(([grup, selId]) => {
        const sel = document.getElementById(selId);
        if (!sel) return;
        const lama = sel.value;
        sel.innerHTML = (rincianCache[grup] || []).map(r => `<option value="${esc(r.nama)}">${esc(r.nama)}</option>`).join('');
        if ([...sel.options].some(o => o.value === lama)) sel.value = lama;
    });
    // Affiliate: kolom pilihan hanya tampil kalau sudah ada rincian
    const fieldAff = document.getElementById('fieldAffiliate');
    if (fieldAff) fieldAff.style.display = (rincianCache.affiliate || []).length ? '' : 'none';
}

// MODE DEVELOPER (HANYA ADMIN)
function isDevMode() { return getUser().role === 'admin' && localStorage.getItem('wms_devmode') === '1'; }

function toggleDevMode() {
    localStorage.setItem('wms_devmode', isDevMode() ? '0' : '1');
    terapkanDevMode();
    renderPanelRincian();
}

function terapkanDevMode() {
    const on = isDevMode();
    const st = document.getElementById('devModeState');
    const bn = document.getElementById('devBanner');
    if (st) { st.textContent = on ? 'ON' : 'OFF'; st.classList.toggle('on', on); }
    if (bn) bn.style.display = on ? 'block' : 'none';
}

async function refreshSetelahUbahRincian() {
    await muatRincian();
    await muatDashboard();
}

async function tambahRincian(grup) {
    const label = grup === 'masuk' ? 'NAMA VENDOR BARU (AWALAN "VENDOR" OTOMATIS):' : 'NAMA RINCIAN BARU:';
    const nama = prompt(label);
    if (nama === null) return;
    if (!nama.trim()) return alert('NAMA TIDAK BOLEH KOSONG!');
    const res = await apiFetch('/rincian', { method: 'POST', body: JSON.stringify({ grup, nama }) });
    if (res && res.success) refreshSetelahUbahRincian();
    else alert('GAGAL: ' + String(res?.message || 'TERJADI KESALAHAN').toUpperCase());
}

async function editRincian(id) {
    const item = Object.values(rincianCache).flat().find(r => r.id === id);
    if (!item) return;
    const nama = prompt('UBAH NAMA RINCIAN (TRANSAKSI LAMA IKUT BERUBAH):', item.nama);
    if (nama === null || nama.trim() === '' || nama.trim().toUpperCase() === item.nama) return;
    const res = await apiFetch(`/rincian/${id}`, { method: 'PUT', body: JSON.stringify({ nama }) });
    if (res && res.success) refreshSetelahUbahRincian();
    else alert('GAGAL: ' + String(res?.message || 'TERJADI KESALAHAN').toUpperCase());
}

async function hapusRincian(id) {
    const item = Object.values(rincianCache).flat().find(r => r.id === id);
    if (!item) return;
    if (!confirm(`HAPUS RINCIAN "${item.nama}"?\n\nRINCIAN HILANG DARI DASHBOARD DAN PILIHAN SCAN. RIWAYAT TRANSAKSI LAMA TIDAK DIHAPUS.`)) return;
    const res = await apiFetch(`/rincian/${id}`, { method: 'DELETE' });
    if (res && res.success) refreshSetelahUbahRincian();
    else alert('GAGAL MENGHAPUS RINCIAN');
}

// PANEL RINCIAN DI DASHBOARD
const PANEL_RINCIAN = [
    { grup: 'keluar', judul: 'RINCIAN BARANG KELUAR MARKETPLACE', tone: 'red', span: false },
    { grup: 'reseller', judul: 'RINCIAN RESSELER', tone: 'teal', span: false },
    { grup: 'return-masuk', judul: 'RINCIAN RETURN MASUK', tone: 'amber', span: false },
    { grup: 'return-keluar', judul: 'RINCIAN RETURN KELUAR', tone: 'orange', span: false },
    { grup: 'affiliate', judul: 'RINCIAN AFFILIATE', tone: 'violet', span: true },
    { grup: 'masuk', judul: 'RINCIAN BARANG MASUK VENDOR', tone: 'green', span: true }
];

function renderPanelRincian() {
    const box = document.getElementById('panelRincian');
    if (!box || !dashboardRincian) return;
    const dev = isDevMode();

    box.innerHTML = PANEL_RINCIAN.map(p => {
        const daftar = dashboardRincian[p.grup] || [];
        if (!daftar.length && !dev) return '';   // panel kosong disembunyikan (kecuali mode developer)

        const kartu = daftar.map(r => {
            const nama = p.grup === 'masuk' ? r.nama.replace(/^VENDOR\s+/, '') : r.nama;
            return `
            <div class="metric">
                <h3>${esc(nama)}</h3>
                <div class="value">${(r.total || 0).toLocaleString('id-ID')}</div>
                ${dev ? `<div class="metric-actions">
                    <button type="button" class="btn-mini" onclick="editRincian(${r.id})">EDIT</button>
                    <button type="button" class="btn-mini danger" onclick="hapusRincian(${r.id})">HAPUS</button>
                </div>` : ''}
            </div>`;
        }).join('');

        const kosong = !daftar.length ? '<p class="panel-empty">BELUM ADA RINCIAN. KLIK + TAMBAH.</p>' : '';
        return `
        <div class="panel tone-${p.tone}${p.span ? ' span-2' : ''}">
            <div class="panel-head">
                <h3>${p.judul}</h3>
                ${dev ? `<button type="button" class="btn-mini add" onclick="tambahRincian('${p.grup}')">+ TAMBAH</button>` : ''}
            </div>
            <div class="metric-grid">${kartu}</div>
            ${kosong}
        </div>`;
    }).join('');
}

// DASHBOARD REKAP
async function muatDashboard() {
    const start = document.getElementById('tglMulai').value;
    const end = document.getElementById('tglAkhir').value;
    let url = '/dashboard-rekap';
    if (start && end) url += `?start=${start}&end=${end}`;

    const res = await apiFetch(url);
    if (res && res.success) {
        const d = res.data;
        document.getElementById('rekStokTotal').textContent = d.stok_total;
        document.getElementById('rekTotalAset').textContent = 'Rp ' + (d.total_aset || 0).toLocaleString('id-ID');
        document.getElementById('rekMasuk').textContent = d.masuk;
        document.getElementById('rekKeluar').textContent = d.keluar;
        document.getElementById('rekReturnMasuk').textContent = d.return_masuk;
        document.getElementById('rekReturnKeluar').textContent = d.return_keluar;
        document.getElementById('rekAffiliate').textContent = d.affiliate;
        document.getElementById('rekKilat').textContent = d.pengiriman_kilat;

        dashboardRincian = d.rincian;
        renderPanelRincian();
    }
}

// LAPORAN OUTLET
async function muatLaporanOutlet() {
    const start = document.getElementById('tglOutletMulai').value;
    const end = document.getElementById('tglOutletAkhir').value;
    const tbody = document.getElementById('tabelOutlet');
    const tfoot = document.getElementById('footerOutlet');

    if (!start || !end) return alert('PILIH TANGGAL MULAI DAN AKHIR!');

    tbody.innerHTML = '<tr><td colspan="4" class="row-note">MEMUAT DATA...</td></tr>';
    tfoot.style.display = 'none';

    const res = await apiFetch(`/laporan-outlet?start=${start}&end=${end}`);
    
    if (res && res.success) {
        const data = res.data;
        // Daftar marketplace mengikuti rincian terbaru, ditambah data lama yang rinciannya sudah dihapus
        const listMarketplace = [...(rincianCache.keluar || []), ...(rincianCache.reseller || [])].map(r => r.nama);
        data.forEach(d => { if (d.marketplace && !listMarketplace.includes(d.marketplace)) listMarketplace.push(d.marketplace); });
        
        let html = '';
        let grandTotalQty = 0;
        let grandTotalHpp = 0;

        listMarketplace.forEach((market, index) => {
            const found = data.find(d => d.marketplace === market);
            const qty = found ? found.total_qty : 0;
            const hpp = found ? found.total_hpp : 0;

            grandTotalQty += qty;
            grandTotalHpp += hpp;

            html += `
                <tr>
                    <td class="ta-c">${index + 1}</td>
                    <td><strong>${market}</strong></td>
                    <td class="ta-r num">${qty.toLocaleString('id-ID')}</td>
                    <td class="ta-r num">Rp ${hpp.toLocaleString('id-ID')}</td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
        
        tfoot.style.display = 'table-footer-group';
        document.getElementById('totalOutletQty').textContent = grandTotalQty.toLocaleString('id-ID');
        document.getElementById('totalOutletHpp').textContent = 'Rp ' + grandTotalHpp.toLocaleString('id-ID');

    } else {
        tbody.innerHTML = '<tr><td colspan="4" class="row-note is-error">GAGAL MEMUAT DATA</td></tr>';
    }
}

// LAPORAN COMPARE
async function muatLaporanCompare() {
    const start1 = document.getElementById('cmpStart1').value;
    const end1 = document.getElementById('cmpEnd1').value;
    const start2 = document.getElementById('cmpStart2').value;
    const end2 = document.getElementById('cmpEnd2').value;

    if (!start1 || !end1 || !start2 || !end2) return alert('LENGKAPI SEMUA TANGGAL!');

    const formatTgl = (tgl) => new Date(tgl).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
    document.getElementById('headerDate1').textContent = `${formatTgl(start1)} - ${formatTgl(end1)}`;
    document.getElementById('headerDate2').textContent = `${formatTgl(start2)} - ${formatTgl(end2)}`;

    document.getElementById('cmpQty1').textContent = '...';
    document.getElementById('cmpQty2').textContent = '...';
    document.getElementById('cmpRevenue').textContent = '...';
    document.getElementById('cmpRevenue').style.color = 'inherit';

    try {
        const res = await apiFetch(`/laporan-compare?start1=${start1}&end1=${end1}&start2=${start2}&end2=${end2}`);
        
        if (res && res.success) {
            const qty1 = res.data.qty1;
            const qty2 = res.data.qty2;

            document.getElementById('cmpQty1').textContent = qty1.toLocaleString('id-ID');
            document.getElementById('cmpQty2').textContent = qty2.toLocaleString('id-ID');

            let persentase = 0;
            let warna = 'inherit';

            if (qty1 === 0 && qty2 > 0) {
                persentase = 100; 
                warna = '#10b981'; 
            } else if (qty1 > 0 && qty2 === 0) {
                persentase = -100; 
                warna = '#ef4444'; 
            } else if (qty1 > 0 && qty2 > 0) {
                persentase = ((qty2 - qty1) / qty1) * 100;
                warna = persentase >= 0 ? '#10b981' : '#ef4444'; 
            }

            const arrow = persentase > 0 ? '▲' : (persentase < 0 ? '▼' : '-');
            const displayPersen = Math.abs(persentase).toFixed(1) + '%';

            document.getElementById('cmpRevenue').textContent = `${arrow} ${displayPersen}`;
            document.getElementById('cmpRevenue').style.color = warna;

        } else {
            alert('GAGAL MEMUAT DATA PERBANDINGAN');
        }
    } catch (err) {
        console.error(err);
        alert('TERJADI KESALAHAN SAAT MEMUAT DATA');
    }
}

// LAPORAN DAILY
async function muatLaporanDaily() {
    const start = document.getElementById('tglDailyMulai').value;
    const end = document.getElementById('tglDailyAkhir').value;
    const tbody = document.getElementById('tabelDaily');

    if (!start || !end) return alert('PILIH TANGGAL MULAI DAN AKHIR!');

    tbody.innerHTML = '<tr><td colspan="3" class="row-note">MEMUAT DATA...</td></tr>';

    try {
        const res = await apiFetch(`/laporan-daily?start=${start}&end=${end}`);
        
        if (res && res.success) {
            const data = res.data;
            let html = '';
            let currentDate = new Date(start);
            let endDate = new Date(end);
            const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            
            for (let d = new Date(currentDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                const dayName = days[d.getDay()];
                const dateNum = d.getDate();
                
                const found = data.find(item => item.tanggal === dateStr);
                const qty = found ? found.total_qty : 0;

                html += `
                    <tr>
                        <td class="ta-c num">${dateNum}</td>
                        <td class="ta-c">${dayName}</td>
                        <td class="ta-c num"><strong>${qty}</strong></td>
                    </tr>
                `;
            }
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = '<tr><td colspan="3" class="row-note is-error">GAGAL MEMUAT DATA</td></tr>';
        }
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="3" class="row-note is-error">TERJADI KESALAHAN</td></tr>';
    }
}

// LAPORAN MONTHLY
async function muatLaporanMonthly() {
    const start = document.getElementById('tglMonthlyMulai').value;
    const end = document.getElementById('tglMonthlyAkhir').value;
    const tbody = document.getElementById('tabelMonthly');

    if (!start || !end) return alert('PILIH TANGGAL MULAI DAN AKHIR!');

    tbody.innerHTML = '<tr><td colspan="2" class="row-note">MEMUAT DATA...</td></tr>';

    try {
        const res = await apiFetch(`/laporan-monthly?start=${start}&end=${end}`);
        
        if (res && res.success) {
            const data = res.data;
            const namaBulan = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            let html = '';
            let currentDate = new Date(start);
            let endDate = new Date(end);
            
            while (currentDate <= endDate) {
                const year = currentDate.getFullYear();
                const month = String(currentDate.getMonth() + 1).padStart(2, '0');
                const monthStr = `${year}-${month}`;
                const monthName = namaBulan[currentDate.getMonth()];
                const found = data.find(item => item.bulan === monthStr);
                const qty = found ? found.total_qty : 0;

                html += `
                    <tr>
                        <td class="ta-c">${monthName}</td>
                        <td class="ta-c num"><strong>${qty}</strong></td>
                    </tr>
                `;
                currentDate.setMonth(currentDate.getMonth() + 1);
            }
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = '<tr><td colspan="2" class="row-note is-error">GAGAL MEMUAT DATA</td></tr>';
        }
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="2" class="row-note is-error">TERJADI KESALAHAN</td></tr>';
    }
}

// LAPORAN BEST SELLER
async function muatLaporanBestSeller() {
    const start = document.getElementById('tglBestSellerMulai').value;
    const end = document.getElementById('tglBestSellerAkhir').value;
    const tbody = document.getElementById('tabelBestSeller');

    if (!start || !end) return alert('PILIH TANGGAL MULAI DAN AKHIR!');

    tbody.innerHTML = '<tr><td colspan="3" class="row-note">MEMUAT DATA...</td></tr>';

    try {
        const res = await apiFetch(`/laporan-bestseller?start=${start}&end=${end}`);
        
        if (res && res.success) {
            const data = res.data;
            
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" class="row-note">BELUM ADA DATA PENJUALAN PADA PERIODE INI.</td></tr>';
                return;
            }

            let html = '';
            data.forEach((item, index) => {
                let namaLengkap = item.artikel;
                if (item.size && item.size !== '-') {
                    namaLengkap += ` (SIZE ${item.size})`;
                }

                html += `
                    <tr>
                        <td class="ta-c num"><strong>${index + 1}</strong></td>
                        <td class="ta-l">${namaLengkap}</td>
                        <td class="ta-r num accent-text">${item.total_qty.toLocaleString('id-ID')}</td>
                    </tr>
                `;
            });
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = '<tr><td colspan="3" class="row-note is-error">GAGAL MEMUAT DATA</td></tr>';
        }
    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="3" class="row-note is-error">TERJADI KESALAHAN</td></tr>';
    }
}

// MODALS
function openModalImport() { document.getElementById('modalImport').classList.add('active'); document.getElementById('importResult').style.display='none'; }
function closeModalImport() { document.getElementById('modalImport').classList.remove('active'); }
function openModalSO() { document.getElementById('modalSO').classList.add('active'); document.getElementById('soResult').style.display='none'; }
function closeModalSO() { document.getElementById('modalSO').classList.remove('active'); }
function openModalTambah() { document.getElementById('modalTambah').classList.add('active'); }
function closeModalTambah() { document.getElementById('modalTambah').classList.remove('active'); }
function openModalUser() { document.getElementById('modalUser').classList.add('active'); document.getElementById('userBaruUsername').value=''; document.getElementById('userBaruPassword').value=''; document.getElementById('userBaruRole').value='staff'; }
function closeModalUser() { document.getElementById('modalUser').classList.remove('active'); }

async function uploadCsv() {
    const file = document.getElementById('fileCsv').files[0];
    const resultDiv = document.getElementById('importResult');
    const btnUpload = document.getElementById('btnUpload');
    if (!file) return alert('PILIH FILE EXCEL!');
    const formData = new FormData(); formData.append('file', file);
    btnUpload.disabled = true; btnUpload.textContent = 'MEMPROSES...'; resultDiv.style.display = 'none';
    try {
        const res = await fetch(`${API_URL}/import-csv`, { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` }, body: formData });
        const data = await res.json();
        resultDiv.style.display = 'block'; resultDiv.className = 'result-box ' + (data.success ? 'ok' : 'err');
        resultDiv.innerHTML = `<strong>${data.success ? 'BERHASIL:' : 'GAGAL:'} ${data.message}</strong>`;
        muatTabelBarang(); muatDashboard();
    } catch (err) { resultDiv.className = 'result-box err'; resultDiv.style.display = 'block'; resultDiv.textContent = 'GAGAL MENGUNGGAH.'; }
    finally { btnUpload.disabled = false; btnUpload.textContent = 'UPLOAD & PROSES'; }
}

async function uploadSo() {
    const file = document.getElementById('fileSo').files[0];
    const resultDiv = document.getElementById('soResult');
    const btnUpload = document.getElementById('btnUploadSo');
    if (!file) return alert('PILIH FILE EXCEL!');
    const formData = new FormData(); formData.append('file', file);
    btnUpload.disabled = true; btnUpload.textContent = 'MENYINKRONKAN...'; resultDiv.style.display = 'none';
    try {
        const res = await fetch(`${API_URL}/upload-so`, { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` }, body: formData });
        const data = await res.json();
        resultDiv.style.display = 'block'; resultDiv.className = 'result-box ' + (data.success ? 'ok' : 'err');
        resultDiv.innerHTML = `<strong>${data.success ? 'BERHASIL:' : 'GAGAL:'} ${data.message}</strong>`;
        muatTabelBarang(); muatDashboard();
    } catch (err) { resultDiv.className = 'result-box err'; resultDiv.style.display = 'block'; resultDiv.textContent = 'GAGAL MENGUNGGAH.'; }
    finally { btnUpload.disabled = false; btnUpload.textContent = 'MULAI SINKRONISASI STOK'; }
}


// UPLOAD EXCEL TRANSAKSI (SEMUA HALAMAN TRANSAKSI MASUK & KELUAR)
const INFO_UPLOAD_TRX = {
    'masuk':            { judul: 'UPLOAD EXCEL BARANG MASUK',  kolom: 'TANGGAL, BARCODE, ARTIKEL, QTY, VENDOR', catatan: 'VENDOR CUKUP NAMANYA SAJA, MISAL: OYOD (OTOMATIS MENJADI VENDOR OYOD).' },
    'keluar':           { judul: 'UPLOAD EXCEL BARANG KELUAR', kolom: 'TANGGAL, BARCODE, ARTIKEL, QTY, MARKETPLACE', catatan: 'MARKETPLACE HARUS SUDAH TERDAFTAR, MISAL: SHOPEE, TIKTOK.' },
    'pengiriman-kilat': { judul: 'UPLOAD EXCEL PENGIRIMAN KILAT', kolom: 'TANGGAL, BARCODE, ARTIKEL, QTY', catatan: 'OTOMATIS TERCATAT SEBAGAI BARANG KELUAR SHOPEE.' },
    'return-masuk':     { judul: 'UPLOAD EXCEL RETURN MASUK',  kolom: 'TANGGAL, BARCODE, ARTIKEL, QTY, ASAL RETUR', catatan: 'ASAL RETUR HARUS SUDAH TERDAFTAR, MISAL: GAGAL COD.' },
    'return-keluar':    { judul: 'UPLOAD EXCEL RETURN KELUAR', kolom: 'TANGGAL, BARCODE, ARTIKEL, QTY, ASAL RETUR', catatan: 'ASAL RETUR HARUS SUDAH TERDAFTAR, MISAL: PERBAIKAN VENDOR.' },
    'affiliate':        { judul: 'UPLOAD EXCEL AFFILIATE',     kolom: 'TANGGAL, BARCODE, ARTIKEL, QTY', catatan: '' },
    'reseller':         { judul: 'UPLOAD EXCEL RESELLER',      kolom: 'TANGGAL, BARCODE, ARTIKEL, QTY, KETERANGAN', catatan: 'KETERANGAN = NAMA RESELLER YANG SUDAH TERDAFTAR, MISAL: JYF STAR.' }
};
let tipeUploadTrx = null;

function openModalUploadTrx(tipe) {
    tipeUploadTrx = tipe;
    const info = INFO_UPLOAD_TRX[tipe];
    document.getElementById('uploadTrxJudul').textContent = info.judul;
    document.getElementById('uploadTrxKolom').textContent = info.kolom;
    document.getElementById('uploadTrxCatatan').textContent = info.catatan;
    document.getElementById('fileUploadTrx').value = '';
    document.getElementById('uploadTrxResult').style.display = 'none';
    document.getElementById('modalUploadTrx').classList.add('active');
}
function closeModalUploadTrx() { document.getElementById('modalUploadTrx').classList.remove('active'); }

async function unduhTemplateTrx() {
    try {
        const res = await fetch(`${API_URL}/template-transaksi/${tipeUploadTrx}`, { headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error();
        const url = window.URL.createObjectURL(await res.blob());
        const a = document.createElement('a');
        a.href = url; a.download = `Template_${tipeUploadTrx}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { alert('GAGAL MENGUNDUH TEMPLATE'); }
}

async function uploadTransaksi() {
    const file = document.getElementById('fileUploadTrx').files[0];
    const box = document.getElementById('uploadTrxResult');
    const btn = document.getElementById('btnUploadTrx');
    if (!file) return alert('PILIH FILE EXCEL!');
    const formData = new FormData(); formData.append('file', file);
    btn.disabled = true; btn.textContent = 'MEMPROSES...'; box.style.display = 'none';
    try {
        const res = await fetch(`${API_URL}/upload-transaksi/${tipeUploadTrx}`, { method: 'POST', headers: { 'Authorization': `Bearer ${getToken()}` }, body: formData });
        if (res.status === 401) { localStorage.clear(); window.location.href = 'index.html'; return; }
        const data = await res.json();
        const daftar = (judul, arr, total) => arr && arr.length
            ? `<ul style="margin:8px 0 0 18px;line-height:1.6;">${arr.map(e => `<li>BARIS ${e.baris}: ${esc(e.pesan)}</li>`).join('')}</ul>` +
              (total > arr.length ? `<div style="margin-top:6px;">...DAN ${total - arr.length} LAINNYA</div>` : '') : '';
        box.style.display = 'block';
        box.className = 'result-box ' + (data.success ? 'ok' : 'err');
        box.innerHTML = `<strong>${data.success ? 'BERHASIL:' : 'GAGAL:'} ${esc(data.message || '')}</strong>`
            + (data.success
                ? (data.total_peringatan ? `<div style="margin-top:8px;">PERINGATAN (DATA TETAP TERSIMPAN):</div>${daftar('', data.peringatan, data.total_peringatan)}` : '')
                : daftar('', data.errors, data.total_error));
        if (data.success) {
            document.getElementById('fileUploadTrx').value = '';
            muatDashboard(); muatTabelBarang();
        }
    } catch (err) {
        box.className = 'result-box err'; box.style.display = 'block'; box.textContent = 'GAGAL MENGUNGGAH.';
    } finally { btn.disabled = false; btn.textContent = 'UPLOAD & SIMPAN'; }
}

// HAPUS SEMUA DATA (MODE DEVELOPER)
function openModalResetData() {
    document.getElementById('resetKonfirmasi').value = '';
    document.getElementById('resetHapusBarang').checked = false;
    document.getElementById('resetResult').style.display = 'none';
    document.getElementById('modalReset').classList.add('active');
}
function closeModalResetData() { document.getElementById('modalReset').classList.remove('active'); }

async function resetSemuaData() {
    const box = document.getElementById('resetResult');
    const btn = document.getElementById('btnReset');
    if (document.getElementById('resetKonfirmasi').value.trim().toUpperCase() !== 'HAPUS SEMUA') return alert('KETIK "HAPUS SEMUA" DENGAN BENAR UNTUK MELANJUTKAN!');
    const hapusBarang = document.getElementById('resetHapusBarang').checked;
    if (!confirm(hapusBarang ? 'YAKIN? SEMUA TRANSAKSI DAN DATA BARANG AKAN DIHAPUS PERMANEN!' : 'YAKIN? SEMUA TRANSAKSI AKAN DIHAPUS DAN STOK DIRESET KE 0!')) return;
    btn.disabled = true; btn.textContent = 'MENGHAPUS...';
    try {
        const res = await apiFetch('/reset-data', { method: 'POST', body: JSON.stringify({ konfirmasi: 'HAPUS SEMUA', hapus_barang: hapusBarang }) });
        if (!res) return;
        box.style.display = 'block'; box.className = 'result-box ' + (res.success ? 'ok' : 'err');
        box.innerHTML = `<strong>${res.success ? 'BERHASIL:' : 'GAGAL:'} ${esc(res.message || '')}</strong>`;
        if (res.success) { muatDashboard(); muatTabelBarang(); }
    } catch (err) {
        box.className = 'result-box err'; box.style.display = 'block'; box.textContent = 'GAGAL MENGHAPUS DATA.';
    } finally { btn.disabled = false; btn.textContent = 'HAPUS SEMUA DATA'; }
}

// EXPORT EXCEL
async function exportExcel() {
    try {
        const res = await fetch(`${API_URL}/export-excel`, { method: 'GET', headers: { 'Authorization': `Bearer ${getToken()}` } });
        if (!res.ok) throw new Error('Gagal export');
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Laporan_Stok_JYF_${new Date().toISOString().split('T')[0]}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove();
    } catch (err) { alert('GAGAL MENGUNDUH LAPORAN EXCEL'); }
}

// MANAJEMEN USER (ADMIN)
async function muatTabelUsers() {
    const res = await apiFetch('/users');
    const tbody = document.getElementById('tabelUsers');
    if (!res || !res.data) return;

    tbody.innerHTML = res.data.map(u => {
        const roleClass = u.role === 'admin' ? 'badge-admin' : 'badge-staff';
        const roleText = u.role === 'admin' ? 'ADMIN' : 'STAFF';
        return `
        <tr>
            <td class="num"><strong>#${u.id}</strong></td>
            <td>${u.username}</td>
            <td><span class="badge ${roleClass}">${roleText}</span></td>
            <td>
                ${u.username === getUser().username 
                    ? '<span class="no-access">(AKUN ANDA)</span>' 
                    : `<button class="btn btn-danger btn-sm" onclick="hapusUser(${u.id}, '${u.username}')">HAPUS</button>`}
            </td>
        </tr>
    `}).join('');
}

async function simpanUser() {
    const data = {
        username: document.getElementById('userBaruUsername').value.trim(),
        password: document.getElementById('userBaruPassword').value,
        role: document.getElementById('userBaruRole').value
    };
    if (!data.username || !data.password) return alert('USERNAME DAN PASSWORD WAJIB DIISI!');

    const res = await apiFetch('/users', { method: 'POST', body: JSON.stringify(data) });
    if (res && res.success) {
        alert('AKUN BERHASIL DIBUAT!');
        closeModalUser();
        muatTabelUsers();
    } else {
        alert('GAGAL: ' + String(res?.message || 'USERNAME MUNGKIN SUDAH ADA').toUpperCase());
    }
}

async function hapusUser(id, username) {
    if (!confirm(`YAKIN INGIN MENGHAPUS AKUN "${username}"?`)) return;
    const res = await apiFetch(`/users/${id}`, { method: 'DELETE' });
    if (res && res.success) { muatTabelUsers(); } 
    else { alert('GAGAL MENGHAPUS AKUN'); }
}

// MANAJEMEN LOG AKTIVITAS
async function muatTabelLog() {
    const res = await apiFetch('/logs');
    const tbody = document.getElementById('tabelLog');
    
    if (!res || !res.data || res.data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="row-note">BELUM ADA AKTIVITAS</td></tr>'; return;
    }

    tbody.innerHTML = res.data.map(l => {
        let badgeClass = 'badge-log-def';
        
        if (l.aksi === 'TRANSAKSI') { badgeClass = 'badge-log-trx'; }
        else if (l.aksi === 'HAPUS BARANG' || l.aksi === 'HAPUS SEMUA DATA') { badgeClass = 'badge-log-del'; }
        else if (l.aksi === 'IMPORT EXCEL' || l.aksi === 'UPLOAD SO' || l.aksi === 'UPLOAD TRANSAKSI') { badgeClass = 'badge-log-imp'; }
        else if (l.aksi === 'TAMBAH RINCIAN' || l.aksi === 'EDIT RINCIAN') { badgeClass = 'badge-log-imp'; }
        else if (l.aksi === 'HAPUS RINCIAN') { badgeClass = 'badge-log-del'; }

        return `
        <tr>
            <td class="muted-text num">${new Date(l.created_at).toLocaleString('id-ID')}</td>
            <td><strong>${l.username}</strong></td>
            <td><span class="badge ${badgeClass}">${l.aksi}</span></td>
            <td>${l.keterangan}</td>
        </tr>
    `}).join('');
}

// FUNGSI SIMPAN PRODUK MANUAL
async function simpanProdukManual() {
    const data = {
        sku: document.getElementById('addSku').value.trim(),
        artikel: document.getElementById('addArtikel').value.trim(),
        kategori: document.getElementById('addKategori').value.trim(),
        size: document.getElementById('addSize').value.trim() || '-',
        stok: parseInt(document.getElementById('addStok').value) || 0,
        hpp: parseInt(document.getElementById('addHpp').value) || 0
    };

    if (!data.sku || !data.artikel) return alert('SKU DAN ARTIKEL WAJIB DIISI!');

    const res = await apiFetch('/barang', { method: 'POST', body: JSON.stringify(data) });
    if (res && res.success) {
        alert('PRODUK BERHASIL DITAMBAHKAN!');
        closeModalTambah();
        document.getElementById('addSku').value = '';
        document.getElementById('addArtikel').value = '';
        document.getElementById('addKategori').value = '';
        document.getElementById('addSize').value = '';
        document.getElementById('addStok').value = '0';
        document.getElementById('addHpp').value = '0';
        muatTabelBarang();
        muatDashboard();
    } else {
        alert('GAGAL: ' + String(res?.message || 'SKU MUNGKIN SUDAH ADA').toUpperCase());
    }
}

function logout() {
    if (confirm('YAKIN INGIN LOGOUT?')) {
        localStorage.removeItem('wms_token'); localStorage.removeItem('wms_user');
        window.location.href = 'index.html';
    }
}
