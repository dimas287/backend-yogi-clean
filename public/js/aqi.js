// ======================================================
// AQI BREAKPOINTS & CALCULATIONS
// ======================================================
const PM25_BREAKPOINTS = [
  { concLo: 0.0,   concHi: 12.0,  aqiLo: 0,   aqiHi: 50,  cat: 'BAIK',              color: '#22c55e', scId: 'sc0' },
  { concLo: 12.1,  concHi: 35.4,  aqiLo: 51,  aqiHi: 100, cat: 'SEDANG',            color: '#eab308', scId: 'sc1' },
  { concLo: 35.5,  concHi: 55.4,  aqiLo: 101, aqiHi: 150, cat: 'TIDAK SEHAT*',      color: '#f97316', scId: 'sc2' },
  { concLo: 55.5,  concHi: 150.4, aqiLo: 151, aqiHi: 200, cat: 'TIDAK SEHAT',       color: '#ef4444', scId: 'sc3' },
  { concLo: 150.5, concHi: 250.4, aqiLo: 201, aqiHi: 300, cat: 'SANGAT TIDAK SEHAT',color: '#a855f7', scId: 'sc4' },
  { concLo: 250.5, concHi: 500.4, aqiLo: 301, aqiHi: 500, cat: 'BERBAHAYA',         color: '#dc2626', scId: 'sc5' },
];

const PM10_BREAKPOINTS = [
  { concLo: 0,   concHi: 54,   aqiLo: 0,   aqiHi: 50,  cat: 'BAIK',              color: '#22c55e', scId: 'sc0' },
  { concLo: 55,  concHi: 154,  aqiLo: 51,  aqiHi: 100, cat: 'SEDANG',            color: '#eab308', scId: 'sc1' },
  { concLo: 155, concHi: 254,  aqiLo: 101, aqiHi: 150, cat: 'TIDAK SEHAT*',      color: '#f97316', scId: 'sc2' },
  { concLo: 255, concHi: 354,  aqiLo: 151, aqiHi: 200, cat: 'TIDAK SEHAT',       color: '#ef4444', scId: 'sc3' },
  { concLo: 355, concHi: 424,  aqiLo: 201, aqiHi: 300, cat: 'SANGAT TIDAK SEHAT',color: '#a855f7', scId: 'sc4' },
  { concLo: 425, concHi: 604,  aqiLo: 301, aqiHi: 500, cat: 'BERBAHAYA',         color: '#dc2626', scId: 'sc5' },
];

function calcAQI(conc, breakpoints) {
  let bp = breakpoints[breakpoints.length - 1];
  for (let b of breakpoints) {
    if (conc >= b.concLo && conc <= b.concHi) { bp = b; break; }
  }
  const aqi = Math.round(((bp.aqiHi - bp.aqiLo) / (bp.concHi - bp.concLo)) * (conc - bp.concLo) + bp.aqiLo);
  return { aqi: Math.min(aqi, 500), bp };
}
