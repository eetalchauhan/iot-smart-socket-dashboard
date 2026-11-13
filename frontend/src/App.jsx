import React, { useState, useEffect } from 'react';
import {
  Zap,
  Flame,
  Activity,
  Gauge,
  Power,
  Lock,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  XOctagon,
  RefreshCw,
  Clock,
  Radio,
  Cpu,
  RotateCcw,
  Wifi,
  Square
} from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  CartesianGrid
} from 'recharts';
import SettingsModal from './components/SettingsModal';

const WS_URL = 'ws://localhost:8080';
const API_BASE = 'http://localhost:8080/api';

export default function App() {
  const [telemetry, setTelemetry] = useState({
    voltage: 230.0,
    current: 0.0,
    power: 0.0,
    temperature: 28.5,
    relay_state: 1,
    status: 'NORMAL',
    status_reason: 'System nominal',
    last_updated: new Date().toISOString(),
    last_mqtt_at: null
  });

  const [settings, setSettings] = useState({
    max_power_w: 2300,
    warn_power_pct: 80,
    warn_temp_c: 55,
    max_temp_c: 70
  });

  const [history, setHistory] = useState([]);
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const [simMode, setSimMode] = useState('normal');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [relayLoading, setRelayLoading] = useState(false);
  const [blockNotification, setBlockNotification] = useState(null);
  const [lastMqttAt, setLastMqttAt] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [mqttMeta, setMqttMeta] = useState({
    broker: 'broker.hivemq.com',
    topic: 'socket/01/telemetry'
  });

  // Keep current time updated for fresh relative diffs
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Connect WebSocket
  useEffect(() => {
    let ws;
    let reconnectTimer;

    function connect() {
      ws = new WebSocket(WS_URL);

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'init') {
            if (payload.data) setTelemetry(payload.data);
            if (payload.settings) setSettings(payload.settings);
            if (payload.simulationMode) setSimMode(payload.simulationMode);
            if (payload.last_mqtt_at) setLastMqttAt(payload.last_mqtt_at);
            if (payload.mqttBroker || payload.telemetryTopic) {
              setMqttMeta({
                broker: payload.mqttBroker ? payload.mqttBroker.replace(/^mqtt:\/\//, '') : 'broker.hivemq.com',
                topic: payload.telemetryTopic || 'socket/01/telemetry'
              });
            }
          } else if (payload.type === 'telemetry') {
            const data = payload.data;
            setTelemetry(data);
            if (payload.simulationMode) setSimMode(payload.simulationMode);
            if (payload.last_mqtt_at) setLastMqttAt(payload.last_mqtt_at);

            // Append to local live chart history (keep 60 points)
            setHistory((prev) => {
              const now = new Date();
              const timeStr = now.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
              const newPoint = {
                time: timeStr,
                power: data.power,
                temperature: data.temperature,
                voltage: data.voltage,
                current: data.current
              };
              const updated = [...prev, newPoint];
              return updated.slice(-60);
            });
          }
        } catch (e) {
          console.error('WS Parse Error', e);
        }
      };

      ws.onclose = () => {
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        setConnected(false);
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (ws) ws.close();
    };
  }, []);

  // Fetch initial history, events & settings via REST
  const refreshHistoryAndEvents = async () => {
    try {
      const [histRes, evRes, setRes] = await Promise.all([
        fetch(`${API_BASE}/history?limit=60`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/events?limit=25`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/settings`).then(r => r.json()).catch(() => null),
      ]);

      if (histRes?.data?.length) {
        setHistory(
          histRes.data.map(d => ({
            time: new Date(d.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            power: d.power,
            temperature: d.temperature,
            voltage: d.voltage,
            current: d.current
          }))
        );
      }

      if (evRes?.data) {
        setEvents(evRes.data);
      }

      if (setRes?.settings) {
        setSettings(setRes.settings);
      }
    } catch (e) {
      console.warn('Initial REST load notice:', e);
    }
  };

  useEffect(() => {
    refreshHistoryAndEvents();
    const interval = setInterval(() => {
      // Periodically refresh event log
      fetch(`${API_BASE}/events?limit=25`)
        .then(r => r.json())
        .then(res => {
          if (res?.data) setEvents(res.data);
        })
        .catch(() => {});
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  // Relay Toggle Handler
  const handleToggleRelay = async () => {
    if (telemetry.status === 'FAULT' && telemetry.relay_state === 0) {
      setBlockNotification(
        `RELAY TOGGLE BLOCKED: Status is FAULT (${telemetry.status_reason}). Resolve hazardous condition before turning ON.`
      );
      setTimeout(() => setBlockNotification(null), 5000);
      return;
    }

    setRelayLoading(true);
    setBlockNotification(null);
    try {
      const targetState = telemetry.relay_state === 1 ? false : true;
      const res = await fetch(`${API_BASE}/relay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: targetState }),
      });
      const data = await res.json();
      if (!res.ok || data.blocked) {
        setBlockNotification(data.reason || 'Operation blocked by safety controller');
        setTimeout(() => setBlockNotification(null), 5000);
      } else {
        setTelemetry(prev => ({ ...prev, relay_state: data.relay_state }));
      }
    } catch (err) {
      setBlockNotification('Failed to communicate with socket backend.');
    } finally {
      setRelayLoading(false);
    }
  };

  // Change simulation profile
  const handleSimulate = async (mode) => {
    try {
      await fetch(`${API_BASE}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      setSimMode(mode);
    } catch (e) {
      console.error(e);
    }
  };

  // Clear fault manually
  const handleClearFault = async () => {
    try {
      await fetch(`${API_BASE}/clear-fault`, { method: 'POST' });
      setBlockNotification(null);
    } catch (e) {
      console.error(e);
    }
  };

  // Save Settings Modal
  const handleSaveSettings = async (newSettings) => {
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings),
      });
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
    } catch (e) {
      console.error(e);
    }
  };

  // Derived threshold values
  const warnPowerWatts = (settings.max_power_w * settings.warn_power_pct) / 100;
  const isFault = telemetry.status === 'FAULT';
  const isWarning = telemetry.status === 'WARNING';

  // Threshold bar calculations
  const powerPct = Math.min(100, Math.round((telemetry.power / settings.max_power_w) * 100));
  const tempPct = Math.min(100, Math.round((telemetry.temperature / settings.max_temp_c) * 100));
  const voltPct = Math.min(100, Math.round((telemetry.voltage / 260) * 100));
  const maxCurrentEstimate = settings.max_power_w / 220;
  const currentPct = Math.min(100, Math.round((telemetry.current / maxCurrentEstimate) * 100));

  // Calculate ESP32 connection state based on last_mqtt_at
  const mqttAgeSec = lastMqttAt ? Math.max(0, Math.round((currentTime - new Date(lastMqttAt).getTime()) / 1000)) : null;
  // Consider online if an MQTT packet was received in the last 15 seconds
  const isEsp32Connected = lastMqttAt && mqttAgeSec !== null && mqttAgeSec <= 15;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Radio className="text-white animate-pulse" size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white">SmartSocket IoT</h1>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                NODE_01
              </span>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2">
              <span className="flex items-center gap-1">
                <span className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-ping' : 'bg-red-500'}`}></span>
                {connected ? 'WS 8080 Live' : 'Disconnected'}
              </span>
            </p>
          </div>
        </div>

        {/* ESP32 Hardware Status Badge & MQTT Broker info */}
        <div className="flex items-center gap-3 order-3 sm:order-2">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all ${
              isEsp32Connected
                ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-300 shadow-md shadow-emerald-950/20'
                : 'bg-slate-800/60 border-slate-700/60 text-slate-400'
            }`}
          >
            <span className="relative flex h-2.5 w-2.5">
              {isEsp32Connected && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isEsp32Connected ? 'bg-emerald-400' : 'bg-slate-500'
                }`}
              ></span>
            </span>

            <div className="flex flex-col text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold font-mono tracking-wide">
                  ESP32 Hardware: {isEsp32Connected ? 'CONNECTED' : 'OFFLINE'}
                </span>
                {lastMqttAt && (
                  <span className="text-[10px] font-mono text-slate-400">
                    ({mqttAgeSec}s ago)
                  </span>
                )}
              </div>
              <span className="text-[10px] text-slate-400 font-mono">
                MQTT: <span className="text-cyan-400">{mqttMeta.broker}</span> | <span className="text-cyan-300">{mqttMeta.topic}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-3 order-2 sm:order-3">
          {isFault && (
            <button
              onClick={handleClearFault}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30 transition shadow-sm"
              title="Reset fault and return simulator to normal"
            >
              <RotateCcw size={14} />
              Reset Fault
            </button>
          )}

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition"
          >
            <Sliders size={15} className="text-cyan-400" />
            <span>Thresholds</span>
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">

        {/* Status LED Banner */}
        <div
          className={`relative overflow-hidden rounded-2xl border p-4 sm:p-5 transition-all duration-300 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xl ${
            isFault
              ? 'bg-rose-950/40 border-rose-600/60 shadow-rose-950/30'
              : isWarning
              ? 'bg-amber-950/40 border-amber-500/60 shadow-amber-950/30'
              : 'bg-emerald-950/30 border-emerald-500/50 shadow-emerald-950/20'
          }`}
        >
          <div className="flex items-center gap-4">
            {/* Pulsing Status LED */}
            <div className="relative flex items-center justify-center">
              <span
                className={`absolute w-10 h-10 rounded-full animate-ping opacity-60 ${
                  isFault ? 'bg-rose-500' : isWarning ? 'bg-amber-400' : 'bg-emerald-400'
                }`}
              ></span>
              <div
                className={`relative w-8 h-8 rounded-full flex items-center justify-center shadow-lg ${
                  isFault
                    ? 'bg-rose-500 text-white shadow-rose-500/50'
                    : isWarning
                    ? 'bg-amber-400 text-slate-950 shadow-amber-400/50'
                    : 'bg-emerald-500 text-slate-950 shadow-emerald-500/50'
                }`}
              >
                {isFault ? <XOctagon size={18} /> : isWarning ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                    isFault
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : isWarning
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  }`}
                >
                  LED Status: {telemetry.status}
                </span>
                <span className="text-xs text-slate-400 hidden sm:inline">
                  • Relay: {telemetry.relay_state === 1 ? 'ACTIVE (CLOSED)' : 'OPEN (TRIPPED/OFF)'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-semibold text-white mt-1">
                {telemetry.status_reason}
              </h2>
            </div>
          </div>

          {/* Master Relay Toggle Button with Lock Protection */}
          <div className="flex flex-col items-end w-full sm:w-auto">
            <button
              onClick={handleToggleRelay}
              disabled={relayLoading || (isFault && telemetry.relay_state === 0)}
              className={`w-full sm:w-auto flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl font-semibold text-sm transition-all duration-200 shadow-lg ${
                isFault && telemetry.relay_state === 0
                  ? 'bg-slate-800 text-slate-500 border border-rose-900/60 cursor-not-allowed opacity-90'
                  : telemetry.relay_state === 1
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/25 active:scale-95'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 active:scale-95'
              }`}
            >
              {isFault && telemetry.relay_state === 0 ? (
                <>
                  <Lock size={18} className="text-rose-400" />
                  <span>RELAY LOCKED (FAULT)</span>
                </>
              ) : (
                <>
                  <Power size={18} className={telemetry.relay_state === 1 ? 'text-slate-950' : 'text-slate-400'} />
                  <span>{telemetry.relay_state === 1 ? 'MASTER RELAY: ON' : 'MASTER RELAY: OFF'}</span>
                </>
              )}
            </button>
            {isFault && telemetry.relay_state === 0 && (
              <span className="text-[11px] text-rose-400 mt-1 flex items-center gap-1 font-mono">
                <Lock size={12} />
                Blocked: Resolve fault / reset to enable ON
              </span>
            )}
          </div>
        </div>

        {/* Pop-up block alert notice if user clicks locked button */}
        {blockNotification && (
          <div className="p-3 bg-rose-950/80 border border-rose-600 rounded-xl text-xs text-rose-200 flex items-center justify-between gap-3 animate-fade-in shadow-lg">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-rose-400 shrink-0" />
              <span>{blockNotification}</span>
            </div>
            <button
              onClick={() => setBlockNotification(null)}
              className="text-rose-400 hover:text-white text-xs font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Demo Simulation Control Bar */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400">
              <Cpu size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-200">Demo Simulation Bar</span>
                <span className="text-[10px] bg-indigo-950 border border-indigo-800 text-indigo-300 px-1.5 py-0.2 rounded font-mono">
                  /api/simulate
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Trigger 1-second load behaviors over WebSocket to test fault protection and alert handling
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 w-full md:w-auto">
            <button
              onClick={() => handleSimulate('off')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition border flex items-center justify-center gap-1.5 ${
                simMode === 'off'
                  ? 'bg-cyan-600 text-white border-cyan-300 shadow-md shadow-cyan-950 ring-1 ring-cyan-400'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              }`}
              title="Stop simulator and listen exclusively to real MQTT socket/01/telemetry packets"
            >
              <Wifi size={14} className={simMode === 'off' ? 'text-white' : 'text-cyan-400'} />
              Hardware Live (Stop Sim)
            </button>

            <button
              onClick={() => handleSimulate('normal')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition border flex items-center justify-center gap-1.5 ${
                simMode === 'normal'
                  ? 'bg-emerald-600 text-white border-emerald-400 shadow-md shadow-emerald-950'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              }`}
            >
              <CheckCircle2 size={14} className={simMode === 'normal' ? 'text-white' : 'text-emerald-400'} />
              Normal
            </button>

            <button
              onClick={() => handleSimulate('warning')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition border flex items-center justify-center gap-1.5 ${
                simMode === 'warning'
                  ? 'bg-amber-600 text-white border-amber-400 shadow-md shadow-amber-950'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              }`}
            >
              <AlertTriangle size={14} className={simMode === 'warning' ? 'text-white' : 'text-amber-400'} />
              Warning (80%)
            </button>

            <button
              onClick={() => handleSimulate('overload')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition border flex items-center justify-center gap-1.5 ${
                simMode === 'overload'
                  ? 'bg-rose-600 text-white border-rose-400 shadow-md shadow-rose-950'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              }`}
            >
              <Zap size={14} className={simMode === 'overload' ? 'text-white' : 'text-rose-400'} />
              Overload (&gt;2.3kW)
            </button>

            <button
              onClick={() => handleSimulate('overheat')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition border flex items-center justify-center gap-1.5 ${
                simMode === 'overheat'
                  ? 'bg-rose-700 text-white border-rose-400 shadow-md shadow-rose-950'
                  : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300 border-slate-700/80'
              }`}
            >
              <Flame size={14} className={simMode === 'overheat' ? 'text-white' : 'text-rose-400'} />
              Overheat (&gt;70°C)
            </button>
          </div>
        </div>

        {/* 4 KPI Cards with Threshold Progress Bars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Voltage */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-lg relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">Mains Voltage</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-3xl font-extrabold text-white font-mono">{telemetry.voltage.toFixed(1)}</span>
                  <span className="text-sm font-semibold text-slate-400">V</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                <Gauge size={22} />
              </div>
            </div>
            {/* Threshold Bar */}
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono mb-1">
                <span>Nominal: 230V</span>
                <span>{voltPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (telemetry.voltage / 250) * 100)}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Current */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-lg relative overflow-hidden">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">Current Draw</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-3xl font-extrabold text-white font-mono">{telemetry.current.toFixed(2)}</span>
                  <span className="text-sm font-semibold text-slate-400">A</span>
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <Activity size={22} />
              </div>
            </div>
            {/* Threshold Bar */}
            <div className="mt-4">
              <div className="flex justify-between text-[11px] text-slate-400 font-mono mb-1">
                <span>Max rated: 10.0A</span>
                <span>{currentPct}%</span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                  style={{ width: `${currentPct}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Active Power */}
          <div
            className={`rounded-2xl p-5 shadow-lg relative overflow-hidden border transition-all duration-300 ${
              telemetry.power > settings.max_power_w
                ? 'bg-rose-950/30 border-rose-500/60'
                : telemetry.power >= warnPowerWatts
                ? 'bg-amber-950/30 border-amber-500/60'
                : 'bg-slate-900/90 border-slate-800/80'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">Active Power</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-3xl font-extrabold text-white font-mono">{telemetry.power.toFixed(1)}</span>
                  <span className="text-sm font-semibold text-slate-400">W</span>
                </div>
              </div>
              <div
                className={`p-2.5 rounded-xl border ${
                  telemetry.power > settings.max_power_w
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    : telemetry.power >= warnPowerWatts
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                <Zap size={22} />
              </div>
            </div>
            {/* Threshold Bar */}
            <div className="mt-4">
              <div className="flex justify-between text-[11px] font-mono mb-1">
                <span className="text-slate-400">Limit: {settings.max_power_w}W</span>
                <span
                  className={
                    telemetry.power > settings.max_power_w
                      ? 'text-rose-400 font-bold'
                      : telemetry.power >= warnPowerWatts
                      ? 'text-amber-400 font-bold'
                      : 'text-slate-400'
                  }
                >
                  {powerPct}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    telemetry.power > settings.max_power_w
                      ? 'bg-rose-500'
                      : telemetry.power >= warnPowerWatts
                      ? 'bg-amber-400'
                      : 'bg-emerald-400'
                  }`}
                  style={{ width: `${powerPct}%` }}
                ></div>
              </div>
            </div>
          </div>

          {/* Temperature */}
          <div
            className={`rounded-2xl p-5 shadow-lg relative overflow-hidden border transition-all duration-300 ${
              telemetry.temperature >= settings.max_temp_c
                ? 'bg-rose-950/30 border-rose-500/60'
                : telemetry.temperature >= settings.warn_temp_c
                ? 'bg-amber-950/30 border-amber-500/60'
                : 'bg-slate-900/90 border-slate-800/80'
            }`}
          >
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs uppercase tracking-wider text-slate-400 font-medium">Socket Core Temp</p>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-3xl font-extrabold text-white font-mono">{telemetry.temperature.toFixed(1)}</span>
                  <span className="text-sm font-semibold text-slate-400">°C</span>
                </div>
              </div>
              <div
                className={`p-2.5 rounded-xl border ${
                  telemetry.temperature >= settings.max_temp_c
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/30'
                    : telemetry.temperature >= settings.warn_temp_c
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                <Flame size={22} />
              </div>
            </div>
            {/* Threshold Bar */}
            <div className="mt-4">
              <div className="flex justify-between text-[11px] font-mono mb-1">
                <span className="text-slate-400">Max: {settings.max_temp_c}°C</span>
                <span
                  className={
                    telemetry.temperature >= settings.max_temp_c
                      ? 'text-rose-400 font-bold'
                      : telemetry.temperature >= settings.warn_temp_c
                      ? 'text-amber-400 font-bold'
                      : 'text-slate-400'
                  }
                >
                  {tempPct}%
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    telemetry.temperature >= settings.max_temp_c
                      ? 'bg-rose-500'
                      : telemetry.temperature >= settings.warn_temp_c
                      ? 'bg-amber-400'
                      : 'bg-teal-400'
                  }`}
                  style={{ width: `${tempPct}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>

        {/* Live 60s Power & Temperature Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Power Chart */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Zap size={18} className="text-cyan-400" />
                  Live Power Consumption (60s)
                </h3>
                <p className="text-xs text-slate-400">Real-time load with Warning and Trip thresholds</p>
              </div>
              <span className="text-xs font-mono px-2 py-1 bg-slate-800 rounded border border-slate-700 text-cyan-300">
                {telemetry.power.toFixed(0)} W
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} minTickGap={20} />
                  <YAxis stroke="#64748b" domain={[0, Math.max(3000, settings.max_power_w + 300)]} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                    itemStyle={{ color: '#38bdf8' }}
                  />
                  {/* Warning line (dashed amber) */}
                  <ReferenceLine
                    y={warnPowerWatts}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: `Warn ${warnPowerWatts.toFixed(0)}W`, fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }}
                  />
                  {/* Trip line (dashed red) */}
                  <ReferenceLine
                    y={settings.max_power_w}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{ value: `Max ${settings.max_power_w}W`, fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="power"
                    stroke="#06b6d4"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-3 border-t border-slate-800 mt-2 font-mono">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-cyan-400 inline-block"></span> Power (W)
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2.5 h-0.5 bg-amber-400 inline-block border-b border-dashed"></span> Warn: {warnPowerWatts.toFixed(0)}W
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-0.5 bg-rose-500 inline-block border-b border-dashed"></span> Max: {settings.max_power_w}W
              </span>
            </div>
          </div>

          {/* Temperature Chart */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-xl flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-white flex items-center gap-2">
                  <Flame size={18} className="text-rose-400" />
                  Live Core Temperature (60s)
                </h3>
                <p className="text-xs text-slate-400">Thermal monitoring with safety trip bounds</p>
              </div>
              <span className="text-xs font-mono px-2 py-1 bg-slate-800 rounded border border-slate-700 text-rose-300">
                {telemetry.temperature.toFixed(1)} °C
              </span>
            </div>

            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="time" stroke="#64748b" tick={{ fontSize: 10 }} minTickGap={20} />
                  <YAxis stroke="#64748b" domain={[20, Math.max(85, settings.max_temp_c + 15)]} tick={{ fontSize: 10 }} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', fontSize: '12px' }}
                    itemStyle={{ color: '#fb7185' }}
                  />
                  {/* Warning line (dashed amber) */}
                  <ReferenceLine
                    y={settings.warn_temp_c}
                    stroke="#f59e0b"
                    strokeDasharray="4 4"
                    label={{ value: `Warn ${settings.warn_temp_c}°C`, fill: '#f59e0b', fontSize: 10, position: 'insideTopRight' }}
                  />
                  {/* Max Trip line (dashed red) */}
                  <ReferenceLine
                    y={settings.max_temp_c}
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                    label={{ value: `Max ${settings.max_temp_c}°C`, fill: '#ef4444', fontSize: 10, position: 'insideTopLeft' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="temperature"
                    stroke="#f43f5e"
                    strokeWidth={2.5}
                    dot={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-400 pt-3 border-t border-slate-800 mt-2 font-mono">
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-0.5 bg-rose-500 inline-block"></span> Temp (°C)
              </span>
              <span className="flex items-center gap-1.5 text-amber-400">
                <span className="w-2.5 h-0.5 bg-amber-400 inline-block border-b border-dashed"></span> Warn: {settings.warn_temp_c}°C
              </span>
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2.5 h-0.5 bg-rose-500 inline-block border-b border-dashed"></span> Max: {settings.max_temp_c}°C
              </span>
            </div>
          </div>
        </div>

        {/* Event & Alert Log Table */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl shadow-xl overflow-hidden">
          <div className="p-5 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-cyan-400" />
              <h3 className="text-base font-semibold text-white">Event &amp; Safety Audit Log</h3>
              <span className="text-xs bg-slate-800 border border-slate-700 px-2 py-0.5 rounded-full text-slate-300">
                {events.length} records
              </span>
            </div>
            <button
              onClick={refreshHistoryAndEvents}
              className="text-xs flex items-center gap-1.5 text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 transition"
            >
              <RefreshCw size={14} />
              <span>Refresh Log</span>
            </button>
          </div>

          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-mono uppercase tracking-wider sticky top-0 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Severity</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Description / Trip Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {events.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-8 text-center text-slate-500">
                      No security or safety trips recorded yet.
                    </td>
                  </tr>
                ) : (
                  events.map((ev) => (
                    <tr key={ev.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 text-slate-400 whitespace-nowrap">
                        {new Date(ev.timestamp).toLocaleTimeString()}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                            ev.severity === 'CRITICAL'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : ev.severity === 'WARN'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                          }`}
                        >
                          {ev.severity}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-white font-medium">
                        {ev.type}
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-sans">
                        {ev.message}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </main>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
