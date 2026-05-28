import dgram from 'dgram';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse, toJSON } from './parser.js';
import { SessionManager } from './session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 20440;
const HTTP_PORT = process.env.HTTP_PORT || 3000;
const OUTPUT_DIR = './sessions';

let sessionManager = new SessionManager(true);
let currentSession = null;
let currentSessionPackets = [];
let currentSessionLaps = [];
let sessionCounter = 0;

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
  if (seconds <= 0 || !isFinite(seconds)) return '--:--.---';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
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
    avgFuel: fuelSamples > 0 ? Math.round(totalFuel / fuelSamples * 100) / 100 : null,
    maxBoost: Math.round(maxBoost * 100) / 100,
    durationMs: packets.length > 0 ? packets[packets.length - 1].timestampMs - packets[0].timestampMs : 0,
    packetCount: packets.length
  };
}

function saveSession(session) {
  ensureOutputDir();
  const filename = `session_${String(session.id).padStart(4, '0')}_${session.carOrdinal}.json`;
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
    laps: session.laps.map(lap => ({
      lapNumber: lap.lapNumber,
      lapTime: lap.lapTime,
      lapTimeFormatted: formatTime(lap.lapTime)
    })),
    stats: calculateSessionStats(session.packets),
    packets: session.packets
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
    laps: []
  };
  currentSessionPackets = [];
  currentSessionLaps = [];
  console.log(`[session] opened #${currentSession.id} (carOrdinal: ${carOrdinal}, PI: ${carPi})`);
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
    console.log(`[session] laps: ${currentSession.laps.length}, packets: ${currentSession.packets.length}, best: ${currentSession.bestLap > 0 ? formatTime(currentSession.bestLap) : 'N/A'}`);
  } else {
    console.log(`[session] discarded empty session #${currentSession.id} (${currentSessionPackets.length} packets)`);
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

    const progress = pkt.currentRaceTime > 0 ? pkt.currentRaceTime : pkt.currentLap;
    sessionManager.updateRaceTime(progress);

    const completedLap = sessionManager.noteTick(pkt.isRaceOn, pkt.currentLap, pkt.currentRaceTime);
    if (completedLap) {
      currentSessionLaps.push(completedLap);
      json.completedLap = {
        lapNumber: completedLap.lapNumber,
        lapTime: completedLap.lapTime,
        lapTimeFormatted: formatTime(completedLap.lapTime)
      };
      console.log(`[lap] #${completedLap.lapNumber} - ${formatTime(completedLap.lapTime)}`);
    }
  }

  return json;
}

function handleRaceStateChange(wasRacing, isRacing, carOrdinal, carClass, carPi) {
  const action = sessionManager.onRaceOnChange(wasRacing, isRacing, carOrdinal, carClass, carPi);

  if (action === 'open') {
    const progress = 0;
    if (sessionManager.checkReopen(progress, getTimestamp())) {
      sessionManager.activeId = sessionManager.closedId;
      console.log(`[session] rewind detected, continuing #${sessionManager.activeId}`);
    } else {
      const id = openSession(carOrdinal, carClass, carPi);
      sessionManager.activeId = id;
    }
    sessionManager.beginNewSession();
  } else if (action === 'close') {
    sessionManager.noteClose(getTimestamp());
    const filepath = closeSession();
    sessionManager.activeId = null;
    return filepath;
  }
  return null;
}

async function startUDP() {
  return new Promise((resolve) => {
    const server = dgram.createSocket('udp4');

    server.on('error', (err) => {
      console.error(`[udp] error: ${err.message}`);
      server.close();
    });

    let prevInEvent = false;
    let closePending = 0;
    const CLOSE_GRACE = 150;

    server.on('message', (msg, rinfo) => {
      try {
        const pkt = parse(msg);
        const json = handlePacket(pkt);

        broadcastToSSE(json);

        const timedLap = pkt.currentLap > 0.0;
        const rawInEvent = pkt.is_race_on && (pkt.race_position > 0 || timedLap);
        if (rawInEvent) {
          closePending = 0;
        } else {
          closePending = closePending + 1;
        }
        const inEvent = rawInEvent || closePending < CLOSE_GRACE;

        handleRaceStateChange(prevInEvent, inEvent, pkt.carOrdinal, pkt.carClass, pkt.carPi);
        prevInEvent = inEvent;

      } catch (err) {
        // Silent fail for parse errors
      }
    });

    server.on('listening', () => {
      const address = server.address();
      console.log(`[udp] listening on ${address.address}:${address.port}`);
      resolve(server);
    });

    server.bind(PORT);
  });
}

async function startHTTP() {
  const server = http.createServer((req, res) => {
    if (req.url === '/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      sseClients.add(res);
      console.log(`[sse] client connected (${sseClients.size} total)`);

      req.on('close', () => {
        sseClients.delete(res);
        console.log(`[sse] client disconnected (${sseClients.size} total)`);
      });
      return;
    }

    if (req.url === '/export') {
      if (!currentSession) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active session' }));
        return;
      }

      const sessionData = {
        id: currentSession.id,
        startedAt: new Date(currentSession.startedAt).toISOString(),
        endedAt: currentSession.endedAt ? new Date(currentSession.endedAt).toISOString() : null,
        carOrdinal: currentSession.carOrdinal,
        carClass: currentSession.carClass,
        carPi: currentSession.carPi,
        bestLap: currentSession.bestLap,
        packetCount: currentSession.packets.length,
        laps: currentSession.laps.map(lap => ({
          lapNumber: lap.lapNumber,
          lapTime: lap.lapTime,
          lapTimeFormatted: formatTime(lap.lapTime)
        })),
        stats: calculateSessionStats(currentSession.packets),
        packets: currentSession.packets
      };

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="session_${currentSession.id}.json"`
      });
      res.end(JSON.stringify(sessionData, null, 2));
      return;
    }

    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessionActive: currentSession !== null,
        sessionId: currentSession?.id || null,
        packetsRecorded: currentSessionPackets.length,
        lapsRecorded: currentSessionLaps.length,
        clients: sseClients.size
      }));
      return;
    }

    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = path.join(__dirname, '..', 'public', 'index.html');
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        fs.createReadStream(htmlPath).pipe(res);
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDefaultHTML());
      }
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  server.listen(HTTP_PORT, () => {
    console.log(`[http] dashboard at http://localhost:${HTTP_PORT}`);
  });

  return server;
}

function getDefaultHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FH6 Telemetry</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #2D2D2D; color: #fff; min-height: 100vh; }
    .header { background: #4A4A4A; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #15CAB9; }
    .header h1 { font-size: 18px; font-weight: 600; color: #15CAB9; }
    .header .status { font-size: 13px; color: #aaa; }
    .header .status.active { color: #15CAB9; }
    .main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 16px; width: 100%; height: calc(100vh - 56px); }
    .card { background: #4A4A4A; border-radius: 8px; padding: 16px; border: 2px solid #15CAB9; }
    .card-title { font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #15CAB9; margin-bottom: 8px; font-weight: 600; }
    .speed-value { font-size: 72px; font-weight: 700; color: #fff; line-height: 1; }
    .speed-unit { font-size: 20px; color: #ccc; margin-left: 8px; }
    .gauge-row { display: flex; gap: 16px; margin-top: 20px; }
    .gauge { flex: 1; text-align: center; }
    .gauge-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; }
    .gauge-value { font-size: 24px; font-weight: 600; margin: 4px 0; color: #fff; }
    .gauge-value.cool { color: #4ade80; }
    .gauge-value.warm { color: #fbbf24; }
    .gauge-value.hot { color: #ef4444; }
    .gauge-bar { height: 6px; background: #333; border-radius: 3px; overflow: hidden; }
.gauge-fill { height: 100%; border-radius: 3px; transition: width 0.1s; }
    .gauge-fill.cool { background: linear-gradient(90deg, #0a7a70, #15CAB9); }
    .gauge-fill.warm { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
    .gauge-fill.hot { background: linear-gradient(90deg, #dc2626, #ef4444); }
    .lap-time { font-size: 36px; font-weight: 600; color: #fff; }
    .lap-best { font-size: 14px; color: #15CAB9; margin-top: 4px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .info-item { display: flex; justify-content: space-between; padding: 8px 12px; background: #2D2D2D; border-radius: 6px; border: 1px solid #15CAB9; }
    .info-label { color: #aaa; font-size: 13px; }
    .info-value { color: #fff; font-weight: 600; }
    .no-data { text-align: center; padding: 40px; color: #aaa; }
    .controls { display: flex; gap: 12px; margin-top: 16px; }
    .btn { padding: 10px 20px; border: 2px solid #15CAB9; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; background: #4A4A4A; color: #15CAB9; }
    .btn-primary { background: #15CAB9; color: #000; }
    .btn-primary:hover { background: #12a89e; }
    .btn-primary:disabled { background: #333; color: #666; border-color: #333; }
    .btn-secondary { background: #4A4A4A; color: #15CAB9; }
    .btn-secondary:hover { background: #555; }
</head>
<body>
  <div class="header">
    <h1>FH6 Telemetry</h1>
    <span id="status" class="status">Waiting for data...</span>
  </div>
  <div class="main">
    <div class="card">
      <div class="card-title">Speed</div>
      <div><span id="speed" class="speed-value">0</span><span class="speed-unit">km/h</span></div>
      <div class="gauge-row">
        <div class="gauge">
          <div class="gauge-label">RPM</div>
          <div id="rpm" class="gauge-value">0</div>
          <div class="gauge-bar"><div id="rpm-bar" class="gauge-fill warm" style="width: 0%"></div></div>
        </div>
        <div class="gauge">
          <div class="gauge-label">Gear</div>
          <div id="gear" class="gauge-value">0</div>
        </div>
        <div class="gauge">
          <div class="gauge-label">Power</div>
          <div id="power" class="gauge-value">0</div>
          <div class="gauge-bar"><div id="power-bar" class="gauge-fill cool" style="width: 0%"></div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Lap Time</div>
      <div id="lap-time" class="lap-time">--:--.---</div>
      <div id="lap-best" class="lap-best">Best: --:--.---</div>
      <div class="info-grid">
        <div class="info-item"><span class="info-label">Lap</span><span id="lap-num" class="info-value">-</span></div>
        <div class="info-item"><span class="info-label">Position</span><span id="position" class="info-value">-</span></div>
        <div class="info-item"><span class="info-label">Fuel</span><span id="fuel" class="info-value">-</span></div>
        <div class="info-item"><span class="info-label">Boost</span><span id="boost" class="info-value">-</span></div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Tire Temperature</div>
      <div class="gauge-row">
        <div class="gauge">
          <div class="gauge-label">FL</div>
          <div id="temp-fl" class="gauge-value cool">--°C</div>
          <div class="gauge-bar"><div id="temp-fl-bar" class="gauge-fill cool" style="width: 0%"></div></div>
        </div>
        <div class="gauge">
          <div class="gauge-label">FR</div>
          <div id="temp-fr" class="gauge-value cool">--°C</div>
          <div class="gauge-bar"><div id="temp-fr-bar" class="gauge-fill cool" style="width: 0%"></div></div>
        </div>
        <div class="gauge">
          <div class="gauge-label">RL</div>
          <div id="temp-rl" class="gauge-value cool">--°C</div>
          <div class="gauge-bar"><div id="temp-rl-bar" class="gauge-fill cool" style="width: 0%"></div></div>
        </div>
        <div class="gauge">
          <div class="gauge-label">RR</div>
          <div id="temp-rr" class="gauge-value cool">--°C</div>
          <div class="gauge-bar"><div id="temp-rr-bar" class="gauge-fill cool" style="width: 0%"></div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-title">Inputs</div>
      <div class="info-grid">
        <div class="info-item"><span class="info-label">Throttle</span><span id="throttle" class="info-value">0%</span></div>
        <div class="info-item"><span class="info-label">Brake</span><span id="brake" class="info-value">0%</span></div>
        <div class="info-item"><span class="info-label">Clutch</span><span id="clutch" class="info-value">0%</span></div>
        <div class="info-item"><span class="info-label">Handbrake</span><span id="handbrake" class="info-value">0%</span></div>
      </div>
      <div class="info-item" style="margin-top: 12px"><span class="info-label">Steer</span><span id="steer" class="info-value">0</span></div>
    </div>
  </div>
  <div style="padding: 0 16px 16px; width: 100%;">
    <div class="card" style="width: 100%;">
      <div id="session-info" class="no-data">No active session</div>
      <div class="controls">
        <button id="export-btn" class="btn btn-primary" disabled>Export JSON</button>
      </div>
    </div>
  </div>

  <script>
    let sessionActive = false;
    let currentSessionId = null;

    function formatTime(ms) {
      if (!ms || ms <= 0) return '--:--.---';
      const totalSecs = ms / 1000;
      const mins = Math.floor(totalSecs / 60);
      const secs = Math.floor(totalSecs % 60);
      const millis = Math.floor((totalSecs % 1) * 1000);
      return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0') + '.' + String(millis).padStart(3, '0');
    }

    function tempClass(temp) {
      if (temp === null || temp === undefined) return 'cool';
      if (temp < 70) return 'cool';
      if (temp < 90) return 'warm';
      return 'hot';
    }

    function tempBarWidth(temp) {
      if (!temp) return 0;
      return Math.min(100, (temp / 120) * 100);
    }

    function updateGauge(id, value, barId, maxVal, temp = null) {
      const el = document.getElementById(id);
      const bar = document.getElementById(barId);
      if (!el) return;

      el.textContent = typeof value === 'number' ? Math.round(value) : value;
      if (bar && maxVal) {
        bar.style.width = Math.min(100, (value / maxVal) * 100) + '%';
      }
      if (temp !== null) {
        const cls = tempClass(temp);
        el.className = 'gauge-value ' + cls;
        if (bar) bar.className = 'gauge-fill ' + cls;
      }
    }

    const eventSource = new EventSource('/events');
    eventSource.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.sessionId && data.sessionId !== currentSessionId) {
        currentSessionId = data.sessionId;
        sessionActive = true;
        document.getElementById('status').textContent = 'Session #' + currentSessionId + ' active';
        document.getElementById('status').className = 'status active';
        document.getElementById('export-btn').disabled = false;
        document.getElementById('session-info').textContent = 'Recording session #' + currentSessionId + '...';
      }

      updateGauge('speed', data.speedKmh || 0);
      updateGauge('rpm', data.currentEngineRpm || 0, 'rpm-bar', 10000);
      updateGauge('gear', data.gear || 0);
      updateGauge('power', data.power || 0, 'power-bar', 1000);

      updateGauge('temp-fl', data.tireTempFl ? data.tireTempFl.toFixed(0) + '°C' : '--°C', 'temp-fl-bar', 100, data.tireTempFl);
      updateGauge('temp-fr', data.tireTempFr ? data.tireTempFr.toFixed(0) + '°C' : '--°C', 'temp-fr-bar', 100, data.tireTempFr);
      updateGauge('temp-rl', data.tireTempRl ? data.tireTempRl.toFixed(0) + '°C' : '--°C', 'temp-rl-bar', 100, data.tireTempRl);
      updateGauge('temp-rr', data.tireTempRr ? data.tireTempRr.toFixed(0) + '°C' : '--°C', 'temp-rr-bar', 100, data.tireTempRr);

      document.getElementById('lap-time').textContent = formatTime((data.currentLap || 0) * 1000);
      document.getElementById('lap-num').textContent = data.lapNumber || '-';
      document.getElementById('position').textContent = data.racePosition || '-';
      document.getElementById('fuel').textContent = data.fuel ? data.fuel.toFixed(1) + 'L' : '-';
      document.getElementById('boost').textContent = data.boost ? data.boost.toFixed(1) : '-';

      document.getElementById('throttle').textContent = (data.throttle || 0) + '%';
      document.getElementById('brake').textContent = (data.brake || 0) + '%';
      document.getElementById('clutch').textContent = (data.clutch || 0) + '%';
      document.getElementById('handbrake').textContent = (data.handbrake || 0) + '%';
      document.getElementById('steer').textContent = data.steer || 0;

      if (data.bestLap && data.bestLap > 0) {
        document.getElementById('lap-best').textContent = 'Best: ' + formatTime(data.bestLap * 1000);
      }

      if (data.completedLap) {
        document.getElementById('lap-best').textContent = 'Best: ' + formatTime(data.completedLap.lapTime * 1000);
      }
    };

    document.getElementById('export-btn').addEventListener('click', async () => {
      const btn = document.getElementById('export-btn');
      btn.disabled = true;
      btn.textContent = 'Exporting...';
      try {
        const res = await fetch('/export');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'session_' + currentSessionId + '.json';
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        alert('Export failed: ' + err.message);
      }
      btn.disabled = false;
      btn.textContent = 'Export JSON';
    });
  </script>
</body>
</html>`;
}

async function start() {
  ensureOutputDir();

  const udpServer = await startUDP();
  const httpServer = await startHTTP();

  console.log(`[output] sessions will be saved to ${path.resolve(OUTPUT_DIR)}`);
  console.log('Waiting for telemetry data from Forza Horizon 6...');

  process.on('SIGINT', () => {
    console.log('\n[shutdown] closing session...');
    closeSession();
    udpServer.close();
    httpServer.close();
    process.exit(0);
  });
}

start().catch(console.error);