// ============================================================
//  はとのりの BBS Worker
//  /posts 以下のリクエスト → BBS API
//  それ以外 → index.html などの静的ファイルを返す
// ============================================================

const BBS_KEY   = 'posts';
const MAX_POSTS = 100;
const ADMIN_PW  = 'hatoAdmin2025'; // ★必ず自分だけ知ってるパスワードに変更★
const NG_WORDS  = ['死ね', '殺す', '爆破', 'nigger', 'faggot'];

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // プリフライト
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // ===== BBS API (/posts/*) =====
    if (url.pathname.startsWith('/posts')) {

      // GET /posts - 一覧取得
      if (request.method === 'GET' && url.pathname === '/posts') {
        const raw = await env.BBS.get(BBS_KEY);
        const posts = raw ? JSON.parse(raw) : [];
        return json({ posts });
      }

      // POST /posts - 新規投稿
      if (request.method === 'POST' && url.pathname === '/posts') {
        let body;
        try { body = await request.json(); }
        catch { return json({ error: '不正なリクエスト' }, 400); }

        const text = (body.text || '').trim();
        const name = (body.name || '観測者').trim().slice(0, 20) || '観測者';

        if (!text || text.length < 2) return json({ error: 'メッセージが短すぎます' }, 400);
        if (text.length > 300)        return json({ error: '300文字以内で入力してください' }, 400);

        const lc = text.toLowerCase();
        if (NG_WORDS.some(w => lc.includes(w))) return json({ error: 'その内容は投稿できません' }, 400);

        // IPベースのレート制限（60秒）
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const rlKey = `rl_${ip}`;
        const lastPost = await env.BBS.get(rlKey);
        if (lastPost && Date.now() - Number(lastPost) < 60_000) {
          const wait = Math.ceil((60_000 - (Date.now() - Number(lastPost))) / 1000);
          return json({ error: `連投防止: あと${wait}秒待ってください` }, 429);
        }

        const raw = await env.BBS.get(BBS_KEY);
        const posts = raw ? JSON.parse(raw) : [];

        // 同一内容の連投チェック
        if (posts.slice(0, 3).some(p => p.t === text)) {
          return json({ error: '同じ内容の連続投稿はできません' }, 400);
        }

        const entry = {
          id: Math.random().toString(36).slice(2, 10),
          n:  name,
          t:  text,
          d:  new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }),
          ts: Date.now(),
          ng: false,
        };
        posts.unshift(entry);
        await env.BBS.put(BBS_KEY, JSON.stringify(posts.slice(0, MAX_POSTS)));
        await env.BBS.put(rlKey, String(Date.now()), { expirationTtl: 120 });

        return json({ ok: true, post: entry });
      }

      // DELETE /posts/:id - 削除（管理者）
      if (request.method === 'DELETE' && url.pathname.startsWith('/posts/')) {
        if (request.headers.get('X-Admin-Password') !== ADMIN_PW)
          return json({ error: '権限がありません' }, 403);
        const id = url.pathname.split('/')[2];
        const raw = await env.BBS.get(BBS_KEY);
        const posts = raw ? JSON.parse(raw) : [];
        await env.BBS.put(BBS_KEY, JSON.stringify(posts.filter(p => p.id !== id)));
        return json({ ok: true });
      }

      // POST /posts/:id/ng - NGフラグ（管理者）
      if (request.method === 'POST' && url.pathname.endsWith('/ng')) {
        if (request.headers.get('X-Admin-Password') !== ADMIN_PW)
          return json({ error: '権限がありません' }, 403);
        const id = url.pathname.split('/')[2];
        const raw = await env.BBS.get(BBS_KEY);
        const posts = raw ? JSON.parse(raw) : [];
        const post = posts.find(p => p.id === id);
        if (post) post.ng = !post.ng;
        await env.BBS.put(BBS_KEY, JSON.stringify(posts));
        return json({ ok: true, ng: post?.ng });
      }
    }

    // ===== 静的ファイル（index.html等）=====
    return env.ASSETS.fetch(request);
  },
};
