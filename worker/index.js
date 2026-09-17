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
 *
 * Nếu có ?code=...&hash=...
 * → xác minh hash với Linkvertise
 */
app.get("/", async (c) => {
  const url = new URL(c.req.url);

  const code = url.searchParams.get("code");
  const hash = url.searchParams.get("hash");

  /*
   * Không có code:
   * tạo session mới.
   */
  if (!code) {
    const newCode = await createSession(c.env);

    url.searchParams.set("code", newCode);
    url.searchParams.delete("hash");

    return c.redirect(url.toString(), 302);
  }

  /*
   * Code không hợp lệ.
   */
  if (!validCode(code)) {
    return c.env.ASSETS.fetch(
      new Request(new URL("/404.html", c.req.url))
    );
  }

  /*
   * Lấy session.
   */
  const session = await c.env.SESSIONS.get(
    `session:${code}`,
    "json"
  );

  if (!session) {
    return c.env.ASSETS.fetch(
      new Request(new URL("/404.html", c.req.url))
    );
  }

  /*
   * Nếu Linkvertise redirect về với hash,
   * tiến hành xác minh.
   */
  if (hash) {
    /*
     * Kiểm tra token trước khi gọi API.
     */
    if (!c.env.LINKVERTISE_TOKEN) {
      return c.json(
        {
          ok: false,
          error: "Linkvertise token is not configured."
        },
        500
      );
    }

    const verifyUrl =
      "https://publisher.linkvertise.com/api/v1/anti_bypassing";

    let response;

    try {
      response = await fetch(
        `${verifyUrl}?token=${encodeURIComponent(
          c.env.LINKVERTISE_TOKEN
        )}&hash=${encodeURIComponent(hash)}`,
        {
          method: "POST"
        }
      );
    } catch {
      return c.json(
        {
          ok: false,
          error: "Unable to contact Linkvertise."
        },
        502
      );
    }

    /*
     * Hash không hợp lệ hoặc đã hết hạn.
     */
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
     * Đánh dấu session đã xác minh.
     */
    await c.env.SESSIONS.put(
      `session:${code}`,
      JSON.stringify({
        ...session,
        verified: true,
        verifiedAt: Date.now()
      }),
      {
        expirationTtl: SESSION_TTL
      }
    );

    /*
     * Xóa hash khỏi URL sau khi xác minh.
     */
    return c.redirect(
      `/?code=${encodeURIComponent(code)}`,
      302
    );
  }

  /*
   * Không có hash:
   * chỉ trả trang giao diện.
   */
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

  /*
   * Kiểm tra code.
   */
  if (!code || !validCode(code)) {
    return c.json(
      {
        ok: false,
        error: "Invalid session code."
      },
      400
    );
  }

  /*
   * Lấy session.
   */
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
   * Nếu session đã xác minh,
   * không cần đi qua Linkvertise lần nữa.
   */
  if (session.verified === true) {
    return c.json({
      ok: true,
      verified: true,
      code
    });
  }

  /*
   * Kiểm tra Linkvertise URL.
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

  /*
   * Tạo URL Linkvertise.
   */
  const linkvertiseUrl = new URL(
    c.env.LINKVERTISE_URL
  );

  /*
   * Gắn session code.
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
 * GET /verify
 *
 * Giữ endpoint này để tương thích nếu
 * Linkvertise được cấu hình Target-Link
 * tới /verify.
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

  if (!c.env.LINKVERTISE_TOKEN) {
    return c.json(
      {
        ok: false,
        error: "Linkvertise token is not configured."
      },
      500
    );
  }

  const verifyUrl =
    "https://publisher.linkvertise.com/api/v1/anti_bypassing";

  let response;

  try {
    response = await fetch(
      `${verifyUrl}?token=${encodeURIComponent(
        c.env.LINKVERTISE_TOKEN
      )}&hash=${encodeURIComponent(hash)}`,
      {
        method: "POST"
      }
    );
  } catch {
    return c.json(
      {
        ok: false,
        error: "Unable to contact Linkvertise."
      },
      502
    );
  }

  if (!response.ok) {
    return c.json(
      {
        ok: false,
        error: "Linkvertise verification failed."
      },
      403
    );
  }

  await c.env.SESSIONS.put(
    `session:${code}`,
    JSON.stringify({
      ...session,
      verified: true,
      verifiedAt: Date.now()
    }),
    {
      expirationTtl: SESSION_TTL
    }
  );

  return c.redirect(
    `/?code=${encodeURIComponent(code)}`,
    302
  );
});

/*
 * Các API endpoint không tồn tại.
 */
app.all("/api/*", (c) => {
  return c.json(
    {
      ok: false,
      error: "API endpoint not found."
    },
    404
  );
});

/*
 * Các file còn lại giao cho Assets.
 * 404.html vẫn hoạt động.
 */
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
