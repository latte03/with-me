// Real-server API smoke test (no UI dependency). Run: node api-smoke.mjs [base]
import crypto from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
let failures = 0;
function check(name, cond, extra = '') {
  if (cond) console.log(`PASS ${name}`);
  else { failures++; console.log(`FAIL ${name} ${extra}`); }
}
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
async function req(method, path, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + path, { method, headers, body: payload });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json().catch(() => null) : await res.arrayBuffer().then(b => Buffer.from(b));
  return { status: res.status, data, headers: res.headers };
}
function op(device, seq, type, payload) {
  return { op_id: uuid(), device_id: device, seq, type, payload, client_created_at: now() };
}

// 1x1 transparent png
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const pngHash = crypto.createHash('sha256').update(PNG).digest('hex');

const devA = uuid(), devB = uuid(), devU2 = uuid();
const fpA = 'Safari|iPhone|402x874|Asia/Shanghai|zh-CN|6|5';
const fpB = 'Chrome|Win32|1440x2560|Asia/Shanghai|zh-CN|16|0';
// bootstrap admin
let r = await req('POST', '/api/auth/bootstrap', { body: { username: 'admin', password: 'pw123456', device_id: devA, device_name: 'smokeA', device_fingerprint: fpA } });
check('bootstrap admin', r.status === 200 && r.data?.user?.is_admin === true, JSON.stringify(r.data));
const tokA = r.data?.token;
// login device B same user
r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'pw123456', device_id: devB, device_name: 'smokeB', device_fingerprint: fpB } });
check('login deviceB', r.status === 200 && !!r.data?.token);
const tokB = r.data?.token;
// 同一台设备换了浏览器存储：新 device_id + 同指纹 → 认回原行，不多出一台设备
r = await req('POST', '/api/auth/login', { body: { username: 'admin', password: 'pw123456', device_id: uuid(), device_name: 'smokeA', device_fingerprint: fpA } });
check('fingerprint re-identity', r.status === 200 && r.data?.device_id === devA, JSON.stringify(r.data));
r = await req('GET', '/api/devices', { token: tokA });
check('no duplicate device row', r.status === 200 && r.data?.length === 2, JSON.stringify(r.data));
// admin create user2 + login
r = await req('POST', '/api/users', { token: tokA, body: { username: 'u2', password: 'pw123456' } });
check('admin create user2', r.status === 200 || r.status === 201, JSON.stringify(r.data));
r = await req('POST', '/api/auth/login', { body: { username: 'u2', password: 'pw123456', device_id: devU2, device_name: 'smokeU2' } });
check('login user2', r.status === 200 && !!r.data?.token);
const tokU2 = r.data?.token;

// role + messages from A
const roleId = uuid();
const m1 = uuid(), m2 = uuid(), m3 = uuid();
let seqA = 0, seqB = 0;
const opsA = [
  op(devA, ++seqA, 'role.create', { id: roleId, name: '随手记', avatar: '✏️', color: '#8b8b8b', pinned: false, hidden: false, created_at: now(), updated_at: now() }),
  op(devA, ++seqA, 'message.create', { id: m1, role_id: roleId, type: 'text', text: '今天灵感不错', attachment_ref: null, side: 'right', todo_done: false, created_at: now(), updated_at: now() }),
  op(devA, ++seqA, 'message.create', { id: m2, role_id: roleId, type: 'todo', text: '买牛奶', attachment_ref: null, side: 'right', todo_done: false, created_at: now(), updated_at: now() }),
];
r = await req('POST', '/api/sync/push', { token: tokA, body: { ops: opsA } });
check('push A', r.status === 200 && r.data?.server_cursor >= 3, JSON.stringify(r.data));
// idempotent re-push
r = await req('POST', '/api/sync/push', { token: tokA, body: { ops: [opsA[0]] } });
check('push idempotent', r.status === 200 && (r.data?.applied?.length === 0 || r.data?.server_cursor === 3), JSON.stringify(r.data));
// B pushes a message + LWW update on m1 (B later wins)
const opsB = [
  op(devB, ++seqB, 'message.create', { id: m3, role_id: roleId, type: 'text', text: '来自B端', attachment_ref: null, side: 'right', todo_done: false, created_at: now(), updated_at: now() }),
  op(devB, ++seqB, 'message.update', { id: m1, updated_at: now(), fields: { text: 'B后写覆盖' } }),
  op(devB, ++seqB, 'todo.set_done', { id: m2, done: true, updated_at: now() }),
];
r = await req('POST', '/api/sync/push', { token: tokB, body: { ops: opsB } });
check('push B', r.status === 200);
// A update m1 earlier-in-array but pushed after B? To test LWW by cursor: push A update now (later cursor) -> A wins
r = await req('POST', '/api/sync/push', { token: tokA, body: { ops: [op(devA, ++seqA, 'message.update', { id: m1, updated_at: now(), fields: { text: 'A最终覆盖' } })] } });
check('push A lww', r.status === 200);
// tombstone m3
r = await req('POST', '/api/sync/push', { token: tokA, body: { ops: [op(devA, ++seqA, 'message.delete', { id: m3, updated_at: now() })] } });
check('push tombstone', r.status === 200);

// pull convergence: both devices pull from 0 see same op set
const pullAll = async (tok) => {
  let cursor = 0, all = [];
  for (;;) {
    const p = await req('GET', `/api/sync/pull?cursor=${cursor}&limit=100`, { token: tok });
    all.push(...(p.data?.ops || []));
    cursor = p.data?.server_cursor ?? cursor;
    if (!p.data?.has_more) break;
  }
  return all;
};
const opsSeenA = await pullAll(tokA);
const opsSeenB = await pullAll(tokB);
check('pull convergence A==B', opsSeenA.length === opsSeenB.length && opsSeenA.length >= 8, `A=${opsSeenA.length} B=${opsSeenB.length}`);
check('pull cursors monotonic', opsSeenA.every((o, i) => i === 0 || o.cursor > opsSeenA[i - 1].cursor));

// export reflects LWW + tombstone + todo
r = await req('GET', '/api/export?format=json', { token: tokA });
const exp = r.data;
const msgs = exp?.messages || [];
const getM = (id) => msgs.find(m => m.id === id);
check('export json 200', r.status === 200 && Array.isArray(msgs));
check('LWW final text', getM(m1)?.text === 'A最终覆盖', JSON.stringify(getM(m1)));
check('todo done', getM(m2)?.todo_done === true, JSON.stringify(getM(m2)));
check('tombstone filtered', !getM(m3), JSON.stringify(msgs.map(m => m.id)));

// isolation: user2 sees nothing
const opsU2 = await pullAll(tokU2);
check('isolation pull empty', opsU2.length === 0, `n=${opsU2.length}`);
r = await req('GET', '/api/search?q=' + encodeURIComponent('灵感'), { token: tokU2 });
check('isolation search empty', r.status === 200 && (r.data?.results || []).length === 0);
r = await req('GET', '/api/export?format=json', { token: tokU2 });
check('isolation export empty', (r.data?.messages || []).length === 0);

// Chinese substring search (admin)
r = await req('GET', '/api/search?q=' + encodeURIComponent('灵感'), { token: tokA });
check('search chinese before lww? (text now overwritten)', r.status === 200); // m1 text overwritten; search '覆盖' instead
r = await req('GET', '/api/search?q=' + encodeURIComponent('覆盖'), { token: tokA });
check('search chinese substring', r.status === 200 && (r.data?.results || []).some(x => x.message_id === m1), JSON.stringify(r.data));

// blob upload + hash mismatch + ownership
const form = new FormData();
form.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
form.append('hash', pngHash);
r = await req('POST', '/api/blobs', { token: tokA, form });
check('blob upload', r.status === 200 && r.data?.hash === pngHash, JSON.stringify(r.data));
const bad = new FormData();
bad.append('file', new Blob([PNG], { type: 'image/png' }), 'p.png');
bad.append('hash', '0'.repeat(64));
r = await req('POST', '/api/blobs', { token: tokA, form: bad });
check('blob hash mismatch rejected', r.status >= 400);
r = await req('GET', `/api/blobs/${pngHash}`, { token: tokA });
check('blob download', r.status === 200 && Buffer.isBuffer(r.data) && r.data.equals(PNG));
r = await req('GET', `/api/blobs/${pngHash}`, { token: tokU2 });
check('blob ownership denied', r.status === 403 || r.status === 404);
r = await req('GET', `/api/blobs/${pngHash}?variant=thumb`, { token: tokA });
check('blob thumb', r.status === 200);

// export md + zip
r = await req('GET', '/api/export?format=md', { token: tokA });
check('export md', r.status === 200 && Buffer.isBuffer(r.data) && r.data.toString('utf8').includes('随手记'));
r = await req('GET', '/api/export?format=zip', { token: tokA });
check('export zip magic', r.status === 200 && Buffer.isBuffer(r.data) && r.data.slice(0, 2).toString() === 'PK');

// me quota
r = await req('GET', '/api/me', { token: tokA });
check('me quota', r.status === 200 && r.data?.quota_bytes > 0 && r.data?.used_bytes >= PNG.length, JSON.stringify(r.data));

// device revoke invalidates token
r = await req('GET', '/api/devices', { token: tokA });
check('devices list', r.status === 200 && Array.isArray(r.data) && r.data.length >= 2);
check('devices fingerprint', Array.isArray(r.data) && r.data.every(d => typeof d.fingerprint === 'string') && !!r.data.find(d => d.id === devA)?.fingerprint);
r = await req('DELETE', `/api/devices/${devB}`, { token: tokA });
check('device revoke', r.status === 200 || r.status === 204);
r = await req('GET', '/api/me', { token: tokB });
check('revoked token rejected', r.status === 401 || r.status === 403);

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);