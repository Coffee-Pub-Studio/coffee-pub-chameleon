# Weather: the contract

A service-only module (like the AI Assistant): no page, no canvas, no code of its own. It is the settings of the server's weather
lookup (`server/weather.js`, `server/weather-providers/`): which service (None by default), the temperature unit, and a note on
the icon style. It is on when it is installed and on in the environment.

The core reads its `service` and `units` (environment scope) to answer `GET /api/modules/:id/weather`, `host.weather.days` and
`read_weather`. A service is used only when chosen here and accepted at the host (`server/service-terms.js`). Off, not installed,
None, or not accepted: every answer is `{ configured: false }` and nothing leaves the server.

A module with days declares only where they are (`weather` in its `module.json`: `stops`, `main`).
