// ======================================================
// WIND UTILITIES
// ======================================================
function getBeaufortScale(windSpeed) {
  if (windSpeed < 0.5) return { scale: 0, desc: 'Calm', color: '#22c55e' };
  if (windSpeed < 1.5) return { scale: 1, desc: 'Light air', color: '#22c55e' };
  if (windSpeed < 3.3) return { scale: 2, desc: 'Light breeze', color: '#84cc16' };
  if (windSpeed < 5.5) return { scale: 3, desc: 'Gentle breeze', color: '#84cc16' };
  if (windSpeed < 8.0) return { scale: 4, desc: 'Moderate breeze', color: '#eab308' };
  if (windSpeed < 10.8) return { scale: 5, desc: 'Fresh breeze', color: '#eab308' };
  if (windSpeed < 13.9) return { scale: 6, desc: 'Strong breeze', color: '#f97316' };
  if (windSpeed < 17.2) return { scale: 7, desc: 'Near gale', color: '#f97316' };
  if (windSpeed < 20.8) return { scale: 8, desc: 'Gale', color: '#ef4444' };
  if (windSpeed < 24.5) return { scale: 9, desc: 'Strong gale', color: '#ef4444' };
  if (windSpeed < 28.5) return { scale: 10, desc: 'Storm', color: '#a855f7' };
  if (windSpeed < 32.7) return { scale: 11, desc: 'Violent storm', color: '#a855f7' };
  return { scale: 12, desc: 'Hurricane', color: '#dc2626' };
}

function getWindDirection(degree) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const normalizedDegree = ((degree % 360) + 360) % 360;
  const index = Math.round(normalizedDegree / 22.5) % 16;
  return directions[index];
}

function parseWindDirectionValue(rawDirection) {
  if (typeof rawDirection === 'string') {
    const directionMap = {
      'utara': 0, 'north': 0, 'n': 0,
      'timur': 90, 'east': 90, 'e': 90,
      'selatan': 180, 'south': 180, 's': 180,
      'barat': 270, 'west': 270, 'w': 270,
      'tenggara': 135, 'southeast': 135, 'se': 135,
      'barat daya': 225, 'southwest': 225, 'sw': 225,
      'timur laut': 45, 'northeast': 45, 'ne': 45,
      'barat laut': 315, 'northwest': 315, 'nw': 315
    };
    return directionMap[rawDirection.toLowerCase().trim()] ?? 0;
  }
  const numeric = parseFloat(rawDirection);
  return Number.isFinite(numeric) ? numeric : 0;
}

function pruneWindSamplesToWindow() {
  const start = chartWindowStart || getChartWindowStart();
  const end = start + (24 * 60 * 60 * 1000);
  windSamples24 = windSamples24.filter(sample => sample.ts >= start && sample.ts < end);
}

function addWindSample(speed, direction, timestamp) {
  const ts = new Date(timestamp).getTime();
  if (Number.isNaN(ts)) return;
  const normalizedDirection = ((direction % 360) + 360) % 360;
  const existingIndex = windSamples24.findIndex(sample => sample.ts === ts);
  if (existingIndex >= 0) {
    windSamples24[existingIndex] = { ts, speed, direction: normalizedDirection };
  } else {
    windSamples24.push({ ts, speed, direction: normalizedDirection });
  }
  windSamples24.sort((a, b) => a.ts - b.ts);
  pruneWindSamplesToWindow();
  lastWindSampleTimestamp = timestamp;
}

function updateWindData(windSpeed, windDirection, dataTimestamp) {
  try {
    const windSpeedElement = document.getElementById('windSpeed');
    if (windSpeedElement) windSpeedElement.textContent = windSpeed.toFixed(1);

    const beaufort = getBeaufortScale(windSpeed);
    const beaufortScaleEl = document.getElementById('beaufortScale');
    const beaufortDescEl = document.getElementById('beaufortDesc');
    if (beaufortScaleEl) { beaufortScaleEl.textContent = `Force ${beaufort.scale}`; beaufortScaleEl.style.color = beaufort.color; }
    if (beaufortDescEl) beaufortDescEl.textContent = beaufort.desc;

    const windDirectionEl = document.getElementById('windDirection');
    if (windDirectionEl) windDirectionEl.textContent = Math.round(windDirection);

    const cardinalDir = getWindDirection(windDirection);
    const cardinalDirectionEl = document.getElementById('cardinalDirection');
    const cardinalDescEl = document.getElementById('cardinalDesc');
    if (cardinalDirectionEl) cardinalDirectionEl.textContent = cardinalDir;

    const descriptionMap = {
      'N': 'Utara', 'NE': 'Timur Laut', 'E': 'Timur', 'SE': 'Tenggara',
      'S': 'Selatan', 'SW': 'Barat Daya', 'W': 'Barat', 'NW': 'Barat Laut',
      'NNE': 'Utara Timur Laut', 'ENE': 'Timur Laut Timur', 'ESE': 'Timur Tenggara',
      'SSE': 'Selatan Tenggara', 'SSW': 'Selatan Barat Daya', 'WSW': 'Barat Daya Barat',
      'WNW': 'Barat Laut Barat', 'NNW': 'Utara Barat Laut'
    };
    if (cardinalDescEl) cardinalDescEl.textContent = descriptionMap[cardinalDir] || cardinalDir;

    const arrow = document.getElementById('windArrow');
    if (arrow) arrow.style.transform = `translate(-50%, -50%) rotate(${windDirection}deg)`;

    const lastWindSpeedValue = typeof window.lastWindSpeed !== 'undefined' ? window.lastWindSpeed : windSpeed;
    const speedTrend = windSpeed - lastWindSpeedValue;
    const speedTrendEl = document.getElementById('windSpeedTrend');
    if (speedTrendEl) {
      if (speedTrend > 0.1) { speedTrendEl.textContent = `↗ +${speedTrend.toFixed(1)}`; speedTrendEl.style.color = '#ef4444'; }
      else if (speedTrend < -0.1) { speedTrendEl.textContent = `↘ ${speedTrend.toFixed(1)}`; speedTrendEl.style.color = '#22c55e'; }
      else { speedTrendEl.textContent = `→ ${speedTrend.toFixed(1)}`; speedTrendEl.style.color = '#3b82f6'; }
    }

    const dirTrendEl = document.getElementById('windDirectionTrend');
    if (dirTrendEl) { dirTrendEl.textContent = `${cardinalDir} ${Math.round(windDirection)}°`; dirTrendEl.style.color = '#06b6d4'; }

    if (dataTimestamp && dataTimestamp !== lastWindSampleTimestamp) {
      addWindSample(windSpeed, windDirection, dataTimestamp);
    }
    pruneWindSamplesToWindow();

    if (windSamples24.length > 0) {
      windSpeedHistory = windSamples24.map(s => s.speed);
      windDirectionHistory = windSamples24.map(s => s.direction);

      const maxWind = Math.max(...windSpeedHistory);
      const minWind = Math.min(...windSpeedHistory);
      const avgWind = windSpeedHistory.reduce((a, b) => a + b, 0) / windSpeedHistory.length;

      const windMaxEl = document.getElementById('windMax');
      const windMinEl = document.getElementById('windMin');
      const windAvgEl = document.getElementById('windAvg');
      if (windMaxEl) windMaxEl.textContent = maxWind.toFixed(1);
      if (windMinEl) windMinEl.textContent = minWind.toFixed(1);
      if (windAvgEl) windAvgEl.textContent = avgWind.toFixed(1);

      const maxDir = Math.max(...windDirectionHistory);
      const minDir = Math.min(...windDirectionHistory);
      const modeMap = new Map();
      windDirectionHistory.forEach(direction => {
        const dirKey = getWindDirection(direction);
        const current = modeMap.get(dirKey) || { count: 0, sum: 0 };
        current.count += 1; current.sum += direction;
        modeMap.set(dirKey, current);
      });

      let modeKey = null, modeCount = -1;
      modeMap.forEach((value, key) => { if (value.count > modeCount) { modeCount = value.count; modeKey = key; } });
      const modeData = modeMap.get(modeKey);
      const modeDegree = modeData ? Math.round(modeData.sum / modeData.count) : 0;

      const windDirMaxEl = document.getElementById('windDirectionMax');
      const windDirMinEl = document.getElementById('windDirectionMin');
      const windDirModeEl = document.getElementById('windDirectionMode');
      if (windDirMaxEl) windDirMaxEl.textContent = `${Math.round(maxDir)}°`;
      if (windDirMinEl) windDirMinEl.textContent = `${Math.round(minDir)}°`;
      if (windDirModeEl) windDirModeEl.textContent = modeKey ? `${modeKey} ${modeDegree}°` : '—';
    }

    window.lastWindSpeed = windSpeed;
    window.lastWindDirection = windDirection;
  } catch (error) {
    console.error('Error updating wind data:', error);
  }
}
