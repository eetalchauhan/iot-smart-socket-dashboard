# IoT Smart Socket Dashboard

Full-stack IoT Smart Socket monitoring and control dashboard with SQLite, MQTT, WebSocket streaming, and a React + Vite + Tailwind CSS dark-slate UI.

---

## Architecture Overview

- **`/backend`**: Node.js + Express + `ws` + `mqtt` + `better-sqlite3`
  - **MQTT Topics**:
    - Subscribes to `socket/01/telemetry` (`{ voltage, current, power, temperature, relay_state }`)
    - Publishes to `socket/01/command` (`ON` or `OFF`)
  - **WebSocket Server**: `ws://localhost:8080` (1-second live telemetry streaming)
  - **SQLite Database** (`socket.db`):
    - `settings`: `max_power_w` (2300W), `warn_power_pct` (80%), `warn_temp_c` (55°C), `max_temp_c` (70°C)
    - `readings`: Historical telemetry data points
    - `events`: Trip alerts, threshold triggers, user relay actions, and safety violations
  - **REST Endpoints**:
    - `GET /api/history`: Recent telemetry readings (supports `?limit=N`)
    - `GET /api/events`: Safety and trip audit log
    - `GET /api/settings`: Fetch current safety threshold configuration
    - `POST /api/settings`: Update threshold limits
    - `POST /api/relay`: Toggle socket relay (`{ state: true | false }`), **blocks ON if status is FAULT**
    - `POST /api/simulate`: Change simulation load mode (`normal`, `warning`, `overload`, `overheat`)
    - `POST /api/clear-fault`: Reset safety fault status

- **`/frontend`**: React 18 + Vite + Tailwind CSS + Recharts + Lucide Icons
  - **LED Status Banner**: Real-time status indicator (Green `NORMAL`, Yellow `WARNING`, Red `FAULT`) with reason banner
  - **Master ON/OFF Toggle**: Direct relay control, locked with lock reason during `FAULT`
  - **4 KPI Cards**: Mains Voltage (V), Current (A), Active Power (W), Core Temp (°C) with dynamic threshold progress bars
  - **Live 60s Charts**: Dual Recharts line charts for Power and Temp featuring dashed warning and maximum limit lines
  - **Event / Alert Log Table**: Live audit table with timestamp, severity badges (`CRITICAL`, `WARN`, `INFO`), and reason description
  - **Demo Simulation Bar**: Instant switching between `Normal`, `Warning (80%)`, `Overload (>2.3kW)`, and `Overheat (>70°C)`
  - **Settings Modal**: Interactive threshold adjustment directly modifying SQLite safety limits

---

## Quickstart

### 1. Run the Backend
```bash
cd backend
npm start
```
*Backend runs on `http://localhost:8080` and WebSocket on `ws://localhost:8080`.*

### 2. Run the Frontend
```bash
cd frontend
npm run dev
```
*Frontend runs on `http://localhost:5173`.*
