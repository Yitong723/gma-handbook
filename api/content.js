// 共享内容接口：GET 取最新正文，PUT 用口令保存。
// 内容存 Vercel Blob，不走 git，所以保存是即时的、不触发重新部署。
import { put, list } from '@vercel/blob';

// 一个接口服务多本册子：?doc=handbook（总册，默认）/ ?doc=about（介绍资料·我们）
const DOCS = {
  handbook: 'handbook/body.json',
  about: 'about/body.json'
};

function keyOf(req) {
  const doc = String((req.query && req.query.doc) || 'handbook');
  return DOCS[doc] || null;
}

async function readCurrent(KEY) {
  const { blobs } = await list({ prefix: KEY, limit: 1 });
  if (!blobs.length) return null;
  const r = await fetch(blobs[0].url + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) return null;
  return await r.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const KEY = keyOf(req);
  if (!KEY) return res.status(400).json({ error: '未知的 doc' });

  if (req.method === 'GET') {
    const cur = await readCurrent(KEY);
    if (!cur) return res.status(204).end();          // 还没人改过，用页面自带的原稿
    return res.status(200).json(cur);
  }

  if (req.method === 'PUT') {
    if (!process.env.EDIT_PASS) {
      return res.status(500).json({ error: '服务端未配置口令' });
    }
    if (req.headers['x-edit-pass'] !== process.env.EDIT_PASS) {
      return res.status(401).json({ error: '口令不对' });
    }
    const body = req.body;
    if (!body || typeof body.html !== 'string' || body.html.length < 200) {
      return res.status(400).json({ error: '内容为空或异常，已拒绝保存' });
    }

    // 轮流改也可能撞车：如果服务器上的版本比这次编辑所基于的版本新，
    // 说明别人在这期间存过，拒绝覆盖，让前端提示「先加载最新版」。
    const cur = await readCurrent(KEY);
    if (cur && typeof body.baseAt === 'number' && cur.at > body.baseAt) {
      return res.status(409).json({ error: '有人刚改过', at: cur.at, by: cur.by || '' });
    }

    const payload = {
      html: body.html,
      by: String(body.by || '').slice(0, 40),
      at: Date.now()
    };
    await put(KEY, JSON.stringify(payload), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true
    });
    return res.status(200).json({ ok: true, at: payload.at, by: payload.by });
  }

  res.status(405).json({ error: 'method not allowed' });
}
