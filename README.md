# fh6-telemetry

A UDP telemetry receiver for Forza Horizon 6. It listens for the data the game broadcasts over the network, tracks your sessions and lap times, and serves a live dashboard in the browser.

## How it works

Forza Horizon 6 can stream telemetry packets over UDP while you're driving. This tool receives those packets, parses every field (speed, RPM, tire temps, inputs, position, etc.), groups them into sessions based on when the race flag goes on and off, and exposes everything through a small HTTP server.

The browser dashboard connects via Server-Sent Events and updates in real time. When a session ends, it's saved to disk as a JSON file you can analyze later.

## Setup

You need Node.js 18 or newer.

```
npm install
```

That's the only dependency (`dgram` for the UDP socket).

## Running

```
npm start
```

The server starts two listeners:

- UDP on port `20440` — this is where the game sends data
- HTTP on port `3000` — open this in a browser to see the live dashboard

Both ports can be changed with environment variables:

```
PORT=20777 HTTP_PORT=8080 npm start
```

## Game configuration

In Forza Horizon 6, go to **Settings > HUD and Gameplay** and enable the **Data Out** option. Set the output IP to the machine running this tool and the port to `20440` (or whatever you set `PORT` to).

If the game is running on the same PC, use `127.0.0.1`. If it's on a console or a different machine on your network, use the local IP of the machine running this tool.

## Dashboard

Open `http://localhost:3000` in a browser. You'll see:

- Current speed, RPM, gear, and power output
- Lap time and best lap
- Tire temperatures per corner (color-coded: green is fine, yellow is getting warm, red is too hot)
- Throttle, brake, clutch, handbrake, and steering inputs
- Session info and an export button

The dashboard only shows data while a session is active (i.e., while the game's race flag is on).

## Sessions

Sessions are saved automatically to the `sessions/` directory when a session ends. A session is only saved if it had at least one completed lap or more than 400 packets recorded.

File names follow the pattern `session_NNNN_<carOrdinal>.json`.

Each file includes:

- Session metadata (start/end time, car ordinal, class, PI)
- Lap times with formatted strings
- Aggregate stats (max speed, max RPM, max power, average fuel, max boost)
- The full packet log

You can also export the current active session at any time by hitting the **Export JSON** button in the dashboard, or by hitting `GET /export` directly.

## HTTP endpoints

| Endpoint      | Description                                      |
| ------------- | ------------------------------------------------ |
| `GET /`       | Live dashboard                                   |
| `GET /events` | SSE stream of raw telemetry packets              |
| `GET /status` | JSON with current session state and client count |
| `GET /export` | Download the current session as JSON             |

## Rewind handling

The session manager handles the game's rewind feature. If the race state drops and comes back within 30 seconds at a lower race time than where it left off, it treats that as a rewind rather than a new session and continues recording into the same file.

## Data fields

Every packet contains:

- Engine: RPM (current, idle, max), power (W), torque (Nm), boost
- Motion: speed (m/s and km/h), velocity (XYZ), acceleration (XYZ), position (XYZ), yaw/pitch/roll
- Tires: temperature (Celsius), slip ratio, slip angle, wear (if available in the packet)
- Suspension travel per corner
- Inputs: throttle, brake, clutch, handbrake (0-255), gear, steering (-127 to 127)
- Race: current lap time, best lap, last lap, race time, lap number, race position
- Car: ordinal ID, class, performance index (PI), drivetrain type
- Fuel level
- Distance traveled
