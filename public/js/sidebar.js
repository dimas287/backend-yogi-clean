// ======================================================
// SIDEBAR & MEMBER SECTION LOGIC
// ======================================================

function setSidebarCollapsed(isCollapsed) {
  document.body.classList.toggle('member-sidebar-collapsed', !!isCollapsed);
  try { localStorage.setItem('memberSidebarCollapsed', isCollapsed ? '1' : '0'); } catch (e) {}
}

function toggleSidebar() {
  const collapsed = document.body.classList.contains('member-sidebar-collapsed');
  setSidebarCollapsed(!collapsed);
}

function setMemberOnlySectionVisible(isVisible) {
  const section = document.getElementById('memberOnlySection');
  if (!section) return;
  section.style.display = isVisible ? '' : 'none';
}

function setMemberLayoutVisible(isVisible) {
  const layout = document.getElementById('memberLayout');
  if (!layout) return;
  layout.style.display = isVisible ? '' : 'none';
  document.body.classList.toggle('member-sidebar-visible', !!isVisible);
}

function switchMemberSection(sectionName) {
  currentMemberSection = sectionName;

  const dashboardMain = document.getElementById('dashboardMainSection');
  const sectionData = document.getElementById('sectionData');
  const sectionLokasi = document.getElementById('sectionLokasi');
  const sectionSetting = document.getElementById('sectionSetting');

  if (dashboardMain) dashboardMain.style.display = sectionName === 'dashboard' ? '' : 'none';
  if (sectionData) sectionData.style.display = sectionName === 'data' ? '' : 'none';
  if (sectionLokasi) sectionLokasi.style.display = sectionName === 'lokasi' ? '' : 'none';
  if (sectionSetting) sectionSetting.style.display = sectionName === 'setting' ? '' : 'none';

  document.querySelectorAll('.member-nav-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.section === sectionName);
  });

  if (sectionName === 'data') loadMemberTable();
  if (sectionName === 'lokasi') loadMemberLocations();
}

function formatProfileDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('id-ID');
}

function updateSettingsPanel(profile) {
  const name = document.getElementById('settingName');
  const email = document.getElementById('settingEmail');
  const phone = document.getElementById('settingPhone');
  const department = document.getElementById('settingDepartment');
  const role = document.getElementById('settingRole');
  const uid = document.getElementById('settingUid');
  const createdAt = document.getElementById('settingCreatedAt');
  const lastLogin = document.getElementById('settingLastLogin');
  const lastActivity = document.getElementById('settingLastActivity');
  const lastIp = document.getElementById('settingLastIp');
  const editName = document.getElementById('settingEditName');
  const editPhone = document.getElementById('settingEditPhone');
  const editDepartment = document.getElementById('settingEditDepartment');
  const hint = document.getElementById('settingHint');

  if (name) name.textContent = profile?.name || '-';
  if (email) email.textContent = profile?.email || 'Guest';
  if (phone) phone.textContent = profile?.phone || '-';
  if (department) department.textContent = profile?.department || '-';
  if (role) role.textContent = profile?.role || 'guest';
  if (uid) uid.textContent = profile?.uid || '-';
  if (createdAt) createdAt.textContent = formatProfileDate(profile?.createdAt);
  if (lastLogin) lastLogin.textContent = formatProfileDate(profile?.lastLoginAt);
  if (lastActivity) lastActivity.textContent = formatProfileDate(profile?.lastActivityAt);
  if (lastIp) lastIp.textContent = profile?.lastActivityIp || profile?.lastLoginIp || '-';

  if (editName) editName.value = profile?.name || '';
  if (editPhone) editPhone.value = profile?.phone || '';
  if (editDepartment) editDepartment.value = profile?.department || '';

  if (hint) {
    hint.textContent = profile?.role === 'admin'
      ? 'Admin: dapat melihat, mengunduh, mengedit/hapus data, dan mengubah koordinat lokasi alat.'
      : 'User: dapat melihat data tabel dan mengunduh data. Edit/hapus data serta ubah koordinat hanya untuk admin.';
  }
}

function initSidebar() {
  const btnToggle = document.getElementById('btnToggleSidebar');
  if (btnToggle) btnToggle.onclick = () => toggleSidebar();

  document.querySelectorAll('.member-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section || 'dashboard';
      switchMemberSection(section);
    });
  });
}
