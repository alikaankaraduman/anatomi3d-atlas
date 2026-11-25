// Küçük CDP istemcisi: başsız Edge'e bağlanır, sayfada JS çalıştırır (yalnız yerel test için).
import fs from 'node:fs';
const PORT = +process.env.CDP_PORT || 9333;   // başka bir başsız Edge 9333'teyse: CDP_PORT=9334
export async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('no page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map(); const events = [];
  ws.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.id) { const p = pending.get(d.id); pending.delete(d.id); if (d.error) p.rej(new Error(JSON.stringify(d.error))); else p.res(d.result); }
    else events.push(d);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shot = async file => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); };
  const errors = () => events.filter(e => e.method === 'Runtime.exceptionThrown' || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error'))
    .map(e => e.method === 'Runtime.exceptionThrown' ? 'EXC ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text).slice(0, 300)
      : e.method === 'Log.entryAdded' ? 'LOG ' + e.params.entry.text.slice(0, 300) + ' ' + (e.params.entry.url || '')
      : 'CON ' + e.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  return { send, evalJs, events, errors, sleep, shot, close: () => ws.close() };
}
