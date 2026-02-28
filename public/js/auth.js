// ======================================================
// AUTH & ADMIN LOGIC
// ======================================================

function setAuthMessage(message, isError = false) {
  const el = document.getElementById('authMessage');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#ef4444' : '#64748b';
}

function setAdminMessage(message, isError = false) {
  const el = document.getElementById('adminMessage');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#ef4444' : '#64748b';
}

function setSettingProfileMessage(message, isError = false) {
  const el = document.getElementById('settingProfileMessage');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#ef4444' : '#64748b';
}

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('id-ID');
}

function formatAuthError(error) {
  if (!error) return 'Terjadi kesalahan autentikasi';
  if (error.code === 'auth/user-disabled') {
    return 'Akun belum disetujui admin atau sedang dinonaktifkan.';
  }
  if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
    return 'Email atau password salah.';
  }
  if (error.code === 'auth/user-not-found') {
    return 'Akun tidak ditemukan.';
  }
  if (error.code === 'auth/too-many-requests') {
    return 'Terlalu banyak percobaan login. Coba lagi nanti.';
  }
  return error.message || 'Terjadi kesalahan autentikasi';
}

function setAuthModalVisible(isVisible) {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  modal.style.display = isVisible ? 'flex' : 'none';
}

function setAdminModalVisible(isVisible) {
  const modal = document.getElementById('adminModal');
  if (!modal) return;
  modal.style.display = isVisible ? 'flex' : 'none';
}

function getFirebaseClientConfig() {
  const cfg = window.FIREBASE_CONFIG || {};
  return !!(cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) ? cfg : null;
}

function parseDevicesInput(rawDevices) {
  return (rawDevices || '').split(',').map(d => d.trim()).filter(Boolean);
}

function setSignupMode(isEnabled) {
  const signupExtraBlock = document.getElementById('signupExtraBlock');
  const btnEmailSignup = document.getElementById('btnEmailSignup');
  if (signupExtraBlock) signupExtraBlock.style.display = isEnabled ? 'block' : 'none';
  if (btnEmailSignup) btnEmailSignup.textContent = isEnabled ? 'Kirim Sign Up' : 'Sign Up';
}

function renderAdminUsers(users = []) {
  const tableBody = document.getElementById('adminUsersTableBody');
  if (!tableBody) return;

  if (!users.length) {
    tableBody.innerHTML = '<tr><td colspan="10" class="admin-empty">Belum ada data user</td></tr>';
    return;
  }

  tableBody.innerHTML = users.map((user) => {
    const deviceString = (user.devices || []).join(',');
    const approval = user.approvalStatus || (user.enabled !== false ? 'approved' : 'pending');
    const lastActivity = formatDateTime(user.lastActivityAt);
    const lastLogin = formatDateTime(user.lastLoginAt);
    const createdAt = formatDateTime(user.createdAt);
    return `
      <tr data-uid="${user.uid}">
        <td>
          <div>${user.displayName || '-'}</div>
          <div class="admin-meta-text">${user.phone || '-'}</div>
        </td>
        <td>${user.email || '-'}</td>
        <td>
          <select class="admin-inline-select" data-field="role">
            <option value="user" ${user.role === 'user' ? 'selected' : ''}>user</option>
            <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
          </select>
        </td>
        <td><span class="admin-approval-badge admin-approval-${approval}">${approval.toUpperCase()}</span></td>
        <td>
          <select class="admin-inline-select" data-field="enabled">
            <option value="true" ${user.enabled !== false ? 'selected' : ''}>enabled</option>
            <option value="false" ${user.enabled === false ? 'selected' : ''}>disabled</option>
          </select>
        </td>
        <td>
          <div>${lastActivity}</div>
          <div class="admin-meta-text">login: ${lastLogin}</div>
        </td>
        <td>${user.lastLoginIp || user.lastActivityIp || '-'}</td>
        <td>${createdAt}</td>
        <td>
          <input class="admin-inline-input" data-field="devices" value="${deviceString}" placeholder="device-a,device-b" />
        </td>
        <td>
          <div class="admin-action-group">
            <button type="button" class="location-bar-button" data-action="save">Simpan</button>
            <button type="button" class="location-bar-button" data-action="approve">Approve</button>
            <button type="button" class="location-bar-button" data-action="reject">Reject</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadAdminUsers() {
  try {
    const response = await apiFetch('/api/admin/users');
    if (response.status === 401 || response.status === 403) {
      setAdminMessage('Akses admin ditolak. Login admin diperlukan.', true);
      return;
    }
    if (!response.ok) throw new Error(`Load users failed: ${response.status}`);
    const payload = await response.json();
    renderAdminUsers(payload.users || []);
    setAdminMessage(`Loaded ${payload.users?.length || 0} user`);
  } catch (error) {
    console.error('Load admin users error:', error);
    setAdminMessage('Gagal memuat data user admin', true);
  }
}

async function updateAdminUserApproval(uid, action) {
  const response = await apiFetch(`/api/admin/users/${uid}/approval`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action })
  });

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.error || 'Gagal mengubah approval user');
  }
}

async function createAdminUserFromForm() {
  const email = document.getElementById('adminCreateEmail')?.value?.trim();
  const password = document.getElementById('adminCreatePassword')?.value || '';
  const name = document.getElementById('adminCreateName')?.value?.trim() || '';
  const role = document.getElementById('adminCreateRole')?.value || 'user';
  const devicesRaw = document.getElementById('adminCreateDevices')?.value || '';
  const devices = parseDevicesInput(devicesRaw);

  if (!email || !password) { setAdminMessage('Email dan password wajib diisi', true); return; }

  try {
    const response = await apiFetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, role, devices })
    });
    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      throw new Error(errBody.error || `Create user failed: ${response.status}`);
    }
    setAdminMessage('User berhasil dibuat');
    ['adminCreateEmail','adminCreatePassword','adminCreateName','adminCreateDevices'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const roleEl = document.getElementById('adminCreateRole');
    if (roleEl) roleEl.value = 'user';
    await loadAdminUsers();
  } catch (error) {
    console.error('Create admin user error:', error);
    setAdminMessage(error.message, true);
  }
}

async function saveAdminUserRow(rowElement) {
  const uid = rowElement.getAttribute('data-uid');
  const role = rowElement.querySelector('[data-field="role"]')?.value || 'user';
  const enabledValue = rowElement.querySelector('[data-field="enabled"]')?.value || 'true';
  const devicesRaw = rowElement.querySelector('[data-field="devices"]')?.value || '';
  const enabled = enabledValue === 'true';
  const devices = parseDevicesInput(devicesRaw);

  try {
    const responses = await Promise.all([
      apiFetch(`/api/admin/users/${uid}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) }),
      apiFetch(`/api/admin/users/${uid}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
      apiFetch(`/api/admin/users/${uid}/devices`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ devices }) })
    ]);
    const failed = responses.find(r => !r.ok);
    if (failed) {
      const errBody = await failed.json().catch(() => ({}));
      throw new Error(errBody.error || 'Gagal update user');
    }
    setAdminMessage('Perubahan user tersimpan');
  } catch (error) {
    console.error('Save admin row error:', error);
    setAdminMessage(error.message, true);
  }
}

async function refreshServerAuthProfile() {
  if (!authToken) {
    serverAuthProfile = null;
    return null;
  }
  try {
    const response = await apiFetch('/api/me');
    if (response.status === 403) {
      serverAuthProfile = null;
      setAuthMessage('Akun Anda belum aktif. Menunggu persetujuan admin.', true);
      setAuthModalVisible(true);
      if (window.firebase?.auth) {
        await firebase.auth().signOut();
      }
      return null;
    }

    if (response.status === 401) {
      serverAuthProfile = null;
      setAuthMessage('Sesi login berakhir, silakan login ulang.', true);
      setAuthModalVisible(true);
      if (window.firebase?.auth) {
        await firebase.auth().signOut();
      }
      return null;
    }

    if (!response.ok) {
      serverAuthProfile = null;
      return null;
    }

    const profile = await response.json();
    serverAuthProfile = profile;
    return profile;
  } catch (error) {
    console.error('Failed to refresh auth profile:', error);
    return null;
  }
}

function updateAuthUi(profile, fallbackEmail) {
  const authUserLabel = document.getElementById('authUserLabel');
  const btnOpenAuth = document.getElementById('btnOpenAuth');
  const btnLogout = document.getElementById('btnLogout');
  const btnOpenAdmin = document.getElementById('btnOpenAdmin');
  if (!authUserLabel || !btnOpenAuth || !btnLogout || !btnOpenAdmin) return;

  const isAuthenticated = !!authToken && !!profile;
  const role = isAuthenticated ? (profile?.role || 'user') : 'guest';
  const email = profile?.email || fallbackEmail;
  const label = isAuthenticated && email
    ? `${email} (${role})`
    : 'Guest';

  currentRole = role;
  const canViewMemberSection = role === 'admin' || role === 'user';
  setMemberOnlySectionVisible(canViewMemberSection);
  setMemberLayoutVisible(canViewMemberSection);
  updateSettingsPanel(isAuthenticated ? profile : null);

  if (!canViewMemberSection) switchMemberSection('dashboard');

  authUserLabel.textContent = label;
  btnOpenAuth.style.display = isAuthenticated ? 'none' : 'inline-flex';
  btnLogout.style.display = isAuthenticated ? 'inline-flex' : 'none';
  btnOpenAdmin.style.display = isAuthenticated && role === 'admin' ? 'inline-flex' : 'none';
}

function handleUnauthorizedResponse() {
  setAuthMessage('Sesi login belum ada/expired, silakan login kembali', true);
  setAuthModalVisible(true);
}

function resetDashboardDeviceState() {
  if (typeof devices !== 'undefined') devices = {};
  if (typeof selectedDeviceId !== 'undefined') selectedDeviceId = null;
  if (typeof chartHistoryLoadedDeviceId !== 'undefined') chartHistoryLoadedDeviceId = null;
  if (typeof updateDeviceSelector === 'function') updateDeviceSelector();
  if (typeof updateDevicesOverview === 'function') updateDevicesOverview();
}

function attachAuthUiHandlers() {
  const btnOpenAuth = document.getElementById('btnOpenAuth');
  const btnCloseAuth = document.getElementById('btnCloseAuth');
  const btnCloseAuthTop = document.getElementById('btnCloseAuthTop');
  const btnEmailLogin = document.getElementById('btnEmailLogin');
  const btnEmailSignup = document.getElementById('btnEmailSignup');
  const btnGoogleLogin = document.getElementById('btnGoogleLogin');
  const btnLogout = document.getElementById('btnLogout');
  const btnOpenAdmin = document.getElementById('btnOpenAdmin');
  const btnCloseAdmin = document.getElementById('btnCloseAdmin');
  const btnCloseAdminTop = document.getElementById('btnCloseAdminTop');
  const btnAdminRefresh = document.getElementById('btnAdminRefresh');
  const btnAdminCreateUser = document.getElementById('btnAdminCreateUser');
  const btnSaveProfile = document.getElementById('btnSaveProfile');
  const adminUsersTableBody = document.getElementById('adminUsersTableBody');

  if (btnOpenAuth) {
    btnOpenAuth.onclick = () => {
      setSignupMode(false);
      setAuthModalVisible(true);
    };
  }

  if (btnCloseAuth) {
    btnCloseAuth.onclick = () => {
      setSignupMode(false);
      setAuthModalVisible(false);
    };
  }

  if (btnCloseAuthTop) {
    btnCloseAuthTop.onclick = () => {
      setSignupMode(false);
      setAuthModalVisible(false);
    };
  }

  if (btnEmailLogin) {
    btnEmailLogin.onclick = async () => {
      const email = document.getElementById('authEmail')?.value?.trim();
      const password = document.getElementById('authPassword')?.value || '';
      if (!email || !password) { setAuthMessage('Isi email dan password terlebih dahulu', true); return; }
      if (!window.firebase?.auth) { setAuthMessage('Firebase belum dikonfigurasi', true); return; }
      try {
        await firebase.auth().signInWithEmailAndPassword(email, password);
        setAuthMessage('Login berhasil');
        setSignupMode(false);
        setAuthModalVisible(false);
        await update();
      } catch (error) { setAuthMessage(formatAuthError(error), true); }
    };
  }

  if (btnEmailSignup) {
    btnEmailSignup.onclick = async () => {
      const signupExtraBlock = document.getElementById('signupExtraBlock');
      const isSignupMode = !!signupExtraBlock && signupExtraBlock.style.display !== 'none';

      if (!isSignupMode) {
        setSignupMode(true);
        setAuthMessage('Lengkapi data diri lalu klik Sign Up lagi untuk kirim pendaftaran.');
        return;
      }

      const email = document.getElementById('authEmail')?.value?.trim();
      const password = document.getElementById('authPassword')?.value || '';
      const name = document.getElementById('authName')?.value?.trim() || '';
      const phone = document.getElementById('authPhone')?.value?.trim() || '';
      const department = document.getElementById('authDepartment')?.value?.trim() || '';
      if (!email || !password || !name || !phone) {
        setAuthMessage('Untuk Sign Up, isi Email, Password, Nama Lengkap, dan No. HP.', true);
        return;
      }
      try {
        const response = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name, phone, department })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || `Signup failed: ${response.status}`);
        }

        setAuthMessage(payload.message || 'Pendaftaran berhasil, menunggu persetujuan admin.');
        setSignupMode(false);
        ['authPassword', 'authName', 'authPhone', 'authDepartment'].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
      } catch (error) { setAuthMessage(error.message || 'Gagal mendaftar', true); }
    };
  }

  if (btnGoogleLogin) {
    btnGoogleLogin.onclick = async () => {
      if (!window.firebase?.auth) { setAuthMessage('Firebase belum dikonfigurasi', true); return; }
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await firebase.auth().signInWithPopup(provider);
        setAuthMessage('Login Google berhasil');
        setAuthModalVisible(false);
        await update();
      } catch (error) { setAuthMessage(error.message, true); }
    };
  }

  if (btnLogout) {
    btnLogout.onclick = async () => {
      try {
        if (window.firebase?.auth) await firebase.auth().signOut();
        // onAuthStateChanged(null) will handle state reset
      } catch (error) { setAuthMessage(error.message, true); }
    };
  }

  if (btnOpenAdmin) {
    btnOpenAdmin.onclick = async () => { setAdminModalVisible(true); await loadAdminUsers(); };
  }
  if (btnCloseAdmin) btnCloseAdmin.onclick = () => setAdminModalVisible(false);
  if (btnCloseAdminTop) btnCloseAdminTop.onclick = () => setAdminModalVisible(false);
  if (btnAdminRefresh) btnAdminRefresh.onclick = async () => { await loadAdminUsers(); };
  if (btnAdminCreateUser) btnAdminCreateUser.onclick = async () => { await createAdminUserFromForm(); };

  if (btnSaveProfile) {
    btnSaveProfile.onclick = async () => {
      const name = document.getElementById('settingEditName')?.value?.trim() || '';
      const phone = document.getElementById('settingEditPhone')?.value?.trim() || '';
      const department = document.getElementById('settingEditDepartment')?.value?.trim() || '';

      if (!name || !phone) {
        setSettingProfileMessage('Nama dan No. HP wajib diisi', true);
        return;
      }

      try {
        const response = await apiFetch('/api/me/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, phone, department })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || `Update profile failed: ${response.status}`);
        }

        serverAuthProfile = payload.profile || serverAuthProfile;
        updateSettingsPanel(serverAuthProfile);
        updateAuthUi(serverAuthProfile, serverAuthProfile?.email || '');
        setSettingProfileMessage('Profil berhasil diperbarui');
      } catch (error) {
        setSettingProfileMessage(error.message || 'Gagal update profil', true);
      }
    };
  }

  if (adminUsersTableBody) {
    adminUsersTableBody.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const action = target.dataset.action;
      if (!action) return;

      const row = target.closest('tr');
      if (!row) return;

      try {
        if (action === 'save') {
          await saveAdminUserRow(row);
        } else if (action === 'approve' || action === 'reject') {
          const uid = row.getAttribute('data-uid');
          if (!uid) return;
          await updateAdminUserApproval(uid, action);
          setAdminMessage(action === 'approve' ? 'User berhasil di-approve' : 'User berhasil di-reject');
        } else {
          return;
        }

        await loadAdminUsers();
      } catch (error) {
        setAdminMessage(error.message || 'Gagal memproses aksi admin', true);
      }
    });
  }
}

async function initAuth() {
  if (authInitialized) return;
  authInitialized = true;

  attachAuthUiHandlers();
  initSidebar();

  try {
    const storedCollapsed = localStorage.getItem('memberSidebarCollapsed') === '1';
    setSidebarCollapsed(storedCollapsed);
  } catch (error) {
    setSidebarCollapsed(false);
  }

  const firebaseConfig = getFirebaseClientConfig();
  if (!firebaseConfig || !window.firebase?.initializeApp) {
    updateAuthUi(null, null);
    return;
  }

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      authToken = await user.getIdToken();
      const profile = await refreshServerAuthProfile();
      setSettingProfileMessage('');
      updateAuthUi(profile, user.email || '');
      resetDashboardDeviceState();
      if (typeof update === 'function') await update();
    } else {
      authToken = null;
      serverAuthProfile = null;
      updateAuthUi(null, null);
      resetDashboardDeviceState();
      if (typeof update === 'function') await update();
    }
  });
}
