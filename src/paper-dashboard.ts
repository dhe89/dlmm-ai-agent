import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { PaperPortfolioService } from "./paper-portfolio-service.js";
import { PaperLedgerStore } from "./paper-ledger-store.js";
import { MeteoraPoolCollector } from "./collectors/meteora.js";
import { getPaperStrategyRunnerHealth } from "./paper-runner-health.js";

const statePath = resolve(process.env.PAPER_STATE_PATH ?? "data/local/paper-portfolio.json");
const runnerStatusPath = resolve(process.env.PAPER_RUNNER_STATUS_PATH ?? "data/local/strategy-runner-status.json");
const port = Number(process.env.PAPER_DASHBOARD_PORT ?? process.env.PORT ?? "8787");
const host = process.env.PAPER_DASHBOARD_HOST ?? "127.0.0.1";
const dashboardUsername = process.env.PAPER_DASHBOARD_USERNAME;
const dashboardPassword = process.env.PAPER_DASHBOARD_PASSWORD;
const store = new PaperLedgerStore(statePath);
const portfolio = new PaperPortfolioService(store);
const collector = new MeteoraPoolCollector();

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload, null, 2));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 32_768) throw new Error("request body too large");
  }
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("request body must be a JSON object");
  return parsed as Record<string, unknown>;
}
function stringField(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} must be a non-empty string`);
  return value;
}
function numberField(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}
const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101827"><title>DLMM Paper Portfolio</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1220;color:#e5edf8}
*{box-sizing:border-box}body{margin:0;padding:20px;max-width:1100px;margin-inline:auto}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:1.45rem;margin:0}h2{font-size:1rem;margin:0 0 12px;color:#a9c4e8}
small,.muted{color:#8ea3bd}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:12px;margin:20px 0}
.card,section{background:#131f31;border:1px solid #26374f;border-radius:14px;padding:16px}
.label{font-size:.8rem;color:#91a8c4}.value{font-size:1.35rem;font-weight:700;margin-top:7px;overflow-wrap:anywhere}
section{margin:14px 0;overflow:hidden}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
button,input{font:inherit;border-radius:8px;border:1px solid #354c68;padding:10px;background:#0d1727;color:#e5edf8}
button{cursor:pointer;background:#234c7d}button.secondary{background:#1a2b40}input{width:100%;min-width:0}
form{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:10px}
table{border-collapse:collapse;width:100%;font-size:.9rem}th,td{text-align:left;padding:10px;border-bottom:1px solid #26374f;overflow-wrap:anywhere}th{color:#9eb6d4}
.table-wrap{overflow-x:auto}.positive{color:#64d8a5}.negative{color:#ff8d96}.notice{background:#302b1a;border:1px solid #62552d;padding:12px;border-radius:10px;font-size:.85rem}
#message{margin:10px 0;color:#9ac7ff;white-space:pre-wrap}@media(max-width:480px){body{padding:12px}.value{font-size:1.15rem}td,th{padding:8px}}
</style></head><body>
<header><div><h1>DLMM Paper Portfolio</h1><small>Simulation only · no wallet · no on-chain transactions</small></div><div class="row"><button id="refresh">Refresh</button><button class="secondary" id="market">Fetch market data</button></div></header>
<div id="message">Loading portfolio…</div><div id="summary" class="cards"></div>
<section><h2>Open a virtual position</h2><form id="openForm">
<label>Position ID<input name="id" required placeholder="demo-1"></label><label>Pool address<input name="pool" required placeholder="Pool address"></label>
<label>Capital USD<input name="capital" type="number" min="0.01" step="any" required value="100"></label>
<label>Entry pair price<input name="entryPrice" type="number" min="0.000000001" step="any" required></label>
<div class="row"><button type="submit">Open paper position</button></div></form></section>
<section><h2>Open positions</h2><div class="table-wrap"><table><thead><tr><th>ID / Pool</th><th>Capital</th><th>Entry pair price</th><th>Marked value</th><th>Unrealized PnL</th><th>Actions</th></tr></thead><tbody id="positions"></tbody></table></div></section>
<section><h2>Market pool discovery</h2><p class="muted">Read-only pool data. Pair price is not USD and is not automatically used to value LP positions.</p><div class="table-wrap"><table><thead><tr><th>Pool</th><th>Pair price</th><th>TVL USD</th><th>24h volume USD</th></tr></thead><tbody id="marketRows"></tbody></table></div></section>
<section><h2>Position & event history</h2><div class="table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Position</th><th>Details</th></tr></thead><tbody id="events"></tbody></table></div></section>
<div class="notice">Values are paper-ledger inputs. This dashboard does not infer LP inventory, accrued fees, or executable costs from pair price. Mark and close values must be entered manually until a validated DLMM valuation model is integrated.</div>
<script>
const $=s=>document.querySelector(s), usd=n=>Number(n).toLocaleString(undefined,{style:'currency',currency:'USD'}), pct=n=>(n>=0?'+':'')+Number(n).toFixed(2)+'%';
async function api(path,options){const r=await fetch(path,options);const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d}
function msg(t){$('#message').textContent=t}
function cell(v){const td=document.createElement('td');td.textContent=v??'—';return td}
async function load(){try{const d=await api('/api/portfolio');const s=d.summary;$('#summary').replaceChildren();[['Initial capital',usd(s.initialCapitalUsd)],['Cash',usd(s.cashUsd)],['Open position value',usd(s.openPositionValueUsd)],['Equity',usd(s.equityUsd)],['Realized PnL',usd(s.realizedPnlUsd)],['Unrealized PnL',usd(s.unrealizedPnlUsd)],['Total PnL',usd(s.totalPnlUsd)],['Return',pct(s.returnPct)]].forEach(([k,v])=>{const c=document.createElement('div');c.className='card';const l=document.createElement('div');l.className='label';l.textContent=k;const val=document.createElement('div');val.className='value';val.textContent=v;val.classList.add(String(v).startsWith('-')?'negative':(k.includes('PnL')||k==='Return')?'positive':'');c.append(l,val);$('#summary').append(c)});
const body=$('#positions');body.replaceChildren();for(const p of d.positions){const tr=document.createElement('tr');tr.append(cell(p.id+' / '+p.poolAddress),cell(usd(p.initialCapitalUsd)),cell(p.entryPoolPrice),cell(usd(p.currentValueUsd)),cell(usd(p.currentValueUsd-p.initialCapitalUsd)));const a=cell('');const row=document.createElement('div');row.className='row';const mark=document.createElement('button');mark.className='secondary';mark.textContent='Mark';mark.onclick=async()=>{const v=prompt('Enter current manually valued position amount (USD):',p.currentValueUsd);if(v===null)return;try{await api('/api/portfolio/mark',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:p.id,value:Number(v)})});await load()}catch(e){msg(e.message)}};const close=document.createElement('button');close.textContent='Close';close.onclick=async()=>{const v=prompt('Enter final manually valued position amount (USD):',p.currentValueUsd);if(v===null)return;try{await api('/api/portfolio/close',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:p.id,value:Number(v)})});await load()}catch(e){msg(e.message)}};row.append(mark,close);a.append(row);tr.append(a);body.append(tr)}
const h=await api('/api/history');const ev=$('#events');ev.replaceChildren();for(const e of h.events.slice().reverse().slice(0,100)){const tr=document.createElement('tr');tr.append(cell(e.at),cell(e.type),cell(e.positionId),cell(JSON.stringify(e)));ev.append(tr)}msg('Updated '+new Date().toLocaleTimeString()+' · state saved locally')}catch(e){msg(e.message)}}
$('#openForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);try{await api('/api/portfolio/open',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:f.get('id'),pool:f.get('pool'),capital:Number(f.get('capital')),entryPrice:Number(f.get('entryPrice'))})});e.target.reset();await load()}catch(err){msg(err.message)}};
$('#refresh').onclick=load;$('#market').onclick=async()=>{try{msg('Fetching read-only Meteora pool data…');const d=await api('/api/market');const b=$('#marketRows');b.replaceChildren();for(const p of d.pools){const tr=document.createElement('tr');tr.append(cell(p.address),cell(p.currentPrice),cell(p.tvlUsd===undefined?'—':usd(p.tvlUsd)),cell(p.volume24hUsd===undefined?'—':usd(p.volume24hUsd)));b.append(tr)}msg('Fetched '+d.pools.length+' pools at '+d.retrievedAt)}catch(e){msg(e.message)}};
load();
</script></body></html>`;

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function authorized(req: IncomingMessage): boolean {
  if (!dashboardUsername || !dashboardPassword) return true;
  const header = req.headers.authorization;
  if (!header?.startsWith("Basic ")) return false;
  let decoded: string;
  try { decoded = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch { return false; }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return safeEqual(decoded.slice(0, separator), dashboardUsername) && safeEqual(decoded.slice(separator + 1), dashboardPassword);
}
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (!authorized(req)) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="DLMM Paper Dashboard", charset="UTF-8"', "cache-control": "no-store" });
      res.end("Authentication required");
      return;
    }
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(page); return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      const health = await getPaperDashboardHealth(store);
      json(res, health.statusCode, health.payload);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/runner-health") {
      const health = await getPaperStrategyRunnerHealth(runnerStatusPath);
      const statusCode = ["stale", "retrying", "stopped", "unhealthy"].includes(health.status) ? 503 : 200;
      json(res, statusCode, health);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/portfolio") {
      json(res, 200, { ...await portfolio.report(), statePath }); return;
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      json(res, 200, await portfolio.history()); return;
    }
    if (req.method === "GET" && url.pathname === "/api/market") {
      const result = await collector.collectPools(30);
      const pools = result.pools.map((pool) => ({ address: pool.address, ...(pool.name ? { name: pool.name } : {}), ...(pool.currentPrice !== undefined ? { currentPrice: pool.currentPrice } : {}), ...(pool.tvlUsd !== undefined ? { tvlUsd: pool.tvlUsd } : {}), ...(pool.volume24hUsd !== undefined ? { volume24hUsd: pool.volume24hUsd } : {}) }));
      json(res, 200, { source: result.source, retrievedAt: result.retrievedAt, pools }); return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/api/portfolio/")) {
      const input = await body(req);
      const action = url.pathname.slice("/api/portfolio/".length);
      const at = new Date().toISOString();
      let result: unknown;
      if (action === "open") result = await portfolio.open({ id: stringField(input,"id"), pool: stringField(input,"pool"), capital: numberField(input,"capital"), entryPrice: numberField(input,"entryPrice"), at });
      else if (action === "mark") result = await portfolio.mark({ id: stringField(input,"id"), value: numberField(input,"value"), at });
      else if (action === "mark-valuation") {
        const valuation = input.valuation;
        if (typeof valuation !== "object" || valuation === null || Array.isArray(valuation)) throw new Error("valuation must be an object");
        const record = valuation as Record<string, unknown>;
        if (typeof record.evidence !== "object" || record.evidence === null || Array.isArray(record.evidence)) throw new Error("valuation.evidence must be an object");
        result = await portfolio.markFromValuation({ id: stringField(input, "id"), valuation: valuation as import("./valuation.js").ValuationResult });
      }
      else if (action === "close") result = await portfolio.close({ id: stringField(input,"id"), value: numberField(input,"value"), at });
      else throw new Error("unsupported portfolio action");
      json(res, 200, { success: true, result }); return;
    }
    json(res, 404, { error: "not found" });
  } catch (error) {
    json(res, 400, { error: error instanceof Error ? error.message : "request failed" });
  }
}

export function startPaperDashboard(options: { host?: string; port?: number } = {}) {
  const dashboardHost = options.host ?? host;
  const dashboardPort = options.port ?? port;
  const dashboardStatePath = statePath;
  if (!Number.isInteger(dashboardPort) || dashboardPort < 1 || dashboardPort > 65535) throw new Error("PAPER_DASHBOARD_PORT must be a valid TCP port");
  const loopbackHosts = new Set(["127.0.0.1", "::1", "localhost"]);
  if (!loopbackHosts.has(dashboardHost) && (!dashboardUsername || !dashboardPassword)) {
    throw new Error("Non-loopback dashboard binding requires PAPER_DASHBOARD_USERNAME and PAPER_DASHBOARD_PASSWORD");
  }
  if ((dashboardUsername && !dashboardPassword) || (!dashboardUsername && dashboardPassword)) {
    throw new Error("Set both PAPER_DASHBOARD_USERNAME and PAPER_DASHBOARD_PASSWORD, or neither");
  }
  const server = createServer((req, res) => { void handle(req, res); });
  server.listen(dashboardPort, dashboardHost, () => {
    console.log(JSON.stringify({ status: "listening", host: dashboardHost, port: dashboardPort, mode: "paper-only", statePath: dashboardStatePath, url: `http://${dashboardHost}:${dashboardPort}` }));
  });
  return server;
}
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1].replace(/\\\\/g, "/")) {
  startPaperDashboard();
}


export type PaperDashboardHealth = {
  statusCode: 200 | 503;
  payload: { status: "ok" | "unhealthy"; mode: "paper-only"; persistence: "ok" | "error"; error?: string };
};

/** Read-only health probe. A missing ledger is healthy for a new paper-only instance. */
export async function getPaperDashboardHealth(ledgerStore: PaperLedgerStore): Promise<PaperDashboardHealth> {
  try {
    await ledgerStore.load();
    return { statusCode: 200, payload: { status: "ok", mode: "paper-only", persistence: "ok" } };
  } catch (error) {
    return {
      statusCode: 503,
      payload: {
        status: "unhealthy",
        mode: "paper-only",
        persistence: "error",
        error: error instanceof Error ? error.message : "paper state could not be loaded"
      }
    };
  }
}
