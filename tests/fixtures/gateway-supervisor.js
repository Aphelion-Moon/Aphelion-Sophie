import { createGatewayObserver } from '../../apps/core/discord/gateway-observer.js';
import { createGatewaySupervisor } from '../../apps/core/discord/gateway-supervisor.js';
import { mapping } from './discord.js';
import { APPLICATION } from './interactions.js';
import { NOW } from './domain.js';

export const SYNTHETIC_GATEWAY_TOKEN = 'synthetic-gateway-token-no-credentials';
export const discoveryResponse = () => ({ url: 'wss://gateway.discord.gg/', shards: 1,
  session_start_limit: { total: 1_000, remaining: 999, reset_after: 86_400_000, max_concurrency: 1 } });
export const settle = () => new Promise(resolve => setImmediate(resolve));

export function manualGatewayClock() {
  let time = NOW, nextId = 1;
  const pending = new Map();
  const timers = {
    setTimeout(callback, ms) { const id = nextId++; pending.set(id, { at: time + ms, callback }); return id; },
    clearTimeout(id) { pending.delete(id); },
  };
  return { clock: () => time, timers, pending,
    async advance(ms) {
      const until = time + ms;
      while (true) {
        const next = [...pending].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > until) break;
        time = next[1].at; pending.delete(next[0]); next[1].callback(); await settle();
      }
      time = until; await settle();
    },
  };
}

export class SimulatedGatewaySocket extends EventTarget {
  readyState = 0;
  bufferedAmount = 0;
  sent = [];
  closeCodes = [];
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  receive(value) { this.raw(JSON.stringify(value)); }
  raw(data) { this.dispatchEvent(new MessageEvent('message', { data })); }
  send(data) { this.sent.push(JSON.parse(data)); }
  close(code) { this.closeCodes.push(code); this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code })); }
  serverClose(code) { this.readyState = 3; this.dispatchEvent(new CloseEvent('close', { code })); }
}

export function supervisorFixture({ journalOverrides = {}, discovery = discoveryResponse(), resume = null } = {}) {
  const time = manualGatewayClock();
  const calls = [], sockets = [], urls = [];
  let checkpoint = resume, status = 'offline', epoch = 0, cursor = resume?.sequence ?? 0, renews = 0;
  let available = true, enabled = true, discoveryCalls = 0;
  const journal = {
    async acquire() { return { lease: {}, resume: checkpoint }; },
    async pause() { status = 'offline'; },
    async identify() { status = 'identifying'; epoch++; checkpoint = null; calls.push({ kind: 'identify' }); },
    async reserveIdentify() { calls.push({ kind: 'reserve' }); return { waitMs: 0 }; },
    async resume() { status = 'resuming'; calls.push({ kind: 'resume' }); return { ...checkpoint }; },
    async ready(_, record) { checkpoint = { ...record }; cursor = record.sequence; status = 'synchronizing'; calls.push({ kind: 'ready' }); },
    async dispatch(_, record) {
      calls.push(record); cursor = record.sequence; checkpoint.sequence = cursor;
      if (record.change.kind === 'guild') available = record.change.available;
      if (status !== 'resuming' || record.change.kind === 'resumed') status = available ? 'current' : 'synchronizing';
      return { duplicate: false };
    },
    async renew() { renews++; },
    async readContinuity() { return status === 'current' ? `synthetic.${epoch}.${cursor}` : null; },
    ...journalOverrides,
  };
  const observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: time.clock });
  const supervisor = createGatewaySupervisor({ observer, token: SYNTHETIC_GATEWAY_TOKEN, clock: time.clock,
    random: () => 0.25, enabled: () => enabled, timers: time.timers,
    transport: { async getGatewayBot() { discoveryCalls++; return structuredClone(discovery); } },
    connect(url) { urls.push(url); const socket = new SimulatedGatewaySocket(); sockets.push(socket); return socket; },
  });
  return { ...time, journal, observer, supervisor, calls, sockets, urls,
    disable() { enabled = false; }, stats: () => ({ renews, discoveryCalls }),
    async start() { const done = supervisor.start('synthetic-worker'); await settle(); return { done }; },
    async hello(index = sockets.length - 1) {
      const socket = sockets[index]; socket.open(); socket.receive({ op: 10, d: { heartbeat_interval: 4_000 } }); await settle(); return socket;
    },
  };
}
