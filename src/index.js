import dgram from "dgram";
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse, toJSON } from "./parser.js";
import { SessionManager } from "./session.js";

let __dirname;
if (import.meta.url) {
  __dirname = path.dirname(fileURLToPath(import.meta.url));
} else {
  __dirname = path.dirname(__filename);
}

const PORT = process.env.PORT || 20440;
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const OUTPUT_DIR = "./sessions";

let sessionManager = new SessionManager(true);
let currentSession = null;
let currentSessionPackets = [];
let currentSessionLaps = [];
let sessionCounter = 0;
let lastClosedSessionData = null;

let sseClients = new Set();

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
}

function getTimestamp() {
  return Date.now();
}

function broadcastToSSE(data) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(message);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

function formatTime(seconds) {
  if (seconds <= 0 || !isFinite(seconds)) return "--:--.---";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function downsample(packets, factor) {
  if (factor <= 1) return packets;
  const result = [];
  for (let i = 0; i < packets.length; i += factor) {
    result.push(packets[i]);
  }
  return result;
}

function buildCompactExport(sessionPackets, sessionLaps, bestLap, sessionInfo) {
  const pkts = sessionPackets;
  if (pkts.length === 0) return null;

  // ── Summary ──────────────────────────────────────────────────────
  let maxSpeed = 0,
    maxRpm = 0,
    maxPower = 0,
    maxTorque = 0,
    maxBoost = -Infinity;
  let totalFuel = 0,
    fuelSamples = 0;
  let maxLatG = 0,
    maxLongG = 0;

  for (const p of pkts) {
    if (p.speedKmh > maxSpeed) maxSpeed = p.speedKmh;
    if (p.currentEngineRpm > maxRpm) maxRpm = p.currentEngineRpm;
    if (p.power > maxPower) maxPower = p.power;
    if (p.torque > maxTorque) maxTorque = p.torque;
    if (p.boost > maxBoost) maxBoost = p.boost;
    if (p.fuel > 0) {
      totalFuel += p.fuel;
      fuelSamples++;
    }
    const latG = Math.abs(p.accelX / 9.80665);
    const longG = Math.abs(p.accelZ / 9.80665);
    if (latG > maxLatG) maxLatG = latG;
    if (longG > maxLongG) maxLongG = longG;
  }

  const summary = {
    carOrdinal: sessionInfo.carOrdinal,
    carClass: sessionInfo.carClass,
    carPi: sessionInfo.carPi,
    durationMs:
      pkts.length > 0
        ? pkts[pkts.length - 1].timestampMs - pkts[0].timestampMs
        : 0,
    packetCount: pkts.length,
    lapCount: sessionLaps.length,
    bestLap: bestLap > 0 ? Math.round(bestLap * 1000) / 1000 : null,
    maxSpeedKmh: Math.round(maxSpeed * 10) / 10,
    maxRpm: Math.round(maxRpm),
    maxPowerKw: Math.round((maxPower / 1000) * 10) / 10,
    maxTorqueNm: Math.round(maxTorque * 10) / 10,
    maxBoostPsi: Math.round(maxBoost * 100) / 100,
    avgFuel:
      fuelSamples > 0
        ? Math.round((totalFuel / fuelSamples) * 1000) / 1000
        : null,
    maxLatG: Math.round(maxLatG * 100) / 100,
    maxLongG: Math.round(maxLongG * 100) / 100,
  };

  // ── Per-lap stats ────────────────────────────────────────────────
  const lapStats = sessionLaps.map((lap) => {
    return {
      lapNumber: lap.lapNumber,
      lapTime: Math.round(lap.lapTime * 1000) / 1000,
    };
  });

  // ── Sectors (10 per lap) ────────────────────────────────────────
  const sectors = [];
  const lapBoundaries = [0];
  for (let i = 1; i < pkts.length; i++) {
    if (pkts[i].lapNumber !== pkts[i - 1].lapNumber) {
      lapBoundaries.push(i);
    }
  }
  lapBoundaries.push(pkts.length);

  for (let li = 0; li < lapBoundaries.length - 1; li++) {
    const start = lapBoundaries[li];
    const end = lapBoundaries[li + 1];
    const lapPkts = pkts.slice(start, end);
    if (lapPkts.length < 10) continue;
    const sectorsPerLap = 10;
    const sectorSize = Math.floor(lapPkts.length / sectorsPerLap);

    for (let s = 0; s < sectorsPerLap; s++) {
      const seg = lapPkts.slice(s * sectorSize, (s + 1) * sectorSize);
      if (seg.length === 0) continue;

      let sumSpeed = 0,
        segMaxSpeed = 0,
        sumRpm = 0,
        segMaxRpm = 0;
      let sumThrottle = 0,
        sumBrake = 0;
      let sumLatG = 0,
        sumLongG = 0;
      let sumTempFl = 0,
        sumTempFr = 0,
        sumTempRl = 0,
        sumTempRr = 0;
      let sumBoost = 0,
        sumPower = 0;

      for (const p of seg) {
        sumSpeed += p.speedKmh;
        if (p.speedKmh > segMaxSpeed) segMaxSpeed = p.speedKmh;
        sumRpm += p.currentEngineRpm;
        if (p.currentEngineRpm > segMaxRpm) segMaxRpm = p.currentEngineRpm;
        sumThrottle += p.throttle;
        sumBrake += p.brake;
        sumLatG += Math.abs(p.accelX / 9.80665);
        sumLongG += Math.abs(p.accelZ / 9.80665);
        sumTempFl += p.tireTempFl;
        sumTempFr += p.tireTempFr;
        sumTempRl += p.tireTempRl;
        sumTempRr += p.tireTempRr;
        sumBoost += p.boost;
        sumPower += p.power;
      }
      const n = seg.length;
      sectors.push({
        lap: li,
        sector: s,
        packetCount: n,
        avgSpeedKmh: Math.round((sumSpeed / n) * 10) / 10,
        maxSpeedKmh: Math.round(segMaxSpeed * 10) / 10,
        avgRpm: Math.round(sumRpm / n),
        maxRpm: Math.round(segMaxRpm),
        avgThrottlePct: Math.round((sumThrottle / n / 255) * 100),
        avgBrakePct: Math.round((sumBrake / n / 255) * 100),
        avgLatG: Math.round((sumLatG / n) * 100) / 100,
        avgLongG: Math.round((sumLongG / n) * 100) / 100,
        avgTireTempFl: Math.round((sumTempFl / n) * 10) / 10,
        avgTireTempFr: Math.round((sumTempFr / n) * 10) / 10,
        avgTireTempRl: Math.round((sumTempRl / n) * 10) / 10,
        avgTireTempRr: Math.round((sumTempRr / n) * 10) / 10,
        avgBoostPsi: Math.round((sumBoost / n) * 100) / 100,
        avgPowerKw: Math.round((sumPower / n / 1000) * 10) / 10,
      });
    }
  }

  // ── Downsampled samples (1/sec, ≈30:1 ratio) ─────────────────────
  const sampleFactor = 30;
  const samples = [];
  for (let i = 0; i < pkts.length; i += sampleFactor) {
    const p = pkts[i];
    samples.push({
      i,
      speedKmh: Math.round(p.speedKmh * 10) / 10,
      rpm: Math.round(p.currentEngineRpm),
      powerKw: Math.round((p.power / 1000) * 10) / 10,
      torqueNm: Math.round(p.torque * 10) / 10,
      throttlePct: Math.round((p.throttle / 255) * 100),
      brakePct: Math.round((p.brake / 255) * 100),
      gear: p.gear,
      latG: Math.round((p.accelX / 9.80665) * 100) / 100,
      longG: Math.round((p.accelZ / 9.80665) * 100) / 100,
      tireTempFl: Math.round(p.tireTempFl * 10) / 10,
      tireTempFr: Math.round(p.tireTempFr * 10) / 10,
      tireTempRl: Math.round(p.tireTempRl * 10) / 10,
      tireTempRr: Math.round(p.tireTempRr * 10) / 10,
      boostPsi: Math.round(p.boost * 100) / 100,
      fuel: Math.round(p.fuel * 1000) / 1000,
      lapNumber: p.lapNumber,
      racePosition: p.racePosition,
    });
  }

  return { summary, lapStats, sectors, samples };
}

function calculateSessionStats(packets) {
  if (packets.length === 0) return null;

  let maxSpeed = 0;
  let maxRpm = 0;
  let maxPower = 0;
  let totalFuel = 0;
  let fuelSamples = 0;
  let maxBoost = 0;

  for (const pkt of packets) {
    if (pkt.speedMs > maxSpeed) maxSpeed = pkt.speedMs;
    if (pkt.currentEngineRpm > maxRpm) maxRpm = pkt.currentEngineRpm;
    if (pkt.power > maxPower) maxPower = pkt.power;
    if (pkt.boost > maxBoost) maxBoost = pkt.boost;
    if (pkt.fuel > 0) {
      totalFuel += pkt.fuel;
      fuelSamples++;
    }
  }

  return {
    maxSpeedMs: Math.round(maxSpeed * 1000) / 1000,
    maxSpeedKmh: Math.round(maxSpeed * 3.6 * 100) / 100,
    maxRpm: Math.round(maxRpm),
    maxPower: Math.round(maxPower),
    avgFuel:
      fuelSamples > 0
        ? Math.round((totalFuel / fuelSamples) * 100) / 100
        : null,
    maxBoost: Math.round(maxBoost * 100) / 100,
    durationMs:
      packets.length > 0
        ? packets[packets.length - 1].timestampMs - packets[0].timestampMs
        : 0,
    packetCount: packets.length,
  };
}

function saveSession(session) {
  ensureOutputDir();
  const filename = `session_${String(session.id).padStart(4, "0")}_${session.carOrdinal}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);

  const sessionData = {
    id: session.id,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
    carOrdinal: session.carOrdinal,
    carClass: session.carClass,
    carPi: session.carPi,
    bestLap: session.bestLap,
    packetCount: session.packets.length,
    laps: session.laps.map((lap) => ({
      lapNumber: lap.lapNumber,
      lapTime: lap.lapTime,
      lapTimeFormatted: formatTime(lap.lapTime),
    })),
    stats: calculateSessionStats(session.packets),
    packets: session.packets,
  };

  fs.writeFileSync(filepath, JSON.stringify(sessionData, null, 2));
  return filepath;
}

function openSession(carOrdinal, carClass, carPi) {
  sessionCounter++;
  currentSession = {
    id: sessionCounter,
    startedAt: getTimestamp(),
    endedAt: null,
    carOrdinal,
    carClass,
    carPi,
    bestLap: Infinity,
    packets: [],
    laps: [],
  };
  currentSessionPackets = [];
  currentSessionLaps = [];
  console.log(
    `[session] opened #${currentSession.id} (carOrdinal: ${carOrdinal}, PI: ${carPi})`,
  );
  return currentSession.id;
}

function closeSession() {
  if (!currentSession) return null;

  const finalLap = sessionManager.finalizeFinalLap();
  if (finalLap) {
    currentSessionLaps.push(finalLap);
  }

  if (currentSessionLaps.length > 0) {
    currentSession.bestLap = sessionManager.bestForClose();
  }

  currentSession.endedAt = getTimestamp();
  currentSession.packets = [...currentSessionPackets];
  currentSession.laps = [...currentSessionLaps];

  let filepath = null;
  if (currentSessionLaps.length > 0 || currentSessionPackets.length >= 400) {
    filepath = saveSession(currentSession);
    console.log(`[session] saved to ${filepath}`);
    console.log(
      `[session] laps: ${currentSession.laps.length}, packets: ${currentSession.packets.length}, best: ${currentSession.bestLap > 0 ? formatTime(currentSession.bestLap) : "N/A"}`,
    );
  } else {
    console.log(
      `[session] discarded empty session #${currentSession.id} (${currentSessionPackets.length} packets)`,
    );
  }

  // Keep a snapshot of the last closed session for /export after the race ends
  if (filepath) {
    const savedData = JSON.parse(fs.readFileSync(filepath, "utf8"));
    lastClosedSessionData = savedData;
  }

  currentSession = null;
  currentSessionPackets = [];
  currentSessionLaps = [];
  return filepath;
}

function handlePacket(pkt) {
  const json = toJSON(pkt);
  json.sessionId = sessionManager.activeId;

  if (currentSession) {
    currentSessionPackets.push(json);

    const progress =
      pkt.currentRaceTime > 0 ? pkt.currentRaceTime : pkt.currentLap;
    sessionManager.updateRaceTime(progress);

    const completedLap = sessionManager.noteTick(
      pkt.isRaceOn,
      pkt.currentLap,
      pkt.currentRaceTime,
    );
    if (completedLap) {
      currentSessionLaps.push(completedLap);
      json.completedLap = {
        lapNumber: completedLap.lapNumber,
        lapTime: completedLap.lapTime,
        lapTimeFormatted: formatTime(completedLap.lapTime),
      };
      console.log(
        `[lap] #${completedLap.lapNumber} - ${formatTime(completedLap.lapTime)}`,
      );
    }
  }

  return json;
}

function handleRaceStateChange(
  wasRacing,
  isRacing,
  carOrdinal,
  carClass,
  carPi,
) {
  const action = sessionManager.onRaceOnChange(
    wasRacing,
    isRacing,
    carOrdinal,
    carClass,
    carPi,
  );

  if (action === "open") {
    const progress = 0;
    if (sessionManager.checkReopen(progress, getTimestamp())) {
      sessionManager.activeId = sessionManager.closedId;
      console.log(
        `[session] rewind detected, continuing #${sessionManager.activeId}`,
      );
    } else {
      const id = openSession(carOrdinal, carClass, carPi);
      sessionManager.activeId = id;
    }
    sessionManager.beginNewSession();
  } else if (action === "close") {
    sessionManager.noteClose(getTimestamp());
    const filepath = closeSession();
    sessionManager.activeId = null;
    return filepath;
  }
  return null;
}

async function startUDP() {
  return new Promise((resolve) => {
    const server = dgram.createSocket("udp4");

    server.on("error", (err) => {
      console.error(`[udp] error: ${err.message}`);
      server.close();
    });

    let prevInEvent = false;
    let closePending = 0;
    const CLOSE_GRACE = 150;

    server.on("message", (msg, rinfo) => {
      try {
        const pkt = parse(msg);
        const json = handlePacket(pkt);

        broadcastToSSE(json);

        const timedLap = pkt.currentLap > 0.0;
        const rawInEvent = pkt.isRaceOn && (pkt.racePosition > 0 || timedLap);
        if (rawInEvent) {
          closePending = 0;
        } else {
          closePending = closePending + 1;
        }
        const inEvent = rawInEvent || closePending < CLOSE_GRACE;

        handleRaceStateChange(
          prevInEvent,
          inEvent,
          pkt.carOrdinal,
          pkt.carClass,
          pkt.carPi,
        );
        prevInEvent = inEvent;
      } catch (err) {
        // silent - ignore malformed packets
      }
    });

    server.on("listening", () => {
      const address = server.address();
      console.log(`[udp] listening on ${address.address}:${address.port}`);
      resolve(server);
    });

    server.bind(PORT);
  });
}

async function startHTTP() {
  const server = http.createServer((req, res) => {
    if (req.url === "/events") {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      sseClients.add(res);
      console.log(`[sse] client connected (${sseClients.size} total)`);

      req.on("close", () => {
        sseClients.delete(res);
        console.log(`[sse] client disconnected (${sseClients.size} total)`);
      });
      return;
    }

    if (req.url === "/export" || req.url?.startsWith("/export?")) {
      const params = req.url.startsWith("/export?")
        ? new URLSearchParams(req.url.split("?")[1])
        : null;
      const dsFactor = params ? parseInt(params.get("downsample"), 10) || 0 : 0;

      let exportData = null;
      let exportId = null;

      if (currentSession) {
        const sessionPackets = currentSessionPackets;
        const sessionLaps = currentSessionLaps;
        const bestLap =
          sessionManager.bestForClose() > 0
            ? sessionManager.bestForClose()
            : currentSession.bestLap;
        const pkts =
          dsFactor > 0 ? downsample(sessionPackets, dsFactor) : sessionPackets;

        exportData = {
          id: currentSession.id,
          startedAt: new Date(currentSession.startedAt).toISOString(),
          endedAt: currentSession.endedAt
            ? new Date(currentSession.endedAt).toISOString()
            : null,
          carOrdinal: currentSession.carOrdinal,
          carClass: currentSession.carClass,
          carPi: currentSession.carPi,
          bestLap: bestLap,
          packetCount: sessionPackets.length,
          laps: sessionLaps.map((lap) => ({
            lapNumber: lap.lapNumber,
            lapTime: lap.lapTime,
            lapTimeFormatted: formatTime(lap.lapTime),
          })),
          stats: calculateSessionStats(sessionPackets),
          packets: pkts,
        };
        exportId = currentSession.id;
      } else if (lastClosedSessionData) {
        exportData = lastClosedSessionData;
        if (dsFactor > 0) {
          exportData = {
            ...exportData,
            packets: downsample(exportData.packets, dsFactor),
          };
        }
        exportId = lastClosedSessionData.id;
      }

      if (!exportData) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No active session" }));
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="session_${exportId}.json"`,
      });
      res.end(JSON.stringify(exportData, null, 2));
      return;
    }

    if (
      req.url === "/export-compact" ||
      req.url?.startsWith("/export-compact?")
    ) {
      const params = req.url.startsWith("/export-compact?")
        ? new URLSearchParams(req.url.split("?")[1])
        : null;
      const dsFactor = params
        ? parseInt(params.get("downsample"), 10) || 30
        : 30;

      let compactData = null;
      let exportId = null;

      if (currentSession) {
        const sessionPackets = currentSessionPackets;
        const sessionLaps = currentSessionLaps;
        const bestLap =
          sessionManager.bestForClose() > 0
            ? sessionManager.bestForClose()
            : currentSession.bestLap;

        compactData = buildCompactExport(sessionPackets, sessionLaps, bestLap, {
          id: currentSession.id,
          startedAt: new Date(currentSession.startedAt).toISOString(),
          endedAt: currentSession.endedAt
            ? new Date(currentSession.endedAt).toISOString()
            : null,
          carOrdinal: currentSession.carOrdinal,
          carClass: currentSession.carClass,
          carPi: currentSession.carPi,
        });
        if (compactData) {
          compactData.id = currentSession.id;
          compactData.startedAt = new Date(
            currentSession.startedAt,
          ).toISOString();
          compactData.endedAt = currentSession.endedAt
            ? new Date(currentSession.endedAt).toISOString()
            : null;
        }
        exportId = currentSession.id;
      } else if (lastClosedSessionData) {
        const spkts = lastClosedSessionData.packets || [];
        const slaps = lastClosedSessionData.laps || [];
        const bestLap = lastClosedSessionData.bestLap || -1;
        compactData = buildCompactExport(spkts, slaps, bestLap, {
          id: lastClosedSessionData.id,
          startedAt: lastClosedSessionData.startedAt,
          endedAt: lastClosedSessionData.endedAt,
          carOrdinal: lastClosedSessionData.carOrdinal,
          carClass: lastClosedSessionData.carClass,
          carPi: lastClosedSessionData.carPi,
        });
        if (compactData) {
          compactData.id = lastClosedSessionData.id;
          compactData.startedAt = lastClosedSessionData.startedAt;
          compactData.endedAt = lastClosedSessionData.endedAt;
        }
        exportId = lastClosedSessionData.id;
      }

      if (!compactData) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "No session data available" }));
        return;
      }

      // Apply custom downsample factor to samples array if different from default
      if (dsFactor !== 30 && compactData.samples) {
        // samples already built at ~1/sec; if user wants different, rebuild from raw
        // For simplicity, keep default. Override only via ?downsample on /export.
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="session_${exportId}_compact.json"`,
      });
      res.end(JSON.stringify(compactData, null, 2));
      return;
    }

    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          sessionActive: currentSession !== null,
          sessionId: currentSession?.id || null,
          packetsRecorded: currentSessionPackets.length,
          lapsRecorded: currentSessionLaps.length,
          clients: sseClients.size,
        }),
      );
      return;
    }

    if (req.url === "/sessions") {
      ensureOutputDir();
      try {
        const files = fs
          .readdirSync(OUTPUT_DIR)
          .filter((f) => f.startsWith("session_") && f.endsWith(".json"))
          .sort()
          .reverse();
        const list = files.map((f) => {
          const raw = JSON.parse(
            fs.readFileSync(path.join(OUTPUT_DIR, f), "utf8"),
          );
          return {
            id: raw.id,
            startedAt: raw.startedAt,
            endedAt: raw.endedAt,
            carOrdinal: raw.carOrdinal,
            carClass: raw.carClass,
            carPi: raw.carPi,
            bestLap: raw.bestLap,
            packetCount: raw.packetCount,
            lapCount: raw.laps?.length || 0,
            filename: f,
          };
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(list));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (req.url?.startsWith("/session?")) {
      const params = new URLSearchParams(req.url.split("?")[1]);
      const sid = parseInt(params.get("id"), 10);
      if (!sid) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing ?id= param" }));
        return;
      }
      ensureOutputDir();
      try {
        const files = fs
          .readdirSync(OUTPUT_DIR)
          .filter(
            (f) =>
              f.startsWith(`session_${String(sid).padStart(4, "0")}_`) &&
              f.endsWith(".json"),
          );
        if (files.length === 0) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Session not found" }));
          return;
        }
        const data = fs.readFileSync(path.join(OUTPUT_DIR, files[0]), "utf8");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(data);
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }

    if (req.url === "/" || req.url === "/index.html") {
      const htmlPath = path.join(__dirname, "..", "public", "index.html");
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { "Content-Type": "text/html" });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(getDefaultHTML());
      }
      return;
    }

    // Static assets (images, fonts, etc.)
    if (req.url?.startsWith("/assets/")) {
      const safePath = path.join(__dirname, "..", decodeURIComponent(req.url));
      if (!safePath.startsWith(path.resolve(path.join(__dirname, "..")))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const buf = fs.readFileSync(safePath);
        let ct = "application/octet-stream";
        if (
          buf[0] === 0x52 &&
          buf[1] === 0x49 &&
          buf.length > 11 &&
          buf[8] === 0x57 &&
          buf[9] === 0x45
        )
          ct = "image/webp";
        else if (buf[0] === 0x89 && buf[1] === 0x50) ct = "image/png";
        else if (buf[0] === 0xff && buf[1] === 0xd8) ct = "image/jpeg";
        else if (buf[0] === 0x47 && buf[1] === 0x49) ct = "image/gif";
        else if (path.extname(safePath).toLowerCase() === ".svg")
          ct = "image/svg+xml";
        res.writeHead(200, {
          "Content-Type": ct,
          "Cache-Control": "public, max-age=3600",
        });
        res.end(buf);
        return;
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[http] dashboard at http://localhost:${HTTP_PORT}`);
  });

  return server;
}

function getDefaultHTML() {
  // Speedometer arc: r=95, circ=596.9, 270deg sweep=447.7
  // Half-arc gauges: r=40, circ=251.3, 180deg sweep=125.7
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FH6 Telemetry</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0A0A0A;
      color: #fff;
      min-height: 100vh;
      padding: 12px;
      background-image:
        repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(255,255,255,0.008) 3px, rgba(255,255,255,0.008) 4px),
        repeating-linear-gradient(90deg, transparent, transparent 3px, rgba(255,255,255,0.008) 3px, rgba(255,255,255,0.008) 4px);
    }
    .header {
      background: #111;
      border: 1px solid #1E1E1E;
      border-bottom: 2px solid #C0392B;
      border-radius: 8px;
      padding: 10px 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }
    #status {
      font-size: 11px;
      color: #ccc;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #status.active { color: #27AE60; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: #2A2A2A; flex-shrink: 0; }
    .dot.active { background: #27AE60; box-shadow: 0 0 6px #27AE60; }

    .main { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }

    .card {
      background: #111;
      border: 1px solid #1E1E1E;
      border-top: 2px solid #C0392B;
      border-radius: 8px;
      padding: 16px;
    }
    .card-title {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 2.5px;
      color: #fff;
      margin-bottom: 14px;
      font-weight: 600;
    }

    /* SPEEDOMETER */
    .speedo-svg { width: 100%; max-width: 280px; display: block; margin: 0 auto; }

    /* INSTRUMENTS */
    .instruments {
      display: grid;
      grid-template-columns: 1fr 72px 1fr;
      gap: 8px;
      align-items: center;
      margin-top: 4px;
    }
    .instr-label {
      font-size: 9px;
      color: #fff;
      text-transform: uppercase;
      letter-spacing: 2px;
      text-align: center;
      margin-bottom: 2px;
    }
    .gear-ring {
      width: 64px; height: 64px;
      border-radius: 50%;
      border: 2px solid #1E1E1E;
      background: #0A0A0A;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto;
    }
    #gear {
      font-size: 32px;
      font-weight: 900;
      color: #C0392B;
      font-variant-numeric: tabular-nums;
    }

    /* LAP INFO */
    #lap-time {
      font-size: 30px;
      font-weight: 700;
      color: #fff;
      letter-spacing: 1px;
      font-variant-numeric: tabular-nums;
    }
    #lap-best { font-size: 11px; color: #C0392B; margin-top: 4px; letter-spacing: 1px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
    .info-item {
      background: #0D0D0D;
      border: 1px solid #1A1A1A;
      border-radius: 6px;
      padding: 8px 10px;
      display: flex; flex-direction: column; gap: 3px;
    }
    .info-label { font-size: 8px; color: #fff; text-transform: uppercase; letter-spacing: 2px; }
    .info-value { font-size: 18px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }

    /* TIRE LAYOUT */
    .tire-grid {
      display: grid;
      grid-template-areas:
        "fl car fr"
        "rl car rr";
      grid-template-columns: 1fr 56px 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 12px 8px;
      align-items: center;
      justify-items: center;
    }
    .tire-slot { display: flex; flex-direction: column; align-items: center; gap: 5px; }
    .tire-slot.fl { grid-area: fl; }
    .tire-slot.fr { grid-area: fr; }
    .tire-slot.rl { grid-area: rl; }
    .tire-slot.rr { grid-area: rr; }
    .car-body { grid-area: car; }
    .tire {
      width: 32px; height: 54px;
      border-radius: 7px;
      border: 3px solid #222;
      background: #0D0D0D;
      background-image: repeating-linear-gradient(
        0deg, transparent, transparent 5px,
        rgba(255,255,255,0.03) 5px, rgba(255,255,255,0.03) 6px
      );
      transition: border-color 0.25s, box-shadow 0.25s;
    }
    .tire.cool { border-color: #27AE60; box-shadow: 0 0 8px rgba(39,174,96,0.35); }
    .tire.warm { border-color: #F39C12; box-shadow: 0 0 8px rgba(243,156,18,0.35); }
    .tire.hot  { border-color: #E74C3C; box-shadow: 0 0 10px rgba(231,76,60,0.5); }
    .tire-lbl  { font-size: 8px; color: #fff; text-transform: uppercase; letter-spacing: 1px; }
    .tire-val  { font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .tire-val.cool { color: #27AE60; }
    .tire-val.warm { color: #F39C12; }
    .tire-val.hot  { color: #E74C3C; }

    /* INPUTS */
    .inputs-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .input-row { display: flex; flex-direction: column; gap: 4px; }
    .input-header { display: flex; justify-content: space-between; }
    .input-lbl { font-size: 8px; color: #fff; text-transform: uppercase; letter-spacing: 2px; }
    .input-val { font-size: 10px; font-variant-numeric: tabular-nums; }
    .bar-bg { height: 7px; background: #0D0D0D; border-radius: 4px; overflow: hidden; border: 1px solid #1A1A1A; }
    .bar-fill { height: 100%; border-radius: 4px; width: 0; transition: width 0.08s linear; }
    .bar-thr { background: linear-gradient(90deg, #1A6B35, #27AE60); }
    .bar-brk { background: linear-gradient(90deg, #7B1414, #E74C3C); }
    .bar-clt { background: linear-gradient(90deg, #1A3A7B, #3B82F6); }
    .bar-hbk { background: linear-gradient(90deg, #7B5A00, #F39C12); }
    .steer-section { margin-top: 10px; }
    .steer-track {
      height: 7px; background: #0D0D0D;
      border-radius: 4px; position: relative;
      border: 1px solid #1A1A1A; margin-top: 4px;
    }
    .steer-center {
      position: absolute; top: -2px; left: 50%;
      width: 1px; height: 11px; background: #2A2A2A;
      transform: translateX(-50%);
    }
    .steer-pip {
      position: absolute; top: 1px;
      width: 5px; height: 5px; border-radius: 50%;
      background: #C0392B; left: 50%;
      transform: translateX(-50%);
      transition: left 0.08s linear;
    }

    /* SESSION */
    .session-bar {
      display: flex; align-items: center;
      justify-content: space-between;
    }
    #session-info { font-size: 11px; color: #ccc; text-transform: uppercase; letter-spacing: 1.5px; }
    .btn {
      padding: 7px 18px; border-radius: 4px;
      font-size: 10px; font-weight: 700; cursor: pointer;
      transition: background 0.2s; letter-spacing: 2px;
      text-transform: uppercase; border: none;
      font-family: inherit;
    }
    .btn-primary { background: #C0392B; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #E74C3C; }
    .btn-primary:disabled { background: #1A1A1A; color: #2A2A2A; cursor: not-allowed; }
    .footer {
      text-align: center;
      padding: 16px;
      font-size: 11px;
      color: #555;
      letter-spacing: 1px;
    }
    .footer a {
      color: #888;
      text-decoration: none;
    }
    .footer a:hover {
      color: #C0392B;
    }

    /* MINIMAP */
    .minimap-card { margin-bottom: 12px; }
    #minimap-canvas { width: 100%; border-radius: 6px; background: #0D0D0D; border: 1px solid #1A1A1A; }

    /* OVERLAYS */
    .overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.75);
      z-index: 200; display: flex; align-items: center; justify-content: center;
    }
    .overlay.hidden { display: none; }
    .drawer {
      background: #111; border: 1px solid #1E1E1E; border-radius: 10px;
      width: min(480px,94vw); max-height: 85vh; display: flex; flex-direction: column;
      box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    }
    .viewer {
      background: #111; border: 1px solid #1E1E1E; border-radius: 10px;
      width: min(740px,96vw); max-height: 92vh; display: flex; flex-direction: column;
      box-shadow: 0 12px 48px rgba(0,0,0,0.6);
    }
    .drawer-head, .viewer-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 16px; border-bottom: 1px solid #1E1E1E;
      font-size: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase;
    }
    .close-btn {
      background: none; border: none; color: #555; font-size: 18px; cursor: pointer;
    }
    .close-btn:hover { color: #E74C3C; }
    .sessions-list { flex:1; overflow-y:auto; padding: 8px; }
    .session-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 10px 12px; margin: 4px 0; border-radius: 6px;
      background: #0D0D0D; border: 1px solid #1A1A1A; cursor: pointer;
      transition: border-color 0.15s;
    }
    .session-row:hover { border-color: #C0392B; }
    .session-row .s-left { display:flex; flex-direction:column; gap:2px; }
    .session-row .s-id { font-size: 11px; color: #C0392B; font-weight: 700; }
    .session-row .s-date { font-size: 10px; color: #555; }
    .session-row .s-right { text-align: right; }
    .session-row .s-meta { font-size: 10px; color: #888; }
    .session-row .s-lap { font-size: 12px; color: #27AE60; font-weight: 700; }

    .viewer-tabs {
      display: flex; gap: 2px; padding: 6px 14px 0; border-bottom: 1px solid #1E1E1E;
    }
    .vtab {
      background: none; border: none; border-bottom: 2px solid transparent;
      color: #555; padding: 8px 14px; font-size: 11px; font-weight: 700;
      letter-spacing: 1.5px; cursor: pointer; text-transform: uppercase;
    }
    .vtab.active { color: #C0392B; border-bottom-color: #C0392B; }
    .viewer-body { flex:1; overflow-y:auto; padding: 12px; }
    .v-panel.hidden { display: none; }
    .v-stats {
      display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
      margin-bottom: 14px;
    }
    .v-stat {
      background: #0D0D0D; border: 1px solid #1A1A1A; border-radius: 6px;
      padding: 10px; text-align: center;
    }
    .v-stat .vsl { font-size: 8px; color: #fff; text-transform: uppercase; letter-spacing: 2px; }
    .v-stat .vsv { font-size: 18px; font-weight: 700; color: #fff; margin-top: 2px; }
    .v-chart { display: block; width: 100%; margin-bottom: 10px; border-radius: 4px; background: #0D0D0D; }

    .replay-controls {
      display: flex; align-items: center; gap: 10px; margin-top: 12px;
      padding: 8px 12px; background: #0D0D0D; border: 1px solid #1A1A1A; border-radius: 6px;
    }
    #replay-play {
      background: #C0392B; color: #fff; border: none;
      width: 36px; height: 36px; border-radius: 50%;
      font-size: 16px; cursor: pointer; display: flex; align-items: center; justify-content: center;
    }
    #replay-play:hover { background: #E74C3C; }
    #replay-slider { accent-color: #C0392B; }
    #replay-time { font-size: 12px; color: #fff; font-variant-numeric: tabular-nums; min-width: 50px; text-align: right; }

    .btn-secondary {
      background: #1A1A1A; color: #888; border: 1px solid #2A2A2A;
    }
    .btn-secondary:hover { background: #222; color: #fff; }
  </style>
</head>
<body>

<div class="header">
  <div style="display:flex;align-items:center;gap:12px;">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 866.7 388.2" style="height:28px;display:block;" aria-label="Forza">
    <path fill="#ffffff" d="M397.4,279.9l113-17.1l85-126.4H472.8c-0.5,0-0.7,0.4-0.3,0.7c0.2,0.1,0.5,0.3,0.5,0.3c5.1,2.4,13.5,10-2.5,33.8L397.4,279.9z"/>
    <path fill="#ffffff" d="M618.4,136.5H604c-0.5,0-0.7,0.4-0.3,0.7c0.2,0.1,0.5,0.3,0.5,0.3c5.1,2.4,13.5,10-2.5,33.8l-57.9,86l-0.3,0.5l76.1-11.6c8.1-1.4,15.3-3.6,21.7-7.1c21.3-11.6,35.6-28.9,48.8-48.4l36.5-54.3H618.4V136.5z"/>
    <path fill="#ffffff" d="M251.2,302l113.1-17.1l99.9-148.5H12c-2.2,0-3.6,0.8-3.6,2.5c0,1.3,0.9,2.3,3.6,2.7l313.1,50.6L251.2,302z"/>
    <polygon fill="#ffffff" points="136.8,184.6 0,388.2 182,360.6 283.4,209.9"/>
    <path fill="#ffffff" d="M399,0h-59.5C296,2,264.3,17.6,238.6,38.3c-19.5,15.7-35.8,35-50.4,55.5l-13.1,19.5h523.3c30.7-1.3,54-7.6,75.3-19.2c34.4-18.6,59.7-45.9,81.3-76.7L866.7,0C861.6,0,399,0,399,0z"/>
  </svg>
  <span style="font-size:15px;font-weight:700;color:#fff;letter-spacing:4px;text-transform:uppercase;">TELEMETRY</span>
  </div>
  <div id="status"><span class="dot" id="status-dot"></span>Waiting for signal</div>
</div>

<div class="main">

  <!-- SPEED + INSTRUMENTS -->
  <div class="card">
    <div class="card-title">Speed & Engine</div>

    <svg class="speedo-svg" viewBox="0 0 220 155" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="spd-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#E74C3C"/>
          <stop offset="100%" stop-color="#FF6B35"/>
        </linearGradient>
      </defs>
      <circle cx="110" cy="130" r="95" fill="none" stroke="#1A1A1A" stroke-width="13"
        stroke-dasharray="447.7 596.9" transform="rotate(135 110 130)"/>
      <circle id="speed-arc" cx="110" cy="130" r="95" fill="none"
        stroke="url(#spd-grad)" stroke-width="13" stroke-linecap="round"
        stroke-dasharray="0 596.9" transform="rotate(135 110 130)"/>
      <text x="16"  y="140" fill="#aaa" font-size="8" font-family="monospace">0</text>
      <text x="62"  y="46"  fill="#aaa" font-size="8" font-family="monospace">100</text>
      <text x="148" y="46"  fill="#aaa" font-size="8" font-family="monospace">250</text>
      <text x="186" y="140" fill="#aaa" font-size="8" font-family="monospace">350</text>
      <text id="speed" x="110" y="116" text-anchor="middle"
        font-size="52" font-weight="900" fill="#fff" font-family="monospace">0</text>
      <text x="110" y="133" text-anchor="middle"
        font-size="9" fill="#ccc" letter-spacing="3" font-family="monospace">KM/H</text>
    </svg>

    <div class="instruments">
      <div>
        <div class="instr-label">RPM</div>
        <svg viewBox="0 0 100 58" style="width:100%;max-width:110px;display:block;margin:0 auto;">
          <circle cx="50" cy="52" r="40" fill="none" stroke="#1A1A1A" stroke-width="9"
            stroke-dasharray="125.7 251.3" transform="rotate(180 50 52)"/>
          <circle id="rpm-bar" cx="50" cy="52" r="40" fill="none" stroke="#E74C3C" stroke-width="9"
            stroke-linecap="round" stroke-dasharray="0 251.3" transform="rotate(180 50 52)"/>
          <text id="rpm" x="50" y="46" text-anchor="middle"
            font-size="13" font-weight="700" fill="#fff" font-family="monospace">0</text>
          <text x="50" y="56" text-anchor="middle" font-size="6" fill="#ccc" letter-spacing="1" font-family="monospace">RPM</text>
        </svg>
      </div>
      <div>
        <div class="instr-label">Gear</div>
        <div class="gear-ring"><span id="gear">N</span></div>
      </div>
      <div>
        <div class="instr-label">Power</div>
        <svg viewBox="0 0 100 58" style="width:100%;max-width:110px;display:block;margin:0 auto;">
          <circle cx="50" cy="52" r="40" fill="none" stroke="#1A1A1A" stroke-width="9"
            stroke-dasharray="125.7 251.3" transform="rotate(180 50 52)"/>
          <circle id="power-bar" cx="50" cy="52" r="40" fill="none" stroke="#3B82F6" stroke-width="9"
            stroke-linecap="round" stroke-dasharray="0 251.3" transform="rotate(180 50 52)"/>
          <text id="power" x="50" y="46" text-anchor="middle"
            font-size="13" font-weight="700" fill="#fff" font-family="monospace">0</text>
          <text x="50" y="56" text-anchor="middle" font-size="6" fill="#ccc" letter-spacing="1" font-family="monospace">KW</text>
        </svg>
      </div>
    </div>
  </div>

  <!-- LAP / RACE INFO -->
  <div class="card">
    <div class="card-title">Race Info</div>
    <div id="lap-time">--:--.---</div>
    <div id="lap-best">BEST &nbsp;--:--.---</div>
    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">Lap</span>
        <span id="lap-num" class="info-value">-</span>
      </div>
      <div class="info-item">
        <span class="info-label">Position</span>
        <span id="position" class="info-value">-</span>
      </div>
      <div class="info-item">
        <span class="info-label">Fuel</span>
        <span id="fuel" class="info-value">-</span>
      </div>
      <div class="info-item">
        <span class="info-label">Boost</span>
        <span id="boost" class="info-value">-</span>
      </div>
    </div>
  </div>

  <!-- TIRE TEMPS -->
  <div class="card">
    <div class="card-title">Tire Temperature</div>
    <div class="tire-grid">
      <div class="tire-slot fl">
        <span class="tire-lbl">FL</span>
        <div id="temp-fl-bar" class="tire"></div>
        <span id="temp-fl" class="tire-val">--</span>
      </div>
      <svg class="car-body" viewBox="0 0 56 110" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect x="6" y="6" width="44" height="98" rx="10" fill="#1A1A1A" stroke="#2A2A2A" stroke-width="1"/>
        <rect x="12" y="14" width="32" height="22" rx="4" fill="#141414"/>
        <rect x="14" y="58" width="28" height="18" rx="3" fill="#141414"/>
      </svg>
      <div class="tire-slot fr">
        <span class="tire-lbl">FR</span>
        <div id="temp-fr-bar" class="tire"></div>
        <span id="temp-fr" class="tire-val">--</span>
      </div>
      <div class="tire-slot rl">
        <span class="tire-lbl">RL</span>
        <div id="temp-rl-bar" class="tire"></div>
        <span id="temp-rl" class="tire-val">--</span>
      </div>
      <div></div>
      <div class="tire-slot rr">
        <span class="tire-lbl">RR</span>
        <div id="temp-rr-bar" class="tire"></div>
        <span id="temp-rr" class="tire-val">--</span>
      </div>
    </div>
  </div>

  <!-- INPUTS -->
  <div class="card">
    <div class="card-title">Driver Inputs</div>
    <div class="inputs-grid">
      <div class="input-row">
        <div class="input-header">
          <span class="input-lbl">Throttle</span>
          <span id="throttle" class="input-val" style="color:#27AE60">0%</span>
        </div>
        <div class="bar-bg"><div id="throttle-bar" class="bar-fill bar-thr"></div></div>
      </div>
      <div class="input-row">
        <div class="input-header">
          <span class="input-lbl">Brake</span>
          <span id="brake" class="input-val" style="color:#E74C3C">0%</span>
        </div>
        <div class="bar-bg"><div id="brake-bar" class="bar-fill bar-brk"></div></div>
      </div>
      <div class="input-row">
        <div class="input-header">
          <span class="input-lbl">Clutch</span>
          <span id="clutch" class="input-val" style="color:#3B82F6">0%</span>
        </div>
        <div class="bar-bg"><div id="clutch-bar" class="bar-fill bar-clt"></div></div>
      </div>
      <div class="input-row">
        <div class="input-header">
          <span class="input-lbl">Handbrake</span>
          <span id="handbrake" class="input-val" style="color:#F39C12">0%</span>
        </div>
        <div class="bar-bg"><div id="handbrake-bar" class="bar-fill bar-hbk"></div></div>
      </div>
    </div>
    <div class="steer-section">
      <div class="input-header">
        <span class="input-lbl">Steering</span>
        <span id="steer" class="input-val" style="color:#555">0</span>
      </div>
      <div class="steer-track">
        <div class="steer-center"></div>
        <div id="steer-pip" class="steer-pip"></div>
      </div>
    </div>
  </div>

</div>

<!-- MINIMAP -->
<div class="card minimap-card" id="minimap-card">
  <div class="card-title">TRACK MAP <span id="map-status" style="color:#27AE60;font-size:8px;">● LIVE</span></div>
  <canvas id="minimap-canvas" width="700" height="394"></canvas>
</div>

<!-- SESSION -->
<div class="card session-bar">
  <div id="session-info">No active session</div>
  <div style="display:flex;gap:8px;">
    <button id="sessions-btn" class="btn btn-secondary">Sessions</button>
    <button id="export-btn" class="btn btn-primary" disabled>Export</button>
    <button id="export-compact-btn" class="btn btn-primary" disabled style="background:#1A6B35;">Compact</button>
  </div>
</div>

<!-- SESSIONS DRAWER -->
<div id="sessions-overlay" class="overlay hidden">
  <div class="drawer">
    <div class="drawer-head">
      <span>Sessions</span>
      <button id="close-drawer" class="close-btn">✕</button>
    </div>
    <div id="sessions-list" class="sessions-list">Loading...</div>
  </div>
</div>

<!-- SESSION VIEWER -->
<div id="viewer-overlay" class="overlay hidden">
  <div class="viewer">
    <div class="viewer-head">
      <span id="viewer-title">Session</span>
      <button id="close-viewer" class="close-btn">✕</button>
    </div>
    <div class="viewer-tabs">
      <button class="vtab active" data-tab="charts">Charts</button>
      <button class="vtab" data-tab="replay-map">Replay Map</button>
    </div>
    <div class="viewer-body" id="viewer-body">
      <div id="v-charts" class="v-panel">
        <div id="v-stats" class="v-stats"></div>
        <canvas id="chart-speed" width="680" height="160"></canvas>
        <canvas id="chart-rpm" width="680" height="160"></canvas>
        <canvas id="chart-temps" width="680" height="160"></canvas>
        <canvas id="chart-inputs" width="680" height="160"></canvas>
      </div>
      <div id="v-map" class="v-panel hidden">
        <canvas id="replay-map-canvas" width="680" height="480"></canvas>
        <div class="replay-controls">
          <button id="replay-play">▶</button>
          <input type="range" id="replay-slider" min="0" max="100" value="0" style="flex:1;">
          <span id="replay-time">0:00</span>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
  var sessionId = null;
  var SPEEDO_ARC = 447.7, SPEEDO_CIRC = 596.9, MAX_SPD = 350;
  var HALF_ARC = 125.7, HALF_CIRC = 251.3;
  var MAX_RPM = 10000, MAX_PWR = 600000;

  function fmt(ms) {
    if (!ms || ms <= 0) return '--:--.---';
    var s = ms / 1000, m = Math.floor(s / 60), sec = Math.floor(s % 60), mil = Math.floor((s % 1) * 1000);
    return p2(m) + ':' + p2(sec) + '.' + p3(mil);
  }
  function p2(n) { return n < 10 ? '0' + n : '' + n; }
  function p3(n) { return n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n; }

  function tcls(t) {
    if (t == null) return '';
    return t < 70 ? 'cool' : t < 90 ? 'warm' : 'hot';
  }

  function setArc(id, val, max, arcLen, circ) {
    var el = document.getElementById(id);
    if (!el) return;
    var f = Math.min(1, Math.max(0, val / max));
    el.setAttribute('stroke-dasharray', (arcLen * f).toFixed(1) + ' ' + circ);
  }

  function setBar(id, pct) {
    var el = document.getElementById(id);
    if (el) el.style.width = Math.min(100, Math.max(0, pct)).toFixed(1) + '%';
  }

  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  function updateTire(barId, valId, temp) {
    var cls = tcls(temp);
    var bar = document.getElementById(barId);
    var val = document.getElementById(valId);
    if (bar) bar.className = 'tire' + (cls ? ' ' + cls : '');
    if (val) {
      val.textContent = temp != null ? temp.toFixed(0) + '°C' : '--';
      val.className = 'tire-val' + (cls ? ' ' + cls : '');
    }
  }

  // ── Map calibration (FH6 Japan) ───────────────────────────────────
  // Two reference points map game world (positionX, positionZ) →
  // full-resolution tile pixels (zoom 14, tile range 8128-8191 × 256px).
  // Source: fh6-tel reference project (mapDefaults.ts).
  var _calAWX=-119.49154, _calAWZ=3888.595, _calAPX=2089486, _calAPY=2087415;
  var _calBWX=-7104.7695, _calBWZ=-1863.08,  _calBPX=2086885, _calBPY=2089556;
  var _tileMin=8128*256, _tileRange=64*256; // 2080768, 16384
  var _mX=(_calBPX-_calAPX)/(_calBWX-_calAWX), _bX=_calAPX-_mX*_calAWX;
  var _mZ=(_calBPY-_calAPY)/(_calBWZ-_calAWZ), _bY=_calAPY-_mZ*_calAWZ;

  function worldToCanvas(worldX, worldZ, cw, ch) {
    var fx = (_mX*worldX+_bX-_tileMin)/_tileRange;
    var fy = (_mZ*worldZ+_bY-_tileMin)/_tileRange;
    return [fx*cw, fy*ch];
  }

  var liveTrail = [];
  var mapW = 700, mapH = 394;
  var mapCtx = null;
  var prevRaceOn = false;
  var frameCount = 0;

  var _mapImg = new Image();
  var _mapImgLoaded = false;
  _mapImg.onload = function() { _mapImgLoaded = true; _drawMapBg(); };
  _mapImg.src = '/assets/map/venus.png';

  (function() {
    var c = document.getElementById('minimap-canvas');
    if (c) { mapCtx = c.getContext('2d'); _drawMapBg(); }
  })();

  function _drawMapBg(ctx, w, h) {
    ctx = ctx || mapCtx; w = w || mapW; h = h || mapH;
    if (!ctx) return;
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, w, h);
    if (_mapImgLoaded) {
      ctx.globalAlpha = 0.82;
      ctx.drawImage(_mapImg, 0, 0, w, h);
      ctx.globalAlpha = 1.0;
    }
  }

  function _drawArrow(ctx, cx, cy, yaw) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(yaw);
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(5.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-5.5, 7);
    ctx.closePath();
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 1.5;
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function updateMapTrail(d) {
    if (!mapCtx || (!d.positionX && !d.positionZ)) return;
    if (d.isRaceOn && !prevRaceOn) { liveTrail = []; frameCount = 0; }
    prevRaceOn = d.isRaceOn;
    if (!d.isRaceOn) return;
    frameCount++;
    if (frameCount % 3 !== 0 && liveTrail.length > 0) return;
    liveTrail.push({ x: d.positionX, z: d.positionZ, yaw: d.yaw || 0, lap: d.lapNumber });

    _drawMapBg();
    var ctx = mapCtx;
    if (liveTrail.length >= 2) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      ctx.beginPath();
      var curLap = liveTrail[0].lap;
      var p0 = worldToCanvas(liveTrail[0].x, liveTrail[0].z, mapW, mapH);
      ctx.moveTo(p0[0], p0[1]);
      for (var i = 1; i < liveTrail.length; i++) {
        var pt = liveTrail[i];
        if (pt.lap !== curLap) {
          ctx.stroke(); curLap = pt.lap; ctx.beginPath();
          var pp = worldToCanvas(pt.x, pt.z, mapW, mapH); ctx.moveTo(pp[0], pp[1]);
        } else {
          var pp2 = worldToCanvas(pt.x, pt.z, mapW, mapH); ctx.lineTo(pp2[0], pp2[1]);
        }
      }
      ctx.stroke();
    }
    var lp = liveTrail[liveTrail.length - 1];
    var cp = worldToCanvas(lp.x, lp.z, mapW, mapH);
    _drawArrow(ctx, cp[0], cp[1], lp.yaw);
  }

  // ── Session List ──────────────────────────────────────────────────
  var sessionsCache = [];

  document.getElementById('sessions-btn').addEventListener('click', function() {
    document.getElementById('sessions-overlay').classList.remove('hidden');
    loadSessions();
  });
  document.getElementById('close-drawer').addEventListener('click', function() {
    document.getElementById('sessions-overlay').classList.add('hidden');
  });
  document.getElementById('close-viewer').addEventListener('click', function() {
    document.getElementById('viewer-overlay').classList.add('hidden');
  });

  document.querySelectorAll('.vtab').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.vtab').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      var tab = btn.dataset.tab;
      document.getElementById('v-charts').classList.toggle('hidden', tab !== 'charts');
      document.getElementById('v-map').classList.toggle('hidden', tab !== 'replay-map');
      if (tab === 'replay-map' && currentViewerPackets) drawReplayMap(currentViewerPackets, 0);
    });
  });

  function loadSessions() {
    fetch('/sessions').then(function(r) { return r.json(); }).then(function(list) {
      sessionsCache = list;
      var el = document.getElementById('sessions-list');
      if (!list.length) { el.innerHTML = '<div style="color:#555;text-align:center;padding:40px;">No sessions recorded yet.</div>'; return; }
      el.innerHTML = list.map(function(s) {
        var bl = s.bestLap && s.bestLap > 0 ? (s.bestLap/1000).toFixed(3) : null;
        return '<div class="session-row" data-id="'+s.id+'">'
          + '<div class="s-left"><span class="s-id">Session #'+s.id+'</span><span class="s-date">'+new Date(s.startedAt).toLocaleString()+'</span></div>'
          + '<div class="s-right"><div class="s-meta">'+s.packetCount+' pkts &middot; '+s.lapCount+' laps</div>'
          + (bl ? '<div class="s-lap">Best '+bl+'s</div>' : '')
          + '</div></div>';
      }).join('');
      el.querySelectorAll('.session-row').forEach(function(row) {
        row.addEventListener('click', function() { openSessionViewer(parseInt(row.dataset.id)); });
      });
    });
  }

  var currentViewerPackets = null;
  var replayTimer = null;

  function openSessionViewer(id) {
    document.getElementById('sessions-overlay').classList.add('hidden');
    document.getElementById('viewer-overlay').classList.remove('hidden');
    document.getElementById('viewer-title').textContent = 'Session #' + id;
    fetch('/session?id=' + id).then(function(r) { return r.json(); }).then(function(data) {
      currentViewerPackets = data.packets;
      document.getElementById('replay-slider').max = data.packets.length - 1;
      drawCharts(data);
      document.querySelector('.vtab[data-tab="charts"]').click();
    });
  }

  function drawCharts(data) {
    var pkts = data.packets;
    // Stats
    var maxRpm = 0, maxSpeed = 0, maxPower = 0;
    pkts.forEach(function(p) {
      if (p.currentEngineRpm > maxRpm) maxRpm = p.currentEngineRpm;
      if (p.speedKmh > maxSpeed) maxSpeed = p.speedKmh;
      if (p.power > maxPower) maxPower = p.power;
    });
    var el = document.getElementById('v-stats');
    var blap = data.bestLap && data.bestLap > 0 ? (data.bestLap).toFixed(3)+'s' : 'N/A';
    el.innerHTML = '<div class="v-stat"><div class="vsl">Max Speed</div><div class="vsv">'+Math.round(maxSpeed)+' km/h</div></div>'
      + '<div class="v-stat"><div class="vsl">Max RPM</div><div class="vsv">'+Math.round(maxRpm)+'</div></div>'
      + '<div class="v-stat"><div class="vsl">Max Power</div><div class="vsv">'+Math.round(maxPower/1000)+' kW</div></div>'
      + '<div class="v-stat"><div class="vsl">Best Lap</div><div class="vsv">'+blap+'</div></div>';

    drawLineChart('chart-speed', pkts, function(p) { return p.speedKmh; }, '#3b82f6', 'Speed (km/h)');
    drawLineChart('chart-rpm', pkts, function(p) { return p.currentEngineRpm; }, '#a855f7', 'RPM');
    drawLineChart('chart-temps', pkts, [
      {fn: function(p) { return p.tireTempFl; }, color: '#60a5fa'},
      {fn: function(p) { return p.tireTempFr; }, color: '#f87171'},
      {fn: function(p) { return p.tireTempRl; }, color: '#34d399'},
      {fn: function(p) { return p.tireTempRr; }, color: '#fbbf24'},
    ]);
    drawLineChart('chart-inputs', pkts, [
      {fn: function(p) { return p.throttle/255*100; }, color: '#22c55e'},
      {fn: function(p) { return p.brake/255*100; }, color: '#ef4444'},
    ]);
  }

  function drawLineChart(canvasId, pkts, series, colorOrLabel, labelOverride) {
    var el = document.getElementById(canvasId);
    if (!el) return;
    el.style.width = '100%';
    var ctx = el.getContext('2d');
    var w = el.clientWidth || 680, h = 160;
    el.width = w; el.height = h;
    ctx.fillStyle = '#0A0A0A';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#1A1A1A';
    ctx.lineWidth = 1;
    for (var gy = 0; gy < h; gy += 40) { ctx.beginPath(); ctx.moveTo(0,gy); ctx.lineTo(w,gy); ctx.stroke(); }
    ctx.fillStyle = '#444';
    ctx.font = '9px monospace';
    ctx.fillText(labelOverride || '', 8, 14);

    var seriesArr = Array.isArray(series) ? series : [{fn: series, color: colorOrLabel}];
    seriesArr.forEach(function(s) {
      var vals = pkts.map(s.fn);
      var mn = Infinity, mx = -Infinity;
      vals.forEach(function(v) { if (v < mn) mn = v; if (v > mx) mx = v; });
      if (mx - mn < 1) mx = mn + 1;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      for (var i = 0; i < vals.length; i++) {
        var x = (i / Math.max(1, vals.length-1)) * (w - 10) + 5;
        var y = h - 10 - ((vals[i] - mn) / (mx - mn)) * (h - 20);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });
  }

  function drawReplayMap(pkts, idx) {
    var c = document.getElementById('replay-map-canvas');
    if (!c) return;
    var ctx = c.getContext('2d');
    var w = c.clientWidth || 680, h = Math.round(w * 475 / 844);
    c.width = w; c.height = h;

    _drawMapBg(ctx, w, h);

    var colors = ['#3b82f6','#eab308','#22c55e','#ef4444','#a855f7','#f59e0b','#06b6d4','#f97316'];
    ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    var curLap = -1, ci = 0;
    ctx.beginPath();
    for (var i = 0; i < pkts.length; i++) {
      var p = pkts[i];
      if (!p.positionX && !p.positionZ) continue;
      var pos = worldToCanvas(p.positionX, p.positionZ, w, h);
      if (p.lapNumber !== curLap) {
        ctx.stroke();
        curLap = p.lapNumber;
        ctx.strokeStyle = colors[ci % colors.length]; ci++;
        ctx.beginPath(); ctx.moveTo(pos[0], pos[1]);
      } else {
        ctx.lineTo(pos[0], pos[1]);
      }
    }
    ctx.stroke();

    var cp = pkts[Math.min(idx, pkts.length - 1)];
    if (cp && (cp.positionX || cp.positionZ)) {
      var cpos = worldToCanvas(cp.positionX, cp.positionZ, w, h);
      _drawArrow(ctx, cpos[0], cpos[1], cp.yaw || 0);
    }
  }

  // Replay controls
  var replayPlaying = false, replayIdx = 0;
  document.getElementById('replay-play').addEventListener('click', function() {
    replayPlaying = !replayPlaying;
    this.textContent = replayPlaying ? '⏸' : '▶';
    if (replayPlaying) runReplay();
    else clearInterval(replayTimer);
  });
  document.getElementById('replay-slider').addEventListener('input', function() {
    replayIdx = parseInt(this.value);
    if (currentViewerPackets) {
      drawReplayMap(currentViewerPackets, replayIdx);
      document.getElementById('replay-time').textContent = formatReplayTime(replayIdx);
    }
  });

  function formatReplayTime(idx) {
    var s = (idx / 60).toFixed(0);
    return Math.floor(s/60) + ':' + String(s % 60).padStart(2, '0');
  }

  function runReplay() {
    clearInterval(replayTimer);
    replayTimer = setInterval(function() {
      if (!currentViewerPackets) return;
      if (replayIdx >= currentViewerPackets.length - 1) { replayIdx = 0; }
      replayIdx += 3;
      if (replayIdx >= currentViewerPackets.length) replayIdx = currentViewerPackets.length - 1;
      document.getElementById('replay-slider').value = replayIdx;
      document.getElementById('replay-time').textContent = formatReplayTime(replayIdx);
      drawReplayMap(currentViewerPackets, replayIdx);
    }, 100);
  }

  // ── Hook minimap into SSE ─────────────────────────────────────────
  es = new EventSource('/events');
  es.onmessage = function(e) {
    var d = JSON.parse(e.data);

    if (d.sessionId && d.sessionId !== sessionId) {
      sessionId = d.sessionId;
      var st = document.getElementById('status');
      st.className = 'active';
      st.innerHTML = '<span class="dot active" id="status-dot"></span>Session #' + sessionId;
      document.getElementById('export-btn').disabled = false;
      document.getElementById('export-compact-btn').disabled = false;
      setText('session-info', 'Recording session #' + sessionId + '…');
      liveTrail = []; frameCount = 0; prevRaceOn = false; _drawMapBg();
    }

    var spd = d.speedKmh || 0;
    setText('speed', Math.round(spd));
    setArc('speed-arc', spd, MAX_SPD, SPEEDO_ARC, SPEEDO_CIRC);

    var rpm = d.currentEngineRpm || 0;
    setText('rpm', Math.round(rpm));
    setArc('rpm-bar', rpm, MAX_RPM, HALF_ARC, HALF_CIRC);

    var g = d.gear != null ? d.gear : 0;
    setText('gear', g === 0 ? 'N' : (g < 0 ? 'R' : g));

    var pwr = d.power || 0;
    setText('power', Math.round(Math.abs(pwr) / 1000));
    setArc('power-bar', Math.abs(pwr), MAX_PWR, HALF_ARC, HALF_CIRC);

    updateTire('temp-fl-bar', 'temp-fl', d.tireTempFl);
    updateTire('temp-fr-bar', 'temp-fr', d.tireTempFr);
    updateTire('temp-rl-bar', 'temp-rl', d.tireTempRl);
    updateTire('temp-rr-bar', 'temp-rr', d.tireTempRr);

    setText('lap-time', fmt((d.currentLap || 0) * 1000));
    setText('lap-num',  d.lapNumber != null ? d.lapNumber : '-');
    setText('position', d.racePosition || '-');
    setText('fuel',     d.fuel  ? d.fuel.toFixed(1) + 'L' : '-');
    setText('boost',    d.boost != null ? d.boost.toFixed(1) : '-');

    var thr = Math.round((d.throttle  || 0) / 255 * 100);
    var brk = Math.round((d.brake     || 0) / 255 * 100);
    var clt = Math.round((d.clutch    || 0) / 255 * 100);
    var hbk = Math.round((d.handbrake || 0) / 255 * 100);
    setText('throttle',  thr + '%'); setBar('throttle-bar',  thr);
    setText('brake',     brk + '%'); setBar('brake-bar',     brk);
    setText('clutch',    clt + '%'); setBar('clutch-bar',    clt);
    setText('handbrake', hbk + '%'); setBar('handbrake-bar', hbk);

    var sv = d.steer || 0;
    setText('steer', sv);
    var pip = document.getElementById('steer-pip');
    if (pip) pip.style.left = (50 + (sv / 128) * 47).toFixed(1) + '%';

    if (d.bestLap && d.bestLap > 0) setText('lap-best', 'BEST  ' + fmt(d.bestLap * 1000));
    if (d.completedLap)             setText('lap-best', 'BEST  ' + fmt(d.completedLap.lapTime * 1000));

    updateMapTrail(d);
  };

  document.getElementById('export-btn').addEventListener('click', function() {
    downloadExport('/export', 'Export', 'session_' + sessionId + '.json');
  });
  document.getElementById('export-compact-btn').addEventListener('click', function() {
    downloadExport('/export-compact', 'Compact', 'session_' + sessionId + '_compact.json');
  });

  function downloadExport(url, label, filename) {
    var btns = [document.getElementById('export-btn'), document.getElementById('export-compact-btn')];
    btns.forEach(function(b) { if (b) b.disabled = true; });
    fetch(url).then(function(r) { return r.blob(); }).then(function(blob) {
      var u = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = u; a.download = filename; a.click();
      URL.revokeObjectURL(u);
    }).catch(function(err) {
      alert(label + ' export failed: ' + err.message);
    }).finally(function() {
      btns.forEach(function(b) { if (b) b.disabled = false; });
    });
  });
</script>

<div class="footer">
  developed by <a href="https://github.com/viunow" target="_blank" rel="noopener noreferrer">@viniciusneto.dev</a>
</div>
</body>
</html>`;
}

async function start() {
  ensureOutputDir();

  const udpServer = await startUDP();
  const httpServer = await startHTTP();

  console.log(`[output] sessions will be saved to ${path.resolve(OUTPUT_DIR)}`);
  console.log("Waiting for telemetry data from Forza Horizon 6...");

  process.on("SIGINT", () => {
    console.log("\n[shutdown] closing session...");
    closeSession();
    udpServer.close();
    httpServer.close();
    process.exit(0);
  });
}

start().catch(console.error);
