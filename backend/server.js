import http from 'http';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import mqtt from 'mqtt';
import {
  db,
  getSettings,
  updateSettings,
  recordReading,
  recordEvent,
  getReadings,
  getEvents
} from './database.js';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(express.json());

const PORT = 8080;
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com:1883';
const TELEMETRY_TOPIC = 'socket/01/telemetry';
const COMMAND_TOPIC = 'socket/01/command';

// State management
let last_mqtt_at = null; // Track when real MQTT packet arrived from ESP32

let currentTelemetry = {
  voltage: 230.0,
  current: 0.0,
  power: 0.0,
  temperature: 28.5,
  relay_state: 1, // 1 = ON, 0 = OFF
  status: 'NORMAL', // NORMAL, WARNING, FAULT
  status_reason: 'System nominal',
  last_updated: new Date().toISOString(),
  last_mqtt_at: null
};

let simulationMode = 'normal'; // 'normal', 'warning', 'overload', 'overheat', 'off'
let simStep = 0;
let simInterval = null;

function runSimulationTick() {
  if (simulationMode === 'off') return;

  simStep++;
  const relayOn = currentTelemetry.relay_state === 1;
  let voltage = 230 + (Math.sin(simStep * 0.1) * 2.5) + ((Math.random() - 0.5) * 1.5);
  let current = 0;
  let power = 0;
  let temp = currentTelemetry.temperature;

  if (simulationMode === 'normal') {
    if (relayOn) {
      // Normal domestic appliance load: 600W - 1200W
      power = 850 + Math.sin(simStep * 0.2) * 200 + ((Math.random() - 0.5) * 40);
      current = power / voltage;
      // ambient heats slowly towards 40°C
      temp = Math.min(42, temp + 0.15 + (Math.random() * 0.05));
    } else {
      power = 0;
      current = 0;
      // cool down towards room temp 26°C
      temp = Math.max(26, temp - 0.3);
    }
  } else if (simulationMode === 'warning') {
    if (relayOn) {
      // Near warning threshold ~ 1900W - 2000W (warn_power_pct is 80% of 2300 = 1840W)
      power = 1920 + Math.sin(simStep * 0.3) * 60 + ((Math.random() - 0.5) * 30);
      current = power / voltage;
      temp = Math.min(58, temp + 0.3); // approach warning temp 55°C
    } else {
      power = 0;
      current = 0;
      temp = Math.max(28, temp - 0.2);
    }
  } else if (simulationMode === 'overload') {
    if (relayOn) {
      // Severe overload: 2500W - 2800W (exceeds max_power_w 2300W)
      power = 2550 + ((Math.random() - 0.5) * 100);
      current = power / voltage;
      temp = temp + 0.5;
    } else {
      power = 0;
      current = 0;
      temp = Math.max(30, temp - 0.3);
    }
  } else if (simulationMode === 'overheat') {
    if (relayOn) {
      power = 1200 + ((Math.random() - 0.5) * 50);
      current = power / voltage;
      // rapid heating to breach max_temp_c 70°C
      temp = temp + 1.8;
    } else {
      power = 0;
      current = 0;
      temp = Math.max(30, temp - 0.4);
    }
  }

  processTelemetry({
    voltage,
    current,
    power,
    temperature: temp,
    relay_state: currentTelemetry.relay_state
  }, 'SIMULATOR');
}

function startSimulationInterval() {
  if (!simInterval) {
    simInterval = setInterval(runSimulationTick, 1000);
  }
}

function stopSimulationInterval() {
  if (simInterval) {
    clearInterval(simInterval);
    simInterval = null;
  }
}

// Start simulation by default
startSimulationInterval();

// Connect to MQTT Broker
let mqttClient;
try {
  mqttClient = mqtt.connect(MQTT_BROKER, {
    clientId: `smart_socket_srv_${Math.random().toString(16).substring(2, 8)}`,
    reconnectPeriod: 5000,
    connectTimeout: 5000
  });

  mqttClient.on('connect', () => {
    console.log(`Connected to MQTT broker at ${MQTT_BROKER}`);
    mqttClient.subscribe(TELEMETRY_TOPIC, (err) => {
      if (!err) console.log(`Subscribed to ${TELEMETRY_TOPIC}`);
    });
  });

  mqttClient.on('message', (topic, message) => {
    if (topic === TELEMETRY_TOPIC) {
      try {
        const payload = JSON.parse(message.toString());
        last_mqtt_at = new Date().toISOString();
        processTelemetry(payload, 'MQTT');
      } catch (e) {
        console.error('Failed to parse MQTT message:', e.message);
      }
    }
  });

  mqttClient.on('error', (err) => {
    console.warn('MQTT client notice (will continue with mock/local streaming):', err.message);
  });
} catch (e) {
  console.warn('MQTT init notice:', e.message);
}

// Publish MQTT Command
function publishRelayCommand(state) {
  const payload = state ? 'ON' : 'OFF';
  if (mqttClient && mqttClient.connected) {
    mqttClient.publish(COMMAND_TOPIC, payload, { qos: 1 });
  }
  console.log(`[Command] Published to ${COMMAND_TOPIC}: ${payload}`);
}

// Evaluate Safety & Thresholds
function evaluateStatus(reading, settings) {
  const warnPower = (settings.max_power_w * settings.warn_power_pct) / 100;
  const maxPower = settings.max_power_w;
  const warnTemp = settings.warn_temp_c;
  const maxTemp = settings.max_temp_c;

  let status = 'NORMAL';
  let reason = 'System nominal';

  // Fault conditions
  if (reading.power > maxPower) {
    status = 'FAULT';
    reason = `Overload Trip: ${reading.power.toFixed(1)}W exceeds limit ${maxPower}W`;
  } else if (reading.temperature >= maxTemp) {
    status = 'FAULT';
    reason = `Thermal Trip: ${reading.temperature.toFixed(1)}°C exceeds limit ${maxTemp}°C`;
  } else if (reading.power >= warnPower) {
    status = 'WARNING';
    reason = `High Power: ${reading.power.toFixed(1)}W above ${settings.warn_power_pct}% warning (${warnPower.toFixed(0)}W)`;
  } else if (reading.temperature >= warnTemp) {
    status = 'WARNING';
    reason = `High Temperature: ${reading.temperature.toFixed(1)}°C above warning (${warnTemp}°C)`;
  }

  return { status, reason, warnPower, maxPower, warnTemp, maxTemp };
}

// Process incoming telemetry data (from MQTT or Simulator)
function processTelemetry(data, source = 'SIMULATOR') {
  const settings = getSettings();
  const rawPower = Number(data.power ?? (data.voltage * data.current));
  const reading = {
    voltage: Number(Number(data.voltage ?? 230).toFixed(1)),
    current: Number(Number(data.current ?? 0).toFixed(2)),
    power: Number(rawPower.toFixed(1)),
    temperature: Number(Number(data.temperature ?? 28).toFixed(1)),
    relay_state: Number(data.relay_state !== undefined ? (data.relay_state ? 1 : 0) : currentTelemetry.relay_state)
  };

  const evalResult = evaluateStatus(reading, settings);
  const previousStatus = currentTelemetry.status;

  // Auto-trip protection if FAULT occurs while relay is ON
  if (evalResult.status === 'FAULT' && reading.relay_state === 1) {
    reading.relay_state = 0;
    publishRelayCommand(false);
    recordEvent('SAFETY_TRIP', 'CRITICAL', `Emergency Trip: ${evalResult.reason}. Relay shut down.`, {
      telemetry: reading,
      trigger: evalResult.status
    });
  }

  // Record status transitions in event log
  if (evalResult.status !== previousStatus) {
    if (evalResult.status === 'FAULT') {
      recordEvent('FAULT', 'CRITICAL', evalResult.reason, reading);
    } else if (evalResult.status === 'WARNING') {
      recordEvent('WARNING', 'WARN', evalResult.reason, reading);
    } else if (evalResult.status === 'NORMAL' && previousStatus !== 'NORMAL') {
      recordEvent('NORMAL', 'INFO', 'Parameters returned to normal operating range', reading);
    }
  }

  currentTelemetry = {
    ...reading,
    status: evalResult.status,
    status_reason: evalResult.reason,
    warn_power_w: evalResult.warnPower,
    max_power_w: evalResult.maxPower,
    warn_temp_c: evalResult.warnTemp,
    max_temp_c: evalResult.maxTemp,
    last_updated: new Date().toISOString(),
    last_mqtt_at: last_mqtt_at
  };

  recordReading(reading);
  broadcastTelemetry();
}

// WebSocket broadcast
function broadcastTelemetry() {
  const message = JSON.stringify({
    type: 'telemetry',
    data: currentTelemetry,
    simulationMode,
    last_mqtt_at
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

// WebSocket connection handling
wss.on('connection', (ws) => {
  // Send current state and settings immediately on connect
  ws.send(JSON.stringify({
    type: 'init',
    data: currentTelemetry,
    settings: getSettings(),
    simulationMode,
    last_mqtt_at,
    mqttBroker: MQTT_BROKER,
    telemetryTopic: TELEMETRY_TOPIC,
    commandTopic: COMMAND_TOPIC
  }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.action === 'PING') {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } catch {}
  });
});

// REST Endpoints
app.get('/api/history', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 500);
  const rows = getReadings(limit);
  res.json({ success: true, count: rows.length, data: rows });
});

app.get('/api/events', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = getEvents(limit);
  res.json({ success: true, count: rows.length, data: rows });
});

app.get('/api/settings', (req, res) => {
  res.json({ success: true, settings: getSettings() });
});

app.post('/api/settings', (req, res) => {
  const updated = updateSettings(req.body);
  recordEvent('SETTINGS_UPDATE', 'INFO', 'Safety thresholds updated by user', req.body);
  // Re-evaluate telemetry against new settings
  const evalResult = evaluateStatus(currentTelemetry, updated);
  currentTelemetry.status = evalResult.status;
  currentTelemetry.status_reason = evalResult.reason;
  broadcastTelemetry();
  res.json({ success: true, settings: updated });
});

app.post('/api/relay', (req, res) => {
  const { state } = req.body; // true or false / 'ON' or 'OFF'
  const turnOn = state === true || state === 'ON' || state === 1;

  if (turnOn && currentTelemetry.status === 'FAULT') {
    return res.status(403).json({
      success: false,
      blocked: true,
      reason: `Relay activation BLOCKED: ${currentTelemetry.status_reason}. Resolve fault condition before resetting.`
    });
  }

  const newState = turnOn ? 1 : 0;
  currentTelemetry.relay_state = newState;
  publishRelayCommand(turnOn);
  recordEvent('RELAY_TOGGLE', 'INFO', `User switched relay ${turnOn ? 'ON' : 'OFF'}`, { state: turnOn });

  broadcastTelemetry();
  res.json({
    success: true,
    relay_state: newState,
    status: currentTelemetry.status
  });
});

app.post('/api/simulate', (req, res) => {
  const { mode } = req.body;
  const validModes = ['normal', 'warning', 'overload', 'overheat', 'off'];
  if (!validModes.includes(mode)) {
    return res.status(400).json({ success: false, error: `Invalid mode. Allowed: ${validModes.join(', ')}` });
  }

  simulationMode = mode;
  if (mode === 'off') {
    stopSimulationInterval();
  } else {
    startSimulationInterval();
    // If moving back to normal, reset extreme temperatures
    if (mode === 'normal') {
      currentTelemetry.temperature = 28.5;
    } else if (mode === 'overheat') {
      currentTelemetry.temperature = 65.0; // quickly reaches trip
    }
  }

  recordEvent('SIMULATION_MODE', 'INFO', `Simulation profile set to [${mode.toUpperCase()}]`);
  broadcastTelemetry();
  res.json({ success: true, mode: simulationMode });
});

app.post('/api/clear-fault', (req, res) => {
  // Helpful endpoint for user to reset status after resolving fault
  currentTelemetry.temperature = 28.0;
  simulationMode = 'normal';
  currentTelemetry.status = 'NORMAL';
  currentTelemetry.status_reason = 'System nominal';
  recordEvent('FAULT_RESET', 'INFO', 'Fault manually reset by operator');
  broadcastTelemetry();
  res.json({ success: true, status: currentTelemetry.status });
});

server.listen(PORT, () => {
  console.log(`Smart Socket Backend running at http://localhost:${PORT}`);
  console.log(`WebSocket server accessible at ws://localhost:${PORT}`);
});
