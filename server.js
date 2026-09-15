/**
 * Custom entry point for Plesk/Passenger, which expects a single JS file it
 * can load directly and that starts listening on a port itself — unlike
 * `next start`, which is a CLI command, not a requireable file. This is
 * Next.js's own documented pattern for exactly that situation.
 *
 * Not used for local development (`npm run dev` still uses plain `next
 * dev`) or for a `next start`-based deploy — only needed where the host's
 * process manager requires a startup file rather than a start command.
 */
const { createServer } = require("node:http");
const next = require("next");

const port = Number.parseInt(process.env.PORT, 10) || 3000;
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev, dir: __dirname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((req, res) => {
    handle(req, res);
  }).listen(port, () => {
    console.log(`> Ready on port ${port}`);
  });
});
