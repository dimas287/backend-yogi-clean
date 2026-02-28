// ======================================================
// MEMBER DATA TABLE, LOCATIONS, ALERTS
// ======================================================

function setMemberDataMessage(message, isError = false) {
  const el = document.getElementById('memberDataMessage');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#ef4444' : '#64748b';
}

function setLocationMessage(message, isError = false) {
  const el = document.getElementById('locationMessage');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#ef4444' : '#64748b';
}

function renderMemberDataTable(rows = []) {
  const tbody = document.getElementById('memberDataTableBody');
  if (!tbody) return;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="admin-empty">Belum ada data</td></tr>';
    return;
  }

  const isAdmin = currentRole === 'admin';

  tbody.innerHTML = rows.map((row) => {
    const date = typeof row.timestamp === 'string' && row.timestamp.includes('T')
      ? row.timestamp.split('T')[0]
      : new Date(row.timestamp || Date.now()).toISOString().split('T')[0];

    const statusColor = row.status === 'BAHAYA' ? '#ef4444' : row.status === 'WASPADA' ? '#eab308' : '#22c55e';
    
    // Format arah angin
    const windDirection = row.arah_angin !== undefined ? `${row.arah_angin}°` : '-';
    const windSpeed = row.kecepatan_angin !== undefined ? `${row.kecepatan_angin} m/s` : '-';

    const adminActions = isAdmin
      ? `<button class="member-table-btn member-table-btn--edit" data-action="edit-row" data-device="${row.device}" data-entry-key="${row.entryKey}">Edit</button>
         <button class="member-table-btn member-table-btn--delete" data-action="delete-row" data-device="${row.device}" data-entry-key="${row.entryKey}">Hapus</button>`
      : '';

    return `
      <tr>
        <td>${row.timestamp ? new Date(row.timestamp).toLocaleString('id-ID') : '-'}</td>
        <td><span class="member-device-badge">${row.device || '-'}</span></td>
        <td>${row.pm25}</td>
        <td>${row.pm10}</td>
        <td>${row.suhu}°C</td>
        <td>${row.kelembaban}%</td>
        <td>${windSpeed}</td>
        <td>${windDirection}</td>
        <td><span class="member-status-badge" style="color:${statusColor};border-color:${statusColor}40;background:${statusColor}10">${row.status || '-'}</span></td>
        <td class="member-table-actions">
          <button class="member-table-btn" data-action="download-row" data-device="${row.device}" data-date="${date}">↓ CSV</button>
          ${adminActions}
        </td>
      </tr>
    `;
  }).join('');
}

function buildMemberTableQuery(filters = {}) {
  const params = new URLSearchParams();
  params.set('limit', String(filters.limit || 500));
  if (filters.device) params.set('device', filters.device);
  if (filters.startDate) params.set('startDate', filters.startDate);
  if (filters.endDate) params.set('endDate', filters.endDate);
  return params.toString();
}

function getMemberTableFilters() {
  const device = document.getElementById('memberFilterDevice')?.value?.trim() || '';
  const startDate = document.getElementById('memberFilterStartDate')?.value || '';
  const endDate = document.getElementById('memberFilterEndDate')?.value || '';
  const limitRaw = document.getElementById('memberFilterLimit')?.value || '500';
  const limitNum = Number.parseInt(limitRaw, 10);
  const limit = Number.isFinite(limitNum) ? Math.min(Math.max(limitNum, 1), 5000) : 500;

  if (startDate && endDate && startDate > endDate) {
    throw new Error('Tanggal awal tidak boleh lebih besar dari tanggal akhir');
  }

  return { device, startDate, endDate, limit };
}

async function loadMemberDeviceFilterOptions(forceReload = false) {
  const deviceSelect = document.getElementById('memberFilterDevice');
  if (!deviceSelect) return;
  if (!forceReload && deviceSelect.dataset.loaded === '1') return;

  const previousValue = deviceSelect.value;
  const response = await apiFetch('/api/current');
  if (response.status === 401 || response.status === 403) return;
  if (!response.ok) throw new Error(`Load device filter failed: ${response.status}`);

  const payload = await response.json();
  const deviceIds = Object.keys(payload || {}).sort();

  deviceSelect.innerHTML = '<option value="">Semua Device</option>';
  deviceIds.forEach((deviceId) => {
    const option = document.createElement('option');
    option.value = deviceId;
    option.textContent = deviceId;
    deviceSelect.appendChild(option);
  });

  if (previousValue && deviceIds.includes(previousValue)) {
    deviceSelect.value = previousValue;
  }

  deviceSelect.dataset.loaded = '1';
}

async function loadMemberTable(options = {}) {
  if (!(currentRole === 'admin' || currentRole === 'user')) return;

  setMemberDataMessage('Memuat data...');
  try {
    const shouldReloadDevices = options.refreshDevices === true;
    await loadMemberDeviceFilterOptions(shouldReloadDevices);

    const filters = getMemberTableFilters();
    const query = buildMemberTableQuery(filters);
    const response = await apiFetch(`/api/member/table?${query}`);
    if (response.status === 401 || response.status === 403) {
      setMemberDataMessage('Silakan login untuk melihat data tabel', true);
      return;
    }
    if (!response.ok) throw new Error(`Load member table failed: ${response.status}`);

    const payload = await response.json();
    renderMemberDataTable(payload.rows || []);
    setMemberDataMessage(`${payload.rows?.length || 0} data dimuat`);
  } catch (error) {
    console.error('Load member table error:', error);
    setMemberDataMessage(error.message || 'Gagal memuat data tabel', true);
  }
}

async function updateMemberDataRow(device, entryKey) {
  const pm25 = prompt('PM2.5 baru?');
  const pm10 = prompt('PM10 baru?');
  if (pm25 === null || pm10 === null) return;

  const body = {
    pm25: Number(pm25) || 0,
    pm10: Number(pm10) || 0,
    suhu: 0, kelembaban: 0, kecepatan_angin: 0, arah_angin: 0,
    status: Number(pm25) >= 75 ? 'WASPADA' : 'AMAN',
    timestamp: new Date().toISOString()
  };

  const response = await apiFetch(`/api/admin/data/${device}/${entryKey}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Gagal update data');
  }
}

async function deleteMemberDataRow(device, entryKey) {
  if (!confirm('Hapus data ini?')) return;

  const response = await apiFetch(`/api/admin/data/${device}/${entryKey}`, { method: 'DELETE' });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Gagal hapus data');
  }
}

async function downloadCsvForDeviceDate(device, date) {
  const response = await apiFetch(`/api/download/${device}/${date}`);
  if (response.status === 401 || response.status === 403) { handleUnauthorizedResponse(); return; }
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = `${device}_${date}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

async function downloadFilteredMemberCsv() {
  if (!(currentRole === 'admin' || currentRole === 'user')) return;

  const filters = getMemberTableFilters();
  const query = buildMemberTableQuery(filters);
  const response = await apiFetch(`/api/member/table/download?${query}`);

  if (response.status === 401 || response.status === 403) { handleUnauthorizedResponse(); return; }
  if (!response.ok) throw new Error(`Download filtered CSV failed: ${response.status}`);

  const blob = await response.blob();
  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  const fallbackName = `member_data_${new Date().toISOString().slice(0, 10)}.csv`;
  const contentDisposition = response.headers.get('content-disposition') || '';
  const filenameMatch = /filename="?([^";]+)"?/i.exec(contentDisposition);

  link.href = blobUrl;
  link.download = filenameMatch?.[1] || fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(blobUrl);
}

// ---- LOCATIONS ----

function initLocationMapIfNeeded() {
  if (!window.L || locationMap) return;

  locationMap = L.map('locationMap').setView([-2.8441, 117.3656], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(locationMap);

  locationMarkersLayer = L.layerGroup().addTo(locationMap);
}

function renderLocationList(locations = []) {
  const list = document.getElementById('locationList');
  if (!list) return;

  const isAdmin = currentRole === 'admin';

  if (!locations.length) {
    list.innerHTML = '<div class="admin-empty">Belum ada lokasi</div>';
    return;
  }

  list.innerHTML = locations.map((loc) => {
    if (!isAdmin) {
      return `
        <div class="location-item">
          <div class="location-item-title">${loc.name || loc.device}</div>
          <div>Device: ${loc.device}</div>
          <div>Lat: ${loc.lat}</div>
          <div>Lng: ${loc.lng}</div>
        </div>
      `;
    }
    return `
      <div class="location-item" data-device="${loc.device}">
        <div class="location-item-title">${loc.device}</div>
        <input type="text" data-field="name" value="${loc.name || loc.device}" placeholder="Nama lokasi" />
        <input type="number" step="any" data-field="lat" value="${loc.lat}" placeholder="Latitude" />
        <input type="number" step="any" data-field="lng" value="${loc.lng}" placeholder="Longitude" />
        <button class="location-bar-button" data-action="save-location">Simpan Koordinat</button>
      </div>
    `;
  }).join('');
}

function renderLocationMarkers(locations = []) {
  initLocationMapIfNeeded();
  if (!locationMap || !locationMarkersLayer) return;

  locationMarkersLayer.clearLayers();
  if (!locations.length) return;

  const bounds = [];
  locations.forEach((loc) => {
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const marker = L.marker([lat, lng]).bindPopup(`<b>${loc.name || loc.device}</b><br/>${loc.device}`);
    marker.addTo(locationMarkersLayer);
    bounds.push([lat, lng]);
  });

  if (bounds.length) locationMap.fitBounds(bounds, { padding: [20, 20], maxZoom: 13 });
}

async function loadMemberLocations() {
  if (!(currentRole === 'admin' || currentRole === 'user')) return;

  setLocationMessage('Memuat lokasi...');
  try {
    const response = await apiFetch('/api/member/locations');
    if (response.status === 401 || response.status === 403) {
      setLocationMessage('Silakan login untuk melihat lokasi', true);
      return;
    }
    if (!response.ok) throw new Error(`Load locations failed: ${response.status}`);

    const payload = await response.json();
    renderLocationList(payload.locations || []);
    renderLocationMarkers(payload.locations || []);
    setLocationMessage(`${payload.locations?.length || 0} lokasi dimuat`);
  } catch (error) {
    console.error('Load locations error:', error);
    setLocationMessage('Gagal memuat lokasi', true);
  }
}

async function saveLocationRow(locationCardElement) {
  const device = locationCardElement.getAttribute('data-device');
  const name = locationCardElement.querySelector('[data-field="name"]')?.value?.trim() || device;
  const lat = Number(locationCardElement.querySelector('[data-field="lat"]')?.value);
  const lng = Number(locationCardElement.querySelector('[data-field="lng"]')?.value);

  const response = await apiFetch(`/api/admin/locations/${device}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, lat, lng })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || 'Gagal simpan koordinat');
  }
}

function initMemberHandlers() {
  const btnReloadMemberTable = document.getElementById('btnReloadMemberTable');
  const btnApplyMemberFilter = document.getElementById('btnApplyMemberFilter');
  const btnResetMemberFilter = document.getElementById('btnResetMemberFilter');
  const btnDownloadFilteredMember = document.getElementById('btnDownloadFilteredMember');
  const btnReloadLocations = document.getElementById('btnReloadLocations');
  const memberDataTableBody = document.getElementById('memberDataTableBody');
  const locationList = document.getElementById('locationList');
  const memberFilterDevice = document.getElementById('memberFilterDevice');
  const memberFilterStartDate = document.getElementById('memberFilterStartDate');
  const memberFilterEndDate = document.getElementById('memberFilterEndDate');
  const memberFilterLimit = document.getElementById('memberFilterLimit');

  if (btnReloadMemberTable) btnReloadMemberTable.onclick = async () => { await loadMemberTable({ refreshDevices: true }); };
  if (btnApplyMemberFilter) btnApplyMemberFilter.onclick = async () => { await loadMemberTable(); };
  if (btnDownloadFilteredMember) {
    btnDownloadFilteredMember.onclick = async () => {
      try {
        await downloadFilteredMemberCsv();
      } catch (error) {
        setMemberDataMessage(error.message || 'Gagal mengunduh CSV filter', true);
      }
    };
  }
  if (btnResetMemberFilter) {
    btnResetMemberFilter.onclick = async () => {
      if (memberFilterDevice) memberFilterDevice.value = '';
      if (memberFilterStartDate) memberFilterStartDate.value = '';
      if (memberFilterEndDate) memberFilterEndDate.value = '';
      if (memberFilterLimit) memberFilterLimit.value = '500';
      await loadMemberTable();
    };
  }

  if (memberFilterDevice) memberFilterDevice.onchange = async () => { await loadMemberTable(); };
  if (memberFilterLimit) memberFilterLimit.onchange = async () => { await loadMemberTable(); };
  if (btnReloadLocations) btnReloadLocations.onclick = async () => { await loadMemberLocations(); };

  if (memberDataTableBody) {
    memberDataTableBody.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const action = target.dataset.action;
      if (!action) return;

      const device = target.dataset.device;
      const date = target.dataset.date;
      const entryKey = target.dataset.entryKey;

      try {
        if (action === 'download-row' && device && date) { await downloadCsvForDeviceDate(device, date); return; }
        if (currentRole !== 'admin') return;
        if (action === 'edit-row' && device && entryKey) { await updateMemberDataRow(device, entryKey); await loadMemberTable(); return; }
        if (action === 'delete-row' && device && entryKey) { await deleteMemberDataRow(device, entryKey); await loadMemberTable(); }
      } catch (error) { setMemberDataMessage(error.message, true); }
    });
  }

  if (locationList) {
    locationList.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || target.dataset.action !== 'save-location') return;
      if (currentRole !== 'admin') return;
      const row = target.closest('.location-item');
      if (!row) return;
      try {
        await saveLocationRow(row);
        setLocationMessage('Koordinat berhasil disimpan');
        await loadMemberLocations();
      } catch (error) { setLocationMessage(error.message, true); }
    });
  }
}

// ---- AIR QUALITY ALERTS ----

function getAlertToneClass(aqi) {
  if (aqi >= 201) return 'extreme';
  if (aqi >= 151) return 'danger';
  return 'warn';
}

function hideAirAlert() {
  const bar = document.getElementById('airAlertBar');
  if (!bar) return;
  bar.style.display = 'none';
  bar.classList.remove('warn', 'danger', 'extreme');
  currentAlertSignature = null;
}

function showAirAlert(message, toneClass, signature) {
  const bar = document.getElementById('airAlertBar');
  const text = document.getElementById('airAlertText');
  if (!bar || !text) return;
  bar.classList.remove('warn', 'danger', 'extreme');
  bar.classList.add(toneClass);
  text.textContent = message;
  bar.style.display = 'flex';
  currentAlertSignature = signature;
}

function dismissAirAlert() {
  dismissedAlertSignature = currentAlertSignature;
  hideAirAlert();
}

function sendBrowserAlertIfAllowed(signature, title, message) {
  if (lastBrowserNotificationSignature === signature) return;
  if (!('Notification' in window)) return;

  const showNotification = () => {
    try { new Notification(title, { body: message }); lastBrowserNotificationSignature = signature; }
    catch (error) { console.warn('Browser notification error:', error); }
  };

  if (Notification.permission === 'granted') { showNotification(); return; }
  if (Notification.permission === 'default') {
    Notification.requestPermission().then((perm) => { if (perm === 'granted') showNotification(); }).catch(() => {});
  }
}

async function sendTelegramAlertIfAllowed(signature, title, message) {
  if (lastTelegramAlertSignature === signature) return;
  if (!authToken) return;

  try {
    const response = await apiFetch('/api/alerts/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message })
    });

    if (response.ok) {
      lastTelegramAlertSignature = signature;
      return;
    }

    // 503 means Telegram env is not configured; skip quietly
    if (response.status === 503) return;

    const payload = await response.json().catch(() => ({}));
    console.warn('Telegram alert skipped:', payload.error || response.status);
  } catch (error) {
    console.warn('Telegram alert error:', error?.message || error);
  }
}

function processAirQualityAlert(deviceId, aqi, category, timestamp, pm25, pm10) {
  if (!deviceId) return;

  const state = alertStateByDevice[deviceId] || { lastAqi: 0, lastAlertAt: 0, lastSignature: null };

  if (aqi < UNHEALTHY_AQI_THRESHOLD) {
    alertStateByDevice[deviceId] = { ...state, lastAqi: 0 };
    dismissedAlertSignature = null;
    hideAirAlert();
    return;
  }

  const signature = `${deviceId}|${timestamp}|${aqi}|${category}`;
  const toneClass = getAlertToneClass(aqi);
  const message = `⚠ ${deviceId}: AQI ${aqi} (${category}) · PM2.5 ${pm25} · PM10 ${pm10}`;
  const now = Date.now();
  const isEscalated = aqi > state.lastAqi;
  const isNewSignature = signature !== state.lastSignature;
  const cooldownPassed = (now - state.lastAlertAt) >= ALERT_COOLDOWN_MS;

  if (dismissedAlertSignature !== signature) showAirAlert(message, toneClass, signature);

  if (isNewSignature && (isEscalated || cooldownPassed)) {
    sendBrowserAlertIfAllowed(signature, `Peringatan Udara · ${deviceId}`, message);
    sendTelegramAlertIfAllowed(signature, `Peringatan Udara · ${deviceId}`, message);
    alertStateByDevice[deviceId] = { lastAqi: aqi, lastAlertAt: now, lastSignature: signature };
    return;
  }

  alertStateByDevice[deviceId] = { ...state, lastAqi: Math.max(state.lastAqi || 0, aqi), lastSignature: signature };
}
