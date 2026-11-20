// TEMA TERANG / GELAP (PILIH MANUAL, TERSIMPAN DI BROWSER)
// Dimuat di <head> agar tema langsung terpasang sebelum halaman tampil (tanpa kedip).
(function () {
    var KEY = 'wms_theme';
    var saved = null;
    try { saved = localStorage.getItem(KEY); } catch (e) {}
    document.documentElement.setAttribute('data-theme', saved === 'dark' ? 'dark' : 'light');

    window.setTheme = function (mode) {
        mode = mode === 'dark' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', mode);
        try { localStorage.setItem(KEY, mode); } catch (e) {}
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', mode === 'dark' ? '#0c121a' : '#1858c9');
    };

    // MENU SAMPING PADA LAYAR KECIL
    window.toggleSidebar = function () { document.body.classList.toggle('nav-open'); };
    window.closeSidebar = function () { document.body.classList.remove('nav-open'); };

    document.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.sidebar-menu a')) window.closeSidebar();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') window.closeSidebar();
    });
})();
