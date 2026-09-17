import { Hono } from "hono";

const app = new Hono();

const SESSION_TTL = 15 * 60; // 15 phút

function generateCode() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);

  return String((array[0] % 900000) + 100000);
}

function validCode(code) {
  return /^\d{6}$/.test(code);
}

/*
 * Tạo session mới
 */
async function createSession(env) {
  const code = generateCode();

  await env.SESSIONS.put(
    `session:${code}`,
    JSON.stringify({
      code,
      verified: false,
      createdAt: Date.now()
    }),
    {
      expirationTtl: SESSION_TTL
    }
  );

  return code;
}


/*
 * GET /
 *
 * Nếu chưa có ?code=
 * → tạo số tự nhiên mới
 * → chuyển thành /?code=123456
 */
app.get("/", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    const newCode = await createSession(c.env);

    url.searchParams.set("code", newCode);

    return c.redirect(url.toString(), 302);
  }

  if (!validCode(code)) {
    return c.env.ASSETS.fetch(
      new Request(new URL("/404.html", c.req.url))
    );
  }

  const session = await c.env.SESSIONS.get(
    `session:${code}`,
    "json"
  );

  if (!session) {
    return c.env.ASSETS.fetch(
      new Request(new URL("/404.html", c.req.url))
    );
  }

  return c.env.ASSETS.fetch(c.req.raw);
});


/*
 * POST /api/get-code
 *
 * Người dùng bấm Get code.
 */
app.post("/api/get-code", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");

  if (!code || !validCode(code)) {
    return c.json(
      {
        ok: false,
        error: "Invalid session code."
      },
      400
    );
  }

  const session = await c.env.SESSIONS.get(
    `session:${code}`,
    "json"
  );

  if (!session) {
    return c.json(
      {
        ok: false,
        error: "Session expired."
      },
      404
    );
  }

  /*
   * Nếu đã xác minh rồi thì không cần
   * đi qua Linkvertise lần nữa.
   */
  if (session.verified === true) {
    return c.json({
      ok: true,
      verified: true,
      code
    });
  }

  /*
   * Linkvertise Target-Link.
   *
   * Sau này đặt URL thật ở:
   * Cloudflare → Variables and Secrets
   *
   * Name:
   * LINKVERTISE_URL
   */
  if (!c.env.LINKVERTISE_URL) {
    return c.json(
      {
        ok: false,
        error: "Linkvertise URL is not configured."
      },
      500
    );
  }

  const linkvertiseUrl = new URL(
    c.env.LINKVERTISE_URL
  );

  /*
   * Gắn session code vào Target-Link.
   */
  linkvertiseUrl.searchParams.set(
    "code",
    code
  );

  return c.json({
    ok: true,
    verified: false,
    redirect: linkvertiseUrl.toString()
  });
});


/*
 * GET /?code=123456&hash=xxxxx
 *
 * Linkvertise redirect về đây sau khi
 * người dùng hoàn thành ad-step.
 */
app.get("/verify", async (c) => {
  const url = new URL(c.req.url);

  const code = url.searchParams.get("code");
  const hash = url.searchParams.get("hash");

  if (!code || !validCode(code) || !hash) {
    return c.json(
      {
        ok: false,
        error: "Missing verification data."
      },
      400
    );
  }

  const session = await c.env.SESSIONS.get(
    `session:${code}`,
    "json"
  );

  if (!session) {
    return c.json(
      {
        ok: false,
        error: "Session expired."
      },
      404
    );
  }

  /*
    * Xác minh hash với Linkvertise. 
   */
  const verifyUrl =
    "https://publisher.linkvertise.com/api/v1/anti_bypassing";

  const response = await fetch(
    `${verifyUrl}?token=${encodeURIComponent(
      c.env.LINKVERTISE_TOKEN
    )}&hash=${encodeURIComponent(hash)}`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    return c.json(
      {
        ok: false,
        error: "Linkvertise verification failed."
      },
      403
    );
  }

  /*
    * Hash hợp lệ. 
272
  đang chờ c.env. SESSIONS.put(  
 Phiên: ${code}`, 
 }.stringify({ 
         ... Phiên họphọp,  
       xác minh minh:  Đúng vậy. vậy., 
       Xác minh tại minh tại:  Ngày.Bây giờ() 
     }), 
     { 
       Tát tántán:  Phiên_ttl.allPhiên_ttl"*", async (c) => { 
      trả  lại c.env. Tài sản.viết tay(c.req.raw);  
   });; 

   /* 
     * Quay lại trang với session code.  
      */     
     Trở      Trở    lạiC..Chuyển  hướng   hướng(
    `/?code=${)(
         phần     
(
});


227
228
229
app.all("/api/*", (c) => {
230
231
232
233
(
tất cả
.
});


  :    
    * Các file còn lại giao cho Assets.  
    * 404.html vẫn hoạt động.  
   */ 
Phiên_ttl
}
)


236
