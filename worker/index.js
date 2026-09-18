import { Hono } from "hono";

const app = new Hono();

const SESSION_TTL = 15 * 60; // 15 minutes

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

    const existing = await env.SESSIONS.get(
      `session:${code}`
    );

    if (!existing) {
      break;
    }
  } while (true);

  await createSession(env, code);

  return code;
}

async function verifyLinkvertiseHash(env, hash) {
  if (!env.LINKVERTISE_TOKEN) {
    return {
      ok: false,
      status: 500,
      error: "Linkvertise token is not configured."
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
        error: "Linkvertise verification failed."
      };
    }

    return {
      ok: true
    };
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Unable to contact Linkvertise."
    };
  }
}

async function createActivationKey(env, session, code) {
  if (session?.activationKey) {
    return session.activationKey;
  }

  let activationKey;

  do {
    activationKey = generateActivationKey();

    const existing = await env.SESSIONS.get(
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

/*
 * Main website route.
 */
app.get("/", async (c) => {
  const url = new URL(c.req.url);

  const code = url.searchParams.get("code");
  const hash = url.searchParams.get("hash");

  /*
   * No activation code:
   * create a random session and redirect to it.
   */
  if (!code) {
    const newCode = await createRandomSession(c.env);

    return c.redirect(
      `/?code=${encodeURIComponent(newCode)}`,
      302
    );
  }

  /*
   * Validate activation code.
   */
  if (!validCode(code)) {
    return c.env.ASSETS.fetch(
      new Request(
        new URL("/404.html", c.req.url)
      )
    );
  }

  /*
   * Get the session.
   */
  let session = await c.env.SESSIONS.get(
    `session:${code}`,
    "json"
  );

  /*
   * Create the session if it does not exist.
   */
  if (!session) {
    await createSession(c.env, code);

    session = {
      code,
      verified: false,
      createdAt: Date.now()
    };
  }

  /*
   * Linkvertise returns:
   *
   * ?code=123456&hash=...
   */
  if (hash) {
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

    /*
     * Generate an activation key.
     */
    const activationKey =
      await createActivationKey(
        c.env,
        session,
        code
      );

    /*
     * Mark the session as verified.
     */
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

    /*
     * Remove the hash from the URL.
     */
    return c.redirect(
      `/?code=${encodeURIComponent(code)}`,
      302
    );
  }

  /*
   * Serve the website.
   */
  return c.env.ASSETS.fetch(c.req.raw);
});

/*
 * Request an activation code.
 */
app.post("/api/get-code", async (c) => {
  const url = new URL(c.req.url);

  const code = url.searchParams.get("code");

  /*
   * Validate the activation code.
   */
  if (!code || !validCode(code)) {
    return c.json(
      {
        ok: false,
        error: "Invalid activation session."
      },
      400
    );
  }

  /*
   * Get the session.
   */
  let session = await c.env.SESSIONS.get(
    `session:${code}`,
    "json"
  );

  /*
   * Create the session if it does not exist.
   */
  if (!session) {
    await createSession(c.env, code);

    session = {
      code,
      verified: false,
      createdAt: Date.now()
    };
  }

  /*
   * Already verified.
   */
  if (session.verified === true) {
    return c.json({
      ok: true,
      verified: true,
      code,
      activationKey: session.activationKey || null
    });
  }

  /*
   * Linkvertise URL is required.
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
   * Create the Linkvertise redirect URL.
   */
  const linkvertiseUrl =
    new URL(c.env.LINKVERTISE_URL);

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
 * Compatibility verification endpoint.
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

  /*
   * Generate an activation key.
   */
  const activationKey =
    await createActivationKey(
      c.env,
      session,
      code
    );

  /*
   * Mark the session as verified.
   */
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
    `/?code=${encodeURIComponent(code)}`,
    302
  );
});

/*
 * Return the activation key for a verified session.
 */
app.get("/api/key", async (c) => {
  const url = new URL(c.req.url);

  const code = url.searchParams.get("code");

  if (!code || !validCode(code)) {
    return c.json(
      {
        ok: false,
        error: "Invalid activation session."
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

  if (session.verified !== true) {
    return c.json(
      {
        ok: false,
        error: "Activation session has not been verified."
      },
      403
    );
  }

  if (!session.activationKey) {
    return c.json(
      {
        ok: false,
        error: "Activation key not found."
      },
      404
    );
  }

  return c.json({
    ok: true,
    key: session.activationKey
  });
});

/*
 * Handle unknown API endpoints.
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
 * Serve static assets and other website routes.
 */
app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
