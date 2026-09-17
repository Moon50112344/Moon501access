import { Hono } from "hono";

const app = new Hono();

function generateSessionCode() {
  return Math.floor(
    100000 + Math.random() * 900000
  ).toString();
}

function isValidCode(code) {
  return /^\d{6}$/.test(code);
}

/*
 * /
 *
 * Không có ?code=
 * → tạo session code mới
 *
 * Có ?code=
 * → trả index.html
 */
app.get("/", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");

  if (code && isValidCode(code)) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  const newCode = generateSessionCode();

  if (c.env.SESSIONS) {
    await c.env.SESSIONS.put(
      `session:${newCode}`,
      JSON.stringify({
        code: newCode,
        verified: false,
        createdAt: Date.now()
      }),
      {
        expirationTtl: 900
      }
    );
  }

  url.searchParams.set("code", newCode);

  return c.redirect(url.toString(), 302);
});


/*
 * POST /api/get-code
 *
 * Kiểm tra session hiện tại.
 *
 * Chưa xác minh Linkvertise nên chỉ trả
 * trạng thái pending.
 */
app.post("/api/get-code", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");

  if (!code || !isValidCode(code)) {
    return c.json(
      {
        error: "Invalid session code."
      },
      400
    );
  }

  if (!c.env.SESSIONS) {
    return c.json(
      {
        error: "Session storage is not configured."
      },
      500
    );
  }

  const key = `session:${code}`;
  const session = await c.env.SESSIONS.get(key, "json");

  if (!session) {
    return c.json(
      {
        error: "Session expired or does not exist."
      },
      404
    );
  }

  if (session.verified === true) {
    return c.json({
      success: true,
      redirect: `/?code=${code}`
    });
  }

  /*
   * TODO:
   * Linkvertise verification sẽ được thêm ở đây.
   */

  return c.json({
    success: true,
    status: "pending",
    message: "Verification is required."
  });
});


/*
 * Các API không tồn tại
 */
app.all("/api/*", (c) => {
  return c.json(
    {
      error: "API endpoint not found."
    },
    404
  );
});


/*
 * Các request còn lại:
 * cho Assets xử lý để 404.html hoạt động.
 */
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
