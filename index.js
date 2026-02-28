const mqtt = require("mqtt");
require('dotenv').config();
console.log('Env loaded, TELEGRAM_BOT_TOKEN:', process.env.TELEGRAM_BOT_TOKEN ? 'SET' : 'NOT SET');
console.log('TELEGRAM_CHAT_ID:', process.env.TELEGRAM_CHAT_ID);
const admin = require("firebase-admin");
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// ================= FIREBASE =================
let serviceAccount;

// Try to use environment variables first, fallback to file
if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
  serviceAccount = {
    type: "service_account",
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID || "1e0d8d6e1d56a4b124b375207451cf4072040d71",
    private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@air-quality-357a1.iam.gserviceaccount.com",
    client_id: process.env.FIREBASE_CLIENT_ID || "107361987441400167534",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40air-quality-357a1.iam.gserviceaccount.com",
    universe_domain: "googleapis.com"
  };
} else {
  // Fallback to file if available
  try {
    serviceAccount = require("./serviceAccountKey.json");
  } catch (e) {
    console.error("Firebase credentials not found in environment variables or serviceAccountKey.json");
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://air-quality-357a1-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

const db = admin.database();
const AUTH_REQUIRED = process.env.AUTH_REQUIRED === "true";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;
const lastActivityWriteCache = new Map();

function getBearerToken(req) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  return authHeader.slice(7).trim();
}

function getClientIp(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || req.ip || "unknown";
}

function normalizeRole(role) {
  if (role === "admin") return "admin";
  if (role === "guest") return "guest";
  return "user";
}

function buildGuestUser() {
  return {
    uid: "guest",
    email: null,
    role: "guest",
    enabled: true,
    devices: ["*"]
  };
}

async function buildRequestUser(decodedToken) {
  const uid = decodedToken.uid;
  const profileSnap = await db.ref(`users/${uid}`).once("value");
  const profile = profileSnap.val() || {};

  return {
    uid,
    email: decodedToken.email || profile.email || null,
    role: normalizeRole(profile.role || decodedToken.role),
    enabled: profile.enabled !== false,
    devices: Array.isArray(profile.devices) ? profile.devices : [],
    name: profile.name || "",
    phone: profile.phone || "",
    department: profile.department || "",
    approvalStatus: profile.approvalStatus || (profile.enabled === false ? "pending" : "approved"),
    createdAt: profile.createdAt || null,
    lastLoginAt: profile.lastLoginAt || null,
    lastLoginIp: profile.lastLoginIp || null,
    lastActivityAt: profile.lastActivityAt || null,
    lastActivityIp: profile.lastActivityIp || null
  };
}

async function touchUserActivity(uid, req, options = {}) {
  if (!uid || uid === "guest") return;

  const markLogin = options.markLogin === true;
  const nowMs = Date.now();
  const lastWriteAt = lastActivityWriteCache.get(uid) || 0;
  if (!markLogin && nowMs - lastWriteAt < ACTIVITY_WRITE_INTERVAL_MS) {
    return;
  }

  const nowIso = new Date(nowMs).toISOString();
  const updatePayload = {
    lastActivityAt: nowIso,
    lastActivityIp: getClientIp(req),
    lastActivityPath: req.originalUrl || req.path || ""
  };

  if (markLogin) {
    updatePayload.lastLoginAt = nowIso;
    updatePayload.lastLoginIp = getClientIp(req);
  }

  await db.ref(`users/${uid}`).update(updatePayload);
  lastActivityWriteCache.set(uid, nowMs);
}

async function optionalAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (token) {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        const user = await buildRequestUser(decoded);
        req.user = user.enabled ? user : buildGuestUser();
        return next();
      } catch (tokenError) {
        // invalid token — fall through to guest/dev
      }
    }

    if (!AUTH_REQUIRED) {
      req.user = buildGuestUser();
      return next();
    }

    req.user = buildGuestUser();
    next();
  } catch (error) {
    req.user = buildGuestUser();
    next();
  }
}

async function requireAuth(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const decoded = await admin.auth().verifyIdToken(token);
    const user = await buildRequestUser(decoded);

    if (!user.enabled) {
      return res.status(403).json({ error: "User account is disabled" });
    }

    req.user = user;
    await touchUserActivity(user.uid, req).catch((error) => {
      console.error("Failed to update user activity:", error.message || error);
    });
    next();
  } catch (error) {
    console.error("Auth error:", error.message);
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({ error: "Admin role required" });
  }
  next();
}

function normalizeDeviceId(deviceId) {
  return String(deviceId || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

function canAccessDevice(user, deviceId) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "guest") return true;

  if (!Array.isArray(user.devices)) return false;
  if (user.devices.includes("*")) return true;
  if (user.role === "user" && user.devices.length === 0) return true;

  const requested = normalizeDeviceId(deviceId);
  return user.devices.some((id) => normalizeDeviceId(id) === requested);
}

function filterDevicesByAccess(devicesObj, user) {
  if (user.role === "admin" || user.role === "guest") return devicesObj;
  const allowed = {};
  for (const deviceId of Object.keys(devicesObj || {})) {
    if (canAccessDevice(user, deviceId)) {
      allowed[deviceId] = devicesObj[deviceId];
    }
  }
  return allowed;
}

async function getHistoryByDate(device, date) {
  const snapshot = await db.ref(`devices/${device}/history`)
    .limitToLast(5000)
    .once("value");

  const allHistory = snapshot.val() || {};
  const filtered = {};

  Object.entries(allHistory).forEach(([key, value]) => {
    const ts = value?.timestamp;
    if (typeof ts === "string" && ts.startsWith(date)) {
      filtered[key] = value;
    }
  });

  return filtered;
}

function getStatus(pm25) {
  if (pm25 >= 150) return "BAHAYA";
  if (pm25 >= 75) return "WASPADA";
  return "AMAN";
}

function sanitizeRow(row) {
  return {
    timestamp: row.timestamp || new Date().toISOString(),
    pm25: Number(row.pm25) || 0,
    pm10: Number(row.pm10) || 0,
    suhu: Number(row.suhu) || 0,
    kelembaban: Number(row.kelembaban) || 0,
    kecepatan_angin: Number(row.kecepatan_angin) || 0,
    arah_angin: row.arah_angin || 0,
    status: row.status || getStatus(Number(row.pm25) || 0)
  };
}

function isValidDateOnly(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function getDateOnlyFromTimestamp(timestamp) {
  const date = new Date(timestamp || Date.now());
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isRowWithinDateRange(timestamp, startDate, endDate) {
  const dateOnly = getDateOnlyFromTimestamp(timestamp);
  if (!dateOnly) return false;
  if (startDate && dateOnly < startDate) return false;
  if (endDate && dateOnly > endDate) return false;
  return true;
}

function parseMemberTableQuery(req) {
  const limitRaw = parseInt(req.query.limit || "500", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 5000)
    : 500;

  const requestedDevice = typeof req.query.device === "string"
    ? req.query.device.trim()
    : "";

  const startDate = typeof req.query.startDate === "string"
    ? req.query.startDate.trim()
    : "";

  const endDate = typeof req.query.endDate === "string"
    ? req.query.endDate.trim()
    : "";

  if (startDate && !isValidDateOnly(startDate)) {
    throw new Error("startDate must use format YYYY-MM-DD");
  }

  if (endDate && !isValidDateOnly(endDate)) {
    throw new Error("endDate must use format YYYY-MM-DD");
  }

  if (startDate && endDate && startDate > endDate) {
    throw new Error("startDate cannot be greater than endDate");
  }

  return { limit, requestedDevice, startDate, endDate };
}

async function getMemberTableRows(user, options) {
  const { requestedDevice, startDate, endDate, limit } = options;

  const deviceIds = requestedDevice
    ? [requestedDevice]
    : await getAccessibleDeviceIds(user);

  const rows = [];
  const readLimit = (startDate || endDate)
    ? Math.min(Math.max(limit, 5000), 10000)
    : limit;

  for (const deviceId of deviceIds) {
    const snap = await db.ref(`devices/${deviceId}/history`).limitToLast(readLimit).once("value");
    const history = snap.val() || {};

    Object.entries(history).forEach(([entryKey, value]) => {
      const row = {
        device: deviceId,
        entryKey,
        ...sanitizeRow(value)
      };

      if (!isRowWithinDateRange(row.timestamp, startDate, endDate)) return;
      rows.push(row);
    });
  }

  rows.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return rows.slice(0, limit);
}

async function getAccessibleDeviceIds(user) {
  const deviceSnapshot = await db.ref("devices").once("value");
  const allIds = Object.keys(deviceSnapshot.val() || {});

  if (user.role === "admin" || user.role === "guest") return allIds;
  if (Array.isArray(user.devices) && user.devices.includes("*")) return allIds;
  if (user.role === "user" && (!Array.isArray(user.devices) || user.devices.length === 0)) return allIds;

  return allIds.filter((id) => canAccessDevice(user, id));
}

// ================= MQTT =================
const options = {
  host: "3f45b22d5630410eae9db48c42d47df2.s1.eu.hivemq.cloud",
  port: 8883,
  protocol: "mqtts",
  username: "naufalyogi",
  password: "Naufalyogi123"
};

const client = mqtt.connect(options);

client.on("connect", () => {
  console.log("MQTT Connected");
  client.subscribe("air/#");
});

client.on("message", async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    const deviceID = data.device;
    const status = getStatus(data.pm25);

    const finalData = {
      ...data,
      status,
      timestamp: data.timestamp || new Date().toISOString()
    };

    console.log("Final data to save:", finalData);

    await db.ref(`devices/${deviceID}/current`).set(finalData);
    await db.ref(`devices/${deviceID}/history`).push(finalData);

    console.log("Saved to Firebase:", deviceID, "with timestamp:", finalData.timestamp);
  } catch (err) {
    console.log("Error:", err);
  }
});

async function notifyAdminNewSignup(payload) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const message = [
    "🔔 PENDAFTARAN AKUN BARU (MENUNGGU APPROVAL)",
    "",
    `Nama: ${payload.name || "-"}`,
    `Email: ${payload.email || "-"}`,
    `No HP: ${payload.phone || "-"}`,
    `Departemen: ${payload.department || "-"}`,
    `IP: ${payload.createdIp || "-"}`,
    `Waktu: ${payload.createdAt || "-"}`,
    "",
    "Silakan buka panel Admin untuk Approve/Reject user ini."
  ].join("\n");

  await sendTelegramMessage(message, TELEGRAM_CHAT_ID);
}

app.get("/api/current", optionalAuth, async (req, res) => {
  res.set("Cache-Control", "no-store");
  const snapshot = await db.ref("devices").once("value");
  const allDevices = snapshot.val() || {};
  res.json(filterDevicesByAccess(allDevices, req.user));
});

app.get("/api/history/:device", optionalAuth, async (req, res) => {
  const device = req.params.device;
  if (!canAccessDevice(req.user, device)) {
    return res.status(403).json({ error: "Access denied for this device" });
  }

  const snapshot = await db.ref(`devices/${device}/history`)
    .limitToLast(2000)
    .once("value");
  res.json(snapshot.val() || {});
});

app.get("/api/history/:device/:date", optionalAuth, async (req, res) => {
  const { device, date } = req.params;
  if (!canAccessDevice(req.user, device)) {
    return res.status(403).json({ error: "Access denied for this device" });
  }

  const data = await getHistoryByDate(device, date);
  res.json(data);
});

app.get("/api/download/:device/:date", requireAuth, async (req, res) => {
  const { device, date } = req.params;
  if (!canAccessDevice(req.user, device)) {
    return res.status(403).json({ error: "Access denied for this device" });
  }

  const data = await getHistoryByDate(device, date);

  if (!data || Object.keys(data).length === 0) return res.send("No Data");

  let csv = "timestamp,pm25,pm10,suhu,kelembaban,kecepatan_angin,arah_angin,status\n";

  Object.values(data).forEach((d) => {
    csv += `${d.timestamp},${d.pm25},${d.pm10},${d.suhu},${d.kelembaban},${d.kecepatan_angin},${d.arah_angin},${d.status}\n`;
  });

  res.header("Content-Type", "text/csv");
  res.attachment(`${device}_${date}.csv`);
  res.send(csv);
});

app.post("/api/alerts/telegram", requireAuth, async (req, res) => {
  try {
    const { title, message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }

    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      return res.status(503).json({ error: "Telegram is not configured" });
    }

    const header = title ? `<b>${String(title)}</b>\n` : "";
    const payload = `${header}${String(message)}`;

    await sendTelegramMessage(payload, TELEGRAM_CHAT_ID, "HTML");
    res.json({ ok: true });
  } catch (error) {
    console.error("Telegram alert error:", error.message || error);
    res.status(500).json({ error: "Failed to send Telegram alert" });
  }
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, name, phone, department } = req.body || {};

    if (!email || !password || !name || !phone) {
      return res.status(400).json({ error: "email, password, name, and phone are required" });
    }

    if (String(password).length < 6) {
      return res.status(400).json({ error: "password must be at least 6 characters" });
    }

    const userRecord = await admin.auth().createUser({
      email: String(email).trim(),
      password: String(password),
      displayName: String(name).trim(),
      disabled: true
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, { role: "user" });

    const createdAt = new Date().toISOString();
    const createdIp = getClientIp(req);

    await db.ref(`users/${userRecord.uid}`).set({
      name: String(name).trim(),
      phone: String(phone).trim(),
      department: department ? String(department).trim() : "",
      email: String(email).trim(),
      role: "user",
      enabled: false,
      approvalStatus: "pending",
      devices: ["*"],
      createdAt,
      createdIp,
      createdBy: "self-signup"
    });

    await notifyAdminNewSignup({
      name: String(name).trim(),
      email: String(email).trim(),
      phone: String(phone).trim(),
      department: department ? String(department).trim() : "",
      createdIp,
      createdAt
    }).catch((error) => {
      console.warn("Failed to notify admin about signup:", error.message || error);
    });

    res.status(201).json({
      ok: true,
      message: "Pendaftaran berhasil. Akun menunggu persetujuan admin sebelum bisa login."
    });
  } catch (error) {
    console.error("Signup error:", error);
    if (error && error.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "Email sudah terdaftar" });
    }
    res.status(500).json({ error: "Failed to process signup" });
  }
});

app.get("/api/me", requireAuth, async (req, res) => {
  const { uid } = req.user;
  await touchUserActivity(uid, req, { markLogin: true }).catch((error) => {
    console.error("Failed to update login activity:", error.message || error);
  });

  const profileSnap = await db.ref(`users/${uid}`).once("value");
  const profile = profileSnap.val() || {};

  res.json({
    uid,
    email: req.user.email || profile.email || null,
    role: req.user.role,
    devices: Array.isArray(profile.devices) ? profile.devices : req.user.devices,
    name: profile.name || "",
    phone: profile.phone || "",
    department: profile.department || "",
    approvalStatus: profile.approvalStatus || (profile.enabled === false ? "pending" : "approved"),
    createdAt: profile.createdAt || null,
    lastLoginAt: profile.lastLoginAt || null,
    lastLoginIp: profile.lastLoginIp || null,
    lastActivityAt: profile.lastActivityAt || null,
    lastActivityIp: profile.lastActivityIp || null,
    authRequired: AUTH_REQUIRED
  });
});

app.patch("/api/me/profile", requireAuth, async (req, res) => {
  try {
    const uid = req.user.uid;
    const { name, phone, department } = req.body || {};

    if (!name || !phone) {
      return res.status(400).json({ error: "name and phone are required" });
    }

    const payload = {
      name: String(name).trim(),
      phone: String(phone).trim(),
      department: department ? String(department).trim() : "",
      updatedAt: new Date().toISOString(),
      updatedBy: uid
    };

    await db.ref(`users/${uid}`).update(payload);
    await admin.auth().updateUser(uid, { displayName: payload.name });

    const profileSnap = await db.ref(`users/${uid}`).once("value");
    const profile = profileSnap.val() || {};

    res.json({
      ok: true,
      profile: {
        uid,
        email: req.user.email || profile.email || null,
        role: req.user.role,
        devices: Array.isArray(profile.devices) ? profile.devices : req.user.devices,
        name: profile.name || "",
        phone: profile.phone || "",
        department: profile.department || "",
        approvalStatus: profile.approvalStatus || (profile.enabled === false ? "pending" : "approved"),
        createdAt: profile.createdAt || null,
        lastLoginAt: profile.lastLoginAt || null,
        lastLoginIp: profile.lastLoginIp || null,
        lastActivityAt: profile.lastActivityAt || null,
        lastActivityIp: profile.lastActivityIp || null,
        authRequired: AUTH_REQUIRED
      }
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

app.get("/api/member/table", requireAuth, async (req, res) => {
  try {
    const query = parseMemberTableQuery(req);
    const { requestedDevice } = query;

    if (requestedDevice && !canAccessDevice(req.user, requestedDevice)) {
      return res.status(403).json({ error: "Access denied for this device" });
    }

    const rows = await getMemberTableRows(req.user, query);
    res.json({ rows });
  } catch (error) {
    if (/startDate|endDate/.test(String(error.message || ""))) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Member table error:", error);
    res.status(500).json({ error: "Failed to load member table" });
  }
});

app.get("/api/member/table/download", requireAuth, async (req, res) => {
  try {
    const query = parseMemberTableQuery(req);
    const { requestedDevice, startDate, endDate } = query;

    if (requestedDevice && !canAccessDevice(req.user, requestedDevice)) {
      return res.status(403).json({ error: "Access denied for this device" });
    }

    const rows = await getMemberTableRows(req.user, query);

    let csv = "timestamp,device,pm25,pm10,suhu,kelembaban,kecepatan_angin,arah_angin,status\n";
    rows.forEach((row) => {
      csv += `${row.timestamp},${row.device},${row.pm25},${row.pm10},${row.suhu},${row.kelembaban},${row.kecepatan_angin},${row.arah_angin},${row.status}\n`;
    });

    const safeDevice = (requestedDevice || "all")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .toLowerCase();
    const dateStart = startDate || "awal";
    const dateEnd = endDate || "akhir";
    const filename = `member_${safeDevice}_${dateStart}_${dateEnd}.csv`;

    res.header("Content-Type", "text/csv");
    res.attachment(filename);
    res.send(csv);
  } catch (error) {
    if (/startDate|endDate/.test(String(error.message || ""))) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Member table download error:", error);
    res.status(500).json({ error: "Failed to download member table CSV" });
  }
});

app.get("/api/member/locations", requireAuth, async (req, res) => {
  try {
    const deviceIds = await getAccessibleDeviceIds(req.user);
    const locationSnap = await db.ref("deviceLocations").once("value");
    const allLocations = locationSnap.val() || {};

    const rows = deviceIds.map((device) => {
      const loc = allLocations[device] || {};
      return {
        device,
        name: loc.name || device,
        lat: Number(loc.lat) || -2.8441,
        lng: Number(loc.lng) || 117.3656,
        updatedAt: loc.updatedAt || null,
        updatedBy: loc.updatedBy || null
      };
    });

    res.json({ locations: rows });
  } catch (error) {
    console.error("Member locations error:", error);
    res.status(500).json({ error: "Failed to load locations" });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const list = await admin.auth().listUsers(1000);

    const users = await Promise.all(list.users.map(async (u) => {
      const profileSnap = await db.ref(`users/${u.uid}`).once("value");
      const profile = profileSnap.val() || {};

      return {
        uid: u.uid,
        email: u.email || null,
        displayName: u.displayName || profile.name || "",
        phone: profile.phone || "",
        department: profile.department || "",
        disabled: !!u.disabled,
        role: normalizeRole(profile.role || (u.customClaims && u.customClaims.role)),
        enabled: profile.enabled !== false,
        approvalStatus: profile.approvalStatus || (profile.enabled === false ? "pending" : "approved"),
        createdAt: profile.createdAt || (u.metadata?.creationTime ? new Date(u.metadata.creationTime).toISOString() : null),
        lastLoginAt: profile.lastLoginAt || null,
        lastLoginIp: profile.lastLoginIp || null,
        lastActivityAt: profile.lastActivityAt || null,
        lastActivityIp: profile.lastActivityIp || null,
        devices: Array.isArray(profile.devices) ? profile.devices : []
      };
    }));

    res.json({ users });
  } catch (error) {
    console.error("List users error:", error);
    res.status(500).json({ error: "Failed to list users" });
  }
});

app.post("/api/admin/users", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { email, password, name, role, devices, phone, department } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const safeRole = normalizeRole(role);
    const inputDevices = Array.isArray(devices) ? devices : [];
    const safeDevices = safeRole === "user" && inputDevices.length === 0
      ? ["*"]
      : inputDevices;

    const userRecord = await admin.auth().createUser({
      email: String(email).trim(),
      password: String(password),
      displayName: name || ""
    });

    await admin.auth().setCustomUserClaims(userRecord.uid, { role: safeRole });

    await db.ref(`users/${userRecord.uid}`).set({
      name: name || "",
      phone: phone || "",
      department: department || "",
      email,
      role: safeRole,
      enabled: true,
      approvalStatus: "approved",
      devices: safeDevices,
      createdAt: new Date().toISOString(),
      createdIp: getClientIp(req),
      approvedAt: new Date().toISOString(),
      approvedBy: req.user.uid,
      createdBy: req.user.uid
    });

    res.status(201).json({ uid: userRecord.uid, email, role: safeRole, devices: safeDevices });
  } catch (error) {
    console.error("Create user error:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
});

app.patch("/api/admin/users/:uid/role", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const safeRole = normalizeRole(req.body.role);

    await admin.auth().setCustomUserClaims(uid, { role: safeRole });
    await db.ref(`users/${uid}`).update({ role: safeRole, updatedAt: new Date().toISOString(), updatedBy: req.user.uid });

    res.json({ uid, role: safeRole });
  } catch (error) {
    console.error("Update role error:", error);
    res.status(500).json({ error: "Failed to update role" });
  }
});

app.patch("/api/admin/users/:uid/approval", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const action = String(req.body?.action || "").toLowerCase();

    if (action !== "approve" && action !== "reject") {
      return res.status(400).json({ error: "action must be approve or reject" });
    }

    const nowIso = new Date().toISOString();

    if (action === "approve") {
      await admin.auth().updateUser(uid, { disabled: false });
      await db.ref(`users/${uid}`).update({
        enabled: true,
        approvalStatus: "approved",
        approvedAt: nowIso,
        approvedBy: req.user.uid,
        updatedAt: nowIso,
        updatedBy: req.user.uid
      });
      return res.json({ uid, action, enabled: true, approvalStatus: "approved" });
    }

    await admin.auth().updateUser(uid, { disabled: true });
    await db.ref(`users/${uid}`).update({
      enabled: false,
      approvalStatus: "rejected",
      rejectedAt: nowIso,
      rejectedBy: req.user.uid,
      updatedAt: nowIso,
      updatedBy: req.user.uid
    });

    res.json({ uid, action, enabled: false, approvalStatus: "rejected" });
  } catch (error) {
    console.error("Update approval error:", error);
    res.status(500).json({ error: "Failed to update approval" });
  }
});

app.patch("/api/admin/users/:uid/status", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const enabled = req.body.enabled !== false;
    const profileSnap = await db.ref(`users/${uid}`).once("value");
    const profile = profileSnap.val() || {};

    await admin.auth().updateUser(uid, { disabled: !enabled });

    const updatePayload = {
      enabled,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.uid
    };

    if (enabled) {
      updatePayload.approvalStatus = "approved";
      if (!profile.approvedAt) {
        updatePayload.approvedAt = new Date().toISOString();
      }
      if (!profile.approvedBy) {
        updatePayload.approvedBy = req.user.uid;
      }
    } else if ((profile.approvalStatus || "") !== "pending") {
      updatePayload.approvalStatus = "disabled";
    }

    await db.ref(`users/${uid}`).update(updatePayload);

    res.json({ uid, enabled });
  } catch (error) {
    console.error("Update status error:", error);
    res.status(500).json({ error: "Failed to update status" });
  }
});

app.patch("/api/admin/users/:uid/devices", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { uid } = req.params;
    const devices = Array.isArray(req.body.devices) ? req.body.devices : [];

    await db.ref(`users/${uid}`).update({ devices, updatedAt: new Date().toISOString() });
    res.json({ uid, devices });
  } catch (error) {
    console.error("Update devices error:", error);
    res.status(500).json({ error: "Failed to update devices" });
  }
});

app.patch("/api/admin/locations/:device", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { device } = req.params;
    const { lat, lng, name } = req.body;

    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
      return res.status(400).json({ error: "lat and lng must be valid numbers" });
    }

    await db.ref(`deviceLocations/${device}`).set({
      name: name || device,
      lat: Number(lat),
      lng: Number(lng),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.uid
    });

    res.json({ device, name: name || device, lat: Number(lat), lng: Number(lng) });
  } catch (error) {
    console.error("Update location error:", error);
    res.status(500).json({ error: "Failed to update location" });
  }
});

app.patch("/api/admin/data/:device/:entryKey", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { device, entryKey } = req.params;
    const existingSnap = await db.ref(`devices/${device}/history/${entryKey}`).once("value");
    const existingRow = existingSnap.val() || {};
    const row = sanitizeRow({ ...existingRow, ...(req.body || {}) });

    await db.ref(`devices/${device}/history/${entryKey}`).update(row);
    res.json({ device, entryKey, row });
  } catch (error) {
    console.error("Update data row error:", error);
    res.status(500).json({ error: "Failed to update data row" });
  }
});

app.delete("/api/admin/data/:device/:entryKey", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { device, entryKey } = req.params;
    await db.ref(`devices/${device}/history/${entryKey}`).remove();
    res.json({ device, entryKey, deleted: true });
  } catch (error) {
    console.error("Delete data row error:", error);
    res.status(500).json({ error: "Failed to delete data row" });
  }
});

let lastAlertSignatures = new Map(); // device -> signature

function getAlertSignature(device, pm25, status) {
  return `${device}:${pm25}:${status}`;
}

function shouldSendAlert(device, pm25, status) {
  const signature = getAlertSignature(device, pm25, status);
  const lastSignature = lastAlertSignatures.get(device);
  
  if (lastSignature === signature) {
    return false; // duplicate alert
  }
  
  // Only send alerts for dangerous or warning levels
  if (status !== 'BAHAYA' && status !== 'WASPADA') {
    return false;
  }
  
  lastAlertSignatures.set(device, signature);
  return true;
}

async function sendAutoTelegramAlert(device, data) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram not configured, skipping auto alert');
    return;
  }
  
  const status = getStatus(data.pm25);
  if (!shouldSendAlert(device, data.pm25, status)) {
    return;
  }
  
  try {
    const statusEmoji = status === 'BAHAYA' ? '🚨' : status === 'WASPADA' ? '⚠️' : '✅';
    const statusColor = status === 'BAHAYA' ? '🔴' : status === 'WASPADA' ? '🟡' : '🟢';
    
    const message = `${statusEmoji} *PERINGATAN KUALITAS UDARA* ${statusEmoji}\n\n` +
      `📍 *Lokasi*: ${device}\n` +
      `🌫️ *PM2.5*: ${data.pm25} µg/m³\n` +
      `${statusColor} *Status*: ${status}\n` +
      `🕐 *Waktu*: ${new Date(data.timestamp).toLocaleString('id-ID')}\n\n` +
      `📊 *Kategori AQI*:\n` +
      `${status === 'BAHAYA' ? '🔴' : '⚪'} BAHAYA: PM2.5 ≥ 150 µg/m³\n` +
      `${status === 'WASPADA' ? '🟡' : '⚪'} WASPADA: PM2.5 75-149 µg/m³\n` +
      `${status === 'AMAN' ? '🟢' : '⚪'} AMAN: PM2.5 < 75 µg/m³\n\n` +
      `_🤖 Sistem Alert Otomatis_`;
    
    await sendTelegramMessage(message, TELEGRAM_CHAT_ID);
    console.log(`Auto Telegram alert sent for ${device}: PM2.5=${data.pm25}, Status=${status}`);
  } catch (error) {
    console.error('Failed to send auto Telegram alert:', error.message);
  }
}

// Listen for device data changes
db.ref('devices').on('child_changed', (snapshot) => {
  const deviceKey = snapshot.key;
  const deviceData = snapshot.val();
  
  if (deviceData && deviceData.current) {
    const current = deviceData.current;
    console.log(`Device ${deviceKey} updated: PM2.5=${current.pm25}`);
    sendAutoTelegramAlert(deviceKey, current);
  }
});

console.log('Server-side Telegram alerts enabled');

// ================= TELEGRAM BOT POLLING =================

let lastTelegramUpdateId = 0;
let isPolling = false;
const processedUpdates = new Set();
const processedCommands = new Set(); // Track command hashes

async function pollTelegramUpdates() {
  if (!TELEGRAM_BOT_TOKEN || isPolling) return;

  isPolling = true;
  console.log('Polling Telegram updates with offset:', lastTelegramUpdateId + 1);
  try {
    const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastTelegramUpdateId + 1}&timeout=30`;
    const response = await fetch(endpoint, { timeout: 35000 });
    if (!response.ok) {
      console.error('Telegram API error:', response.status, await response.text());
      return;
    }

    const data = await response.json();
    console.log('Received', data.result.length, 'updates from Telegram');
    if (data.ok && data.result) {
      for (const update of data.result) {
        // Skip if already processed
        if (processedUpdates.has(update.update_id)) {
          console.log('Skipping already processed update ID:', update.update_id);
          continue;
        }
        
        console.log('Processing update ID:', update.update_id);
        await processTelegramUpdate(update);
        lastTelegramUpdateId = Math.max(lastTelegramUpdateId, update.update_id);
        processedUpdates.add(update.update_id);
        
        // Clean old processed updates (keep last 100)
        if (processedUpdates.size > 100) {
          const oldestId = Math.min(...processedUpdates);
          processedUpdates.delete(oldestId);
        }
      }
    }
  } catch (error) {
    console.error('Poll Telegram error:', error.message || error);
  } finally {
    isPolling = false;
  }
}

async function processTelegramUpdate(update) {
  if (!update.message) return;
  const message = update.message;
  const chatId = message.chat.id;

  // For security, only respond to configured chat
  if (chatId.toString() !== TELEGRAM_CHAT_ID) return;

  const text = message.text?.trim();
  if (!text) return;

  // Create command hash for deduplication
  const commandHash = `${text}:${Math.floor(update.message.date / 60)}`; // Hash by text and minute
  if (processedCommands.has(commandHash)) {
    console.log('Skipping duplicate command:', commandHash);
    return;
  }

  await handleTelegramCommand(text, chatId);
  processedCommands.add(commandHash);
  
  // Clean old command hashes (keep last 50)
  if (processedCommands.size > 50) {
    const oldestHash = processedCommands.values().next().value;
    processedCommands.delete(oldestHash);
  }
}

async function handleTelegramCommand(command, chatId) {
  console.log('Processing Telegram command:', command, 'from chat:', chatId);
  const parts = command.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '/help') {
    const help = `🤖 *MENU BANTUAN BOT AQI* 🤖\n\n` +
      `📋 *Daftar Perintah:*\n` +
      `/devices - 📱 Daftar semua device\n` +
      `/aqi <device> - 🌫️ Cek AQI saat ini\n` +
      `/history <device> \\[limit\\] - � Riwayat pengukuran\n` +
      `/location <device> - � Lokasi device\n` +
      `/status <device> - � Status kualitas udara\n\n` +
      `💡 *Contoh Penggunaan:*\n` +
      `• /aqi SECTOR\\_A1\n` +
      `• /history SECTOR\\_A1 5\n` +
      `• /location SECTOR\\_A1\n` +
      `• /aqi SECTOR\\_A1\n` +
      `• /history SECTOR\\_A1 5\n` +
      `• /location SECTOR\\_A1\n` +
      `• /status SECTOR\\_A1\n\n` +
      `_🔔 Bot akan otomatis notifikasi jika AQI berbahaya_`;
    console.log('Sending help:', help);
    await sendTelegramMessage(help, chatId);
  } else if (cmd === '/devices' || cmd === '/get_devices') {
    try {
      const current = await getCurrentAsGuest();
      const devices = Object.keys(current);

      if (devices.length === 0) {
        const msg = `❌ *Tidak Ada Device*\n\nBelum ada device yang terdaftar dalam sistem.`;
        await sendTelegramMessage(msg, chatId);
        return;
      }

      let msg = `📱 *DAFTAR DEVICE MONITORING* 📱\n\n`;
      msg += `📊 Total Device: ${devices.length}\n\n`;

      devices.forEach((device, index) => {
        const data = current[device];
        const status = getStatus(data.pm25);
        const emoji = status === 'BAHAYA' ? '🔴' : status === 'WASPADA' ? '🟡' : '🟢';
        msg += `${index + 1}. ${device}\n`;
        msg += `   ${emoji} PM2.5: ${data.pm25} µg/m³ - ${status}\n`;
        msg += `   🕐 Update: ${new Date(data.timestamp).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' })}\n\n`;
      });

      msg += `_💡 Ketik /aqi <device> untuk detail lengkap_`;
      console.log('Sending devices:', msg);
      await sendTelegramMessage(msg, chatId);
    } catch (error) {
      const msg = `❌ ERROR\n\nGagal mengambil data device. Silakan coba lagi.`;
      console.log('Sending error:', msg);
      await sendTelegramMessage(msg, chatId);
    }
  } else if (cmd === '/aqi' || cmd === '/get_aqi') {
    const device = parts[1];
    if (!device) {
      const msg = `❌ FORMAT SALAH\n\n` +
        `📝 Cara Penggunaan:\n` +
        `/aqi <device>\n\n` +
        `💡 Contoh: /aqi SECTOR_A1`;
      console.log('Sending usage:', msg);
      await sendTelegramMessage(msg, chatId);
      return;
    }

    try {
      const current = await getCurrentAsGuest();
      const data = current[device];
      if (!data) {
        const msg = `❌ *Device Tidak Ditemukan*\n\n` +
          `Device \`${device}\` tidak terdaftar dalam sistem.\n\n` +
          `💡 Ketik /devices untuk melihat daftar device`;
        console.log('Sending not found:', msg);
        await sendTelegramMessage(msg, chatId);
        return;
      }

      console.log('Data for', device, ':', JSON.stringify(data));
      const status = getStatus(data.pm25);
      const statusEmoji = status === 'BAHAYA' ? '🚨' : status === 'WASPADA' ? '⚠️' : '✅';
      const statusColor = status === 'BAHAYA' ? '🔴' : status === 'WASPADA' ? '🟡' : '🟢';

      const msg = `${statusEmoji} *INDEKS KUALITAS UDARA* ${statusEmoji}\n\n` +
        `📍 *Lokasi*: ${device}\n` +
        `🌫️ *PM2.5*: ${data.pm25} µg/m³\n` +
        `💨 *PM10*: ${data.pm10 || 'N/A'} µg/m³\n` +
        `🌡️ *Suhu*: ${data.suhu || 'N/A'}°C\n` +
        `💧 *Kelembaban*: ${data.kelembaban || 'N/A'}%\n` +
        `💨 *Kecepatan Angin*: ${data.kecepatan_angin || 'N/A'} m/s\n` +
        `${statusColor} *Status*: ${status}\n` +
        `🕐 *Update*: ${new Date(data.timestamp).toLocaleString('id-ID')}\n\n` +
        `📊 *Kategori AQI*:\n` +
        `🔴 BAHAYA: PM2.5 ≥ 150 µg/m³\n` +
        `🟡 WASPADA: PM2.5 75-149 µg/m³\n` +
        `🟢 AMAN: PM2.5 < 75 µg/m³`;

      console.log('Sending AQI:', msg);
      await sendTelegramMessage(msg, chatId);
    } catch (error) {
      const msg = `❌ *Error*\n\nGagal mengambil data AQI. Silakan coba lagi.`;
      console.log('Sending error:', msg);
      await sendTelegramMessage(msg, chatId);
    }
  } else if (cmd === '/history' || cmd === '/get_history') {
    const device = parts[1];
    const limit = Math.min(parseInt(parts[2]) || 10, 50); // max 50

    if (!device) {
      const msg = `❌ *Format Salah*\n\n` +
        `📝 *Cara Penggunaan:*\n` +
        `/history <device> \\[limit\\]\n\n` +
        `💡 *Contoh:* /history SECTOR_A1 5`;
      console.log('Sending usage:', msg);
      await sendTelegramMessage(msg, chatId);
      return;
    }

    try {
      const history = await getHistoryAsGuest(device, limit);
      const entries = Object.values(history).slice(-limit);

      if (entries.length === 0) {
        const msg = `❌ *Data Tidak Ada*\n\n` +
          `Tidak ada riwayat data untuk device \`${device}\`.`;
        console.log('Sending no history:', msg);
        await sendTelegramMessage(msg, chatId);
        return;
      }

      let msg = `📊 *RIWAYAT PENGUKURAN* 📊\n\n` +
        `📍 Device: ${device}\n` +
        `📈 Menampilkan ${entries.length} data terakhir\n\n`;

      entries.reverse().forEach((entry, index) => {
        const status = getStatus(entry.pm25);
        const emoji = status === 'BAHAYA' ? '🔴' : status === 'WASPADA' ? '🟡' : '🟢';
        const time = new Date(entry.timestamp).toLocaleString('id-ID', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        msg += `${index + 1}. ${time}\n`;
        msg += `   ${emoji} PM2.5: ${entry.pm25} µg/m³ - ${status}\n\n`;
      });

      msg += `_💡 Ketik /aqi ${device} untuk data saat ini_`;
      console.log('Sending history:', msg.substring(0, 100) + '...');
      await sendTelegramMessage(msg, chatId);
    } catch (error) {
      const msg = `❌ *Error*\n\nGagal mengambil riwayat data. Silakan coba lagi.`;
      console.log('Sending error:', msg);
      await sendTelegramMessage(msg, chatId);
    }
  } else if (cmd === '/location') {
    const device = parts[1];
    if (!device) {
      const msg = `❌ *Format Salah*\n\n` +
        `📝 *Cara Penggunaan:*\n` +
        `/location <device>\n\n` +
        `💡 *Contoh:* /location SECTOR_A1`;
      console.log('Sending location usage:', msg);
      await sendTelegramMessage(msg, chatId);
      return;
    }

    try {
      const locationSnap = await db.ref(`deviceLocations/${device}`).once('value');
      const location = locationSnap.val();
      
      if (!location) {
        const msg = `❌ *Lokasi Tidak Ditemukan*\n\n` +
          `Device \`${device}\` belum memiliki data lokasi.\n\n` +
          `📍 *Koordinat Default:*\n` +
          `• Latitude: -2.8441\n` +
          `• Longitude: 117.3656`;
        console.log('Sending location not found:', msg);
        await sendTelegramMessage(msg, chatId);
        return;
      }

      const msg = `📍 *INFORMASI LOKASI* 📍\n\n` +
        `🏷️ *Device*: ${device}\n` +
        `📝 *Nama*: ${location.name || device}\n` +
        `🌍 *Latitude*: ${location.lat}\n` +
        `🌍 *Longitude*: ${location.lng}\n` +
        `🕐 *Update*: ${location.updatedAt ? new Date(location.updatedAt).toLocaleString('id-ID') : 'N/A'}\n` +
        `👤 *Updated By*: ${location.updatedBy || 'N/A'}\n\n` +
        `🗺️ [Buka di Google Maps](https://www.google.com/maps?q=${location.lat},${location.lng})`;
      
      console.log('Sending location:', msg);
      await sendTelegramMessage(msg, chatId);
    } catch (error) {
      const msg = `❌ *Error*\n\nGagal mengambil data lokasi. Silakan coba lagi.`;
      console.log('Sending location error:', msg);
      await sendTelegramMessage(msg, chatId);
    }
  } else if (cmd === '/status') {
    const device = parts[1];
    if (!device) {
      const msg = `❌ *Format Salah*\n\n` +
        `📝 *Cara Penggunaan:*\n` +
        `/status <device>\n\n` +
        `💡 *Contoh:* /status SECTOR_A1`;
      console.log('Sending status usage:', msg);
      await sendTelegramMessage(msg, chatId);
      return;
    }

    try {
      const current = await getCurrentAsGuest();
      const data = current[device];
      if (!data) {
        const msg = `❌ *Device Tidak Ditemukan*\n\n` +
          `Device \`${device}\` tidak terdaftar dalam sistem.`;
        console.log('Sending status not found:', msg);
        await sendTelegramMessage(msg, chatId);
        return;
      }

      const status = getStatus(data.pm25);
      const statusEmoji = status === 'BAHAYA' ? '🚨' : status === 'WASPADA' ? '⚠️' : '✅';
      const statusColor = status === 'BAHAYA' ? '🔴' : status === 'WASPADA' ? '🟡' : '🟢';
      
      const msg = `${statusEmoji} *STATUS KUALITAS UDARA* ${statusEmoji}\n\n` +
        `📍 *Lokasi*: ${device}\n` +
        `${statusColor} *Status*: ${status}\n` +
        `🌫️ *PM2.5*: ${data.pm25} µg/m³\n` +
        `🕐 *Update*: ${new Date(data.timestamp).toLocaleString('id-ID')}\n\n` +
        `📊 *Keterangan Status*:\n` +
        `${status === 'BAHAYA' ? '🔴' : '⚪'} **BAHAYA** - Udara sangat tidak sehat, hindari aktivitas outdoor\n` +
        `${status === 'WASPADA' ? '🟡' : '⚪'} **WASPADA** - Udara tidak sehat, batasi aktivitas outdoor\n` +
        `${status === 'AMAN' ? '🟢' : '⚪'} **AMAN** - Udara aman untuk aktivitas`;
      
      console.log('Sending status:', msg);
      await sendTelegramMessage(msg, chatId);
    } catch (error) {
      const msg = `❌ *Error*\n\nGagal mengambil data status. Silakan coba lagi.`;
      console.log('Sending status error:', msg);
      await sendTelegramMessage(msg, chatId);
    }
  } else {
    const msg = `❌ *Perintah Tidak Dikenal*\n\n` +
      `Ketik /help untuk melihat daftar perintah yang tersedia.`;
    console.log('Sending unknown:', msg);
    await sendTelegramMessage(msg, chatId);
  }
}

async function getCurrentAsGuest() {
  const snapshot = await db.ref("devices").once("value");
  const all = snapshot.val() || {};
  const current = {};
  for (const device in all) {
    if (all[device].current) {
      current[device] = all[device].current;
    }
  }
  console.log('Fetched current devices:', Object.keys(current));
  return current;
}

async function getHistoryAsGuest(device, limit) {
  const snapshot = await db.ref(`devices/${device}/history`).once("value");
  const data = snapshot.val() || {};
  console.log('Fetched history for device:', device, 'with', Object.keys(data).length, 'entries');
  return Object.values(data).slice(-limit); // Return the last 'limit' entries
}

async function sendTelegramMessage(text, chatId, parseMode = 'Markdown') {
  if (!TELEGRAM_BOT_TOKEN || !chatId) {
    return { ok: false, reason: "Telegram is not configured" };
  }

  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    console.error('Send Telegram message failed:', response.status, payload);
    throw new Error(`Telegram API error: ${response.status} ${payload}`);
  }

  return { ok: true };
}

setInterval(pollTelegramUpdates, 5000);

// ================= START SERVER =================
app.listen(3000, () => {
  console.log("Web server running at http://localhost:3000");
});