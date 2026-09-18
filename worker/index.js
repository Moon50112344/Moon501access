import { Hono } from "hono";

const app = new Hono();

const SESSION_TTL = 15 * 60; // 15 minutes
const COOKIE_NAME = "moon_activation_code";

function validCode(code) {
  return /^\d{6}$/.test(code);
}

function generateCode() {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);

  return String((array[0] % 900000) + 100000);
}

function generateActivationKey() {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  const array = new Uint32Array(16);

  crypto.getRandomValues(array);

  let raw = "";

  for (const value of array) {
    raw += chars[value % chars.length];
  }

  return raw.match(/.{4}/g).join("-");
}

function getCookie(request, name) {
  const cookieHeader = request.headers.get("Cookie");

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";");

  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");

    if (separator === -1) {
      continue;
    }

    const key = cookie
      .slice(0, separator)
      .trim();

    const value = cookie
      .slice(separator + 1)
      .trim();

    if (key === name) {
      return decodeURIComponent(value);
    }
  }

  return null;
}

function createCodeCookie(code) {
  return [
    `${COOKIE_NAME}=${encodeURIComponent(code)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL}`
  ].join("; ");
}

function clearCodeCookie() {
  return [
    `${COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=0"
  ].join("; ");
}

async function createSession(env, code) {
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
}

async function createRandomSession(env) {
  let code;

  do {
    code = generateCode();

    const existing =
      await env.SESSIONS.get(
        `session:${code}`
      );

    if (!existing) {
      break;
    }
  } while (true);

  await createSession(env, code);

  return code;
}

async function createActivationKey(
  env,
  session,
  code
) {
  if (session?.activationKey) {
    return session.activationKey;
  }

  let activationKey;

  do {
    activationKey =
      generateActivationKey();

    const existing =
      await env.SESSIONS.get(
        `key:${activationKey}`
      );

    if (!existing) {
      break;
    }
  } while (true);

  await env.SESSIONS.put(
    `key:${activationKey}`,
    JSON.stringify({
      key: activationKey,
      code,
      createdAt: Date.now()
    }),
    {
      expirationTtl: SESSION_TTL
    }
  );

  return activationKey;
}

async function verifyLinkvertiseHash(
  env,
  hash
) {
  if (!env.LINKVERTISE_TOKEN) {
    return {
      ok: false,
      status: 500,
      error:
        "Linkvertise token is not configured."
    };
  }

  const verifyUrl =
    "https://publisher.linkvertise.com/api/v1/anti_bypassing";

  try {
    const response = await fetch(
      `${verifyUrl}?token=${encodeURIComponent(
        env.LINKVERTISE_TOKEN
      )}&hash=${encodeURIComponent(hash)}`,
      {
        method: "POST"
      }
    );

    if (!response.ok) {
      return {
        ok: false,
        status: 403,
        error:
          "Linkvertise verification failed."
      };
    }

    return {
      ok: true
    };
  } catch {
    return {
      ok: false,
      status: 502,
      error:
        "Unable to contact Linkvertise."
    };
  }
}

/*
 * Main website route.
 */
app.get("/", async (c) => {
  const url = new URL(c.req.url);

  const code =
    url.searchParams.get("code");

  const hash =
    url.searchParams.get("hash");

  /*
   * Linkvertise returns only:
   *
   * ?hash=...
   *
   * The activation code is recovered
   * from the secure session cookie.
   */
  if (hash && !code) {
    const cookieCode =
      getCookie(
        c.req.raw,
        COOKIE_NAME
      );

    if (
      !cookieCode ||
      !validCode(cookieCode)
    ) {
      return c.json(
        {
          ok: false,
          error:
            "Activation session could not be found."
        },
        400
      );
    }

    const session =
      await c.env.SESSIONS.get(
        `session:${cookieCode}`,
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

    const verification =
      await verifyLinkvertiseHash(
        c.env,
        hash
      );

    if (!verification.ok) {
      return c.json(
        {
          ok: false,
          error: verification.error
        },
        verification.status
      );
    }

    const activationKey =
      await createActivationKey(
        c.env,
        session,
        cookieCode
      );

    await c.env.SESSIONS.put(
      `session:${cookieCode}`,
      JSON.stringify({
        ...session,
        verified: true,
        activationKey,
        verifiedAt: Date.now()
      }),
      {
        expirationTtl: SESSION_TTL
      }
    );

    /*
     * Remove the hash from the URL.
     * Keep the activation code.
     */
    return new Response(null, {
      status: 302,
      headers: {
        Location:
          `/?code=${encodeURIComponent(
            cookieCode
          )}`,
        "Set-Cookie":
          createCodeCookie(cookieCode)
      }
    });
  }

  /*
   * No code:
   * create a new activation session.
   */
  if (!code) {
    const newCode =
      await createRandomSession(
        c.env
      );

    return new Response(null, {
      status: 302,
      headers: {
        Location:
          `/?code=${encodeURIComponent(
            newCode
          )}`,
        "Set-Cookie":
          createCodeCookie(newCode)
      }
    });
  }

  /*
   * Validate activation code.
   */
  if (!validCode(code)) {
    return c.env.ASSETS.fetch(
      new Request(
        new URL(
          "/404.html",
          c.req.url
        )
      )
    );
  }

  /*
   * Get session.
   */
  let session =
    await c.env.SESSIONS.get(
      `session:${code}`,
      "json"
    );

  /*
   * Create session if necessary.
   */
  if (!session) {
    await createSession(
      c.env,
      code
    );

    session = {
      code,
      verified: false,
      createdAt: Date.now()
    };
  }

  /*
   * Keep the current code in the cookie.
   */
  const response =
    await c.env.ASSETS.fetch(
      c.req.raw
    );

  response.headers.append(
    "Set-Cookie",
    createCodeCookie(code)
  );

  return response;
});

/*
 * Request an activation code.
 */
app.post(
  "/api/get-code",
  async (c) => {
    const url =
      new URL(c.req.url);

    let code =
      url.searchParams.get(
        "code"
      );

    /*
     * If no code was supplied,
     * recover it from the cookie.
     */
    if (!code) {
      code =
        getCookie(
          c.req.raw,
          COOKIE_NAME
        );
    }

    if (
      !code ||
      !validCode(code)
    ) {
      return c.json(
        {
          ok: false,
          error:
            "Invalid activation session."
        },
        400
      );
    }

    let session =
      await c.env.SESSIONS.get(
        `session:${code}`,
        "json"
      );

    if (!session) {
      await createSession(
        c.env,
        code
      );

      session = {
        code,
        verified: false,
        createdAt: Date.now()
      };
    }

    /*
     * Already verified.
     */
    if (
      session.verified === true
    ) {
      return c.json({
        ok: true,
        verified: true,
        code,
        activationKey:
          session.activationKey ||
          null
      });
    }

    /*
     * Linkvertise URL required.
     */
    if (!c.env.LINKVERTISE_URL) {
      return c.json(
        {
          ok: false,
          error:
            "Linkvertise URL is not configured."
        },
        500
      );
    }

    /*
     * Create Linkvertise URL.
     *
     * The code is NOT required to be
     * returned by Linkvertise.
     * It is stored in the cookie.
     */
    const linkvertiseUrl =
      new URL(
        c.env.LINKVERTISE_URL
      );

    linkvertiseUrl.searchParams.set(
      "code",
      code
    );

    return new Response(
      JSON.stringify({
        ok: true,
        verified: false,
        redirect:
          linkvertiseUrl.toString()
      }),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json",
          "Set-Cookie":
            createCodeCookie(code)
        }
      }
    );
  }
);

/*
 * Compatibility verification endpoint.
 */
app.get(
  "/verify",
  async (c) => {
    const url =
      new URL(c.req.url);

    let code =
      url.searchParams.get(
        "code"
      );

    const hash =
      url.searchParams.get(
        "hash"
      );

    if (!code) {
      code =
        getCookie(
          c.req.raw,
          COOKIE_NAME
        );
    }

    if (
      !code ||
      !validCode(code) ||
      !hash
    ) {
      return c.json(
        {
          ok: false,
          error:
            "Missing verification data."
        },
        400
      );
    }

    const session =
      await c.env.SESSIONS.get(
        `session:${code}`,
        "json"
      );

    if (!session) {
      return c.json(
        {
          ok: false,
          error:
            "Session expired."
        },
        404
      );
    }

    const verification =
      await verifyLinkvertiseHash(
        c.env,
        hash
      );

    if (!verification.ok) {
      return c.json(
        {
          ok: false,
          error:
            verification.error
        },
        verification.status
      );
    }

    const activationKey =
      await createActivationKey(
        c.env,
        session,
        code
      );

    await c.env.SESSIONS.put(
      `session:${code}`,
      JSON.stringify({
        ...session,
        verified: true,
        activationKey,
        verifiedAt: Date.now()
      }),
      {
        expirationTtl: SESSION_TTL
      }
    );

    return c.redirect(
      `/?code=${encodeURIComponent(
        code
      )}`,
      302
    );
  }
);

/*
 * Return activation key.
 */
app.get(
  "/api/key",
  async (c) => {
    const url =
      new URL(c.req.url);

    let code =
      url.searchParams.get(
        "code"
      );

    if (!code) {
      code =
        getCookie(
          c.req.raw,
          COOKIE_NAME
        );
    }

    if (
      !code ||
      !validCode(code)
    ) {
      return c.json(
        {
          ok: false,
          error:
            "Invalid activation session."
        },
        400
      );
    }

    const session =
      await c.env.SESSIONS.get(
        `session:${code}`,
        "json"
      );

    if (!session) {
      return c.json(
        {
          ok: false,
          error:
            "Session expired."
        },
        404
      );
    }

    if (
      session.verified !== true
    ) {
      return c.json(
        {
          ok: false,
          error:
            "Activation session has not been verified."
        },
        403
      );
    }

    if (!session.activationKey) {
      return c.json(
        {
          ok: false,
          error:
            "Activation key not found."
        },
        404
      );
    }

    return c.json({
      ok: true,
      key:
        session.activationKey
    });
  }
);

/*
 * Unknown API endpoints.
 */
app.all(
  "/api/*",
  (c) => {
    return c.json(
      {
        ok: false,
        error:
          "API endpoint not found."
      },
      404
    );
  }
);

/*
 * Static assets and other routes.
 */
app.all(
  "*",
  async (c) => {
    return c.env.ASSETS.fetch(
      c.req.raw
    );
  }
);

export default app;
