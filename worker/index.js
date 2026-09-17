import { Hono } from "hono";

const app = new Hono();

function generateCode() {
  return crypto.randomInt
    ? crypto.randomInt(100000, 999999)
    : Math.floor(100000 + Math.random() * 900000);
}

// Trang /
app.get("/", async (c) => {
  const url = new URL(c.req.url);
  const code = url.searchParams.get("code");

  // Đã có session code
  if (code && /^\d+$/.test(code)) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  // Chưa có code → tạo code mới
  const newCode = generateCode();

  const redirectUrl = new URL(c.req.url);
  redirectUrl.searchParams.set("code", newCode);

  return c.redirect(redirectUrl.toString(), 302);
});

export default app;
