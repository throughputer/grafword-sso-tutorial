# Add Grafword as a Single Sign-On to Your Web Application

### This tutorial will walk you through installing Grafword as a Single Sign-On (SSO) into your existing Node.js web application, or using this repo as a starting point for your app.

#### By the end of this guide, your application will allow users to sign in with Grafword in addition to any existing SSO solutions like Google, GitHub, or others.

Grafword login uses OAuth 2.0's **Authorization Code flow with PKCE**
(RFC 6749 + RFC 7636). The whole exchange happens server-to-server - the
browser is only ever redirected between your app and Grafword. There is no
client secret; PKCE is what proves a token exchange came from the same app
that started the login.

[Demo](https://blue.passgraf.com/) - Check out our live demo to see the app in action!

## Prerequisites

- Node.js and npm
- OpenSSL, for generating a local HTTPS certificate.

### Starting from This Repo

### 1. Clone and install

```bash
git clone https://github.com/throughputer/grafword-sso-tutorial.git
cd grafword-sso-tutorial
npm install
```

`npm install` also generates a self-signed HTTPS certificate at
`certs/key.pem` / `certs/cert.pem` (via `scripts/generate-cert.js`). The
server requires HTTPS because:
- Grafword requires an `https://` `redirect_uri`
- session cookies are marked `secure`, so they only work over HTTPS

- Rename `.env.example` to `.env` and fill it in (see "Getting a client_id"
  below before you can fill in `GRAFWORD_CLIENT_ID`/`GRAFWORD_REDIRECT_URI`).

The cert isn't committed to the repo - each clone generates its own. If you
ever need a fresh one (e.g. it expired after a year), run:

```bash
npm run generate-cert
```

- Run:
```bash
npm start
```
- View the application at `https://localhost:3000`.
- Build your app based on this code.
- By default the app talks to Grafword SSO (`https://login.grafword.com`).

## Getting a client_id

Every app that signs in with Grafword has to be registered with Grafword.

1. Find the exact `redirect_uri` your app uses — the full URL of your `GET /callback` route (e.g.
   `https://your-domain.com/callback`). It must be HTTPS.
2. Optional but recommended: your **back-channel logout** URL will be
   (e.g. `https://your-domain.com/backchannel-logout`) if implemented — see "Step 4" below for what this does.
3. Send those URLs to the Grafword team/administrator at info@throughputer.com. They'll register your app and reply to you with a `client_id`.
4. Put that `client_id`, the Grafword server's URL, and your
   `redirect_uri` into your `.env` (see `.env.example`).

## Using Grafword on your Existing App

Or, if you have an existing Node.js web application (e.g., `https://yourApp.com`), follow the steps below.

### Step 1: Set Up the Login Button

Add a link to your existing login page (e.g., `index.html`) for users to log
in with Grafword with full-page redirect.

**`index.html`**

```html
<a id="grafwordLogin" href="/auth/grafword/login">Login with Grafword</a>
```

If `GET /profile` redirects with `?sessionEnded=1` (see
Step 3), you can show the user why they're back on this page instead of
silently landing them here with no explanation:

```html
<p id="sessionEndedMessage" style="display:none;">You've been signed out. Please sign in again.</p>
<a id="grafwordLogin" href="/auth/grafword/login">Login with Grafword</a>

<script>
    // GET /profile (server.js) redirects here with ?sessionEnded=1 when
    // it finds no session - either it expired naturally, or a
    // back-channel logout ended it.
    if (new URLSearchParams(window.location.search).has('sessionEnded')) {
        document.getElementById('sessionEndedMessage').style.display = 'block';
        history.replaceState(null, '', '/');
    }
</script>
```

This repo's own `public/index.html` already includes it.

**Optional**: if your app is stateful (a form in progress, an editor's
in-memory contents, a game, etc.) and you don't want a full-page redirect to
Grafword, you can sign the user in through a popup instead. The main tab never navigates anywhere — only the popup does the login round trip, then signals the main tab and closes itself.

```html
<button id="grafwordLoginPopup">Login with Grafword (keep my place)</button>

<script>
    document.getElementById('grafwordLoginPopup').addEventListener('click', () => {
        // Must be called synchronously inside the click handler, or browsers
        // will block it as an unrequested popup.
        window.open('/auth/grafword/login', 'GrafwordSSO', 'width=500,height=700');
    });

    window.addEventListener('message', (event) => {
        // Only trust messages from this same app - not just any window that
        // happens to have opened one.
        if (event.origin !== window.location.origin) return;
        if (event.data && event.data.grafwordLoginComplete) {
            // App-specific: update whatever UI needs to reflect "now signed in" 
            // Comment out the code below to view and place user data wherever
            // you see fit.
            //const response = await fetch('/api/profile');
            //const user = await response.json();
            // Name = user.name
            // Email = user.email
            // Nothing here forces a reload, so in-memory state (form data,
            // editor contents, etc.) is untouched.
        }
    });
</script>
```

That `fetch('/api/profile')` call is what makes updating the UI in place
actually possible - it's the same endpoint `profile.html` uses in Step 2,
just called directly instead of loading a whole page around it. It's a
session-gated JSON endpoint (see `GET /api/profile` in Step 3) with two
possible responses:
- **Signed in**: `200` with `{"name": "...", "email": "..."}`.
- **Not signed in**: `401` with `{"error": "Not signed in."}`.

So `showSignedInAs` in the snippet above would just read `.name`/`.email`
off that response and write them into the page however your app displays
them - no reload, no navigation, nothing else needed.

This needs one small change on the server side too - `GET /callback`
(Step 3) has to know whether it's finishing a popup login or a normal
full-page one. It doesn't need to be told in advance: instead of always
doing `res.redirect('/profile')` on success, render a tiny page whose script
checks `window.opener` and does the right thing either way:

```javascript
// server.js - /callback, replacing the final res.redirect('/profile')
res.send(`<!DOCTYPE html><html><body><script>
    if (window.opener) {
        // Opened as a popup: tell the main tab we're done and close - no
        // token, just a plain signal.
        window.opener.postMessage({ grafwordLoginComplete: true }, window.location.origin);
        window.close();
    } else {
        // Normal full-page flow: just go to /profile as before.
        window.location.href = '/profile';
    }
</script></body></html>`);
```

The exact same route, code exchange, and session-setting logic serves both
flows — only this last step branches, client-side, on whether a popup
opened it.

One tradeoff worth knowing: some browsers/extensions block popups more
aggressively than plain navigation even when opened correctly inside a
click handler, so it's slightly less reliable across browsers than a
redirect. On mobile, popups often behave like regular tabs anyway, so the
"state preserved" benefit is mainly a desktop thing.

## Step 2: Handle the Profile Page for Grafword Authentication

Your server's `GET /profile` route (Step 3) already checks that a session
exists before serving this page, so `profile.html` just asks the server who's
signed in and displays it.

**`profile.html`**

```html
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <title>Profile Page</title>
    <link rel="stylesheet" href="/style.css">
</head>

<body>
    <div id="profileContent"></div>
    <button id="logoutButton-profile">Logout</button>

    <script>
        async function loadProfile() {
            const response = await fetch('/api/profile');
            if (!response.ok) {
                document.getElementById('profileContent').innerHTML = '<p>Invalid session. Try login again</p>';
                return;
            }
            const user = await response.json();
            document.getElementById('profileContent').innerHTML =
                `<p>Name: ${user.name}</p><p>Email: ${user.email}</p>`;
        }

        window.addEventListener('DOMContentLoaded', function () {
            loadProfile();
            document.getElementById('logoutButton-profile').addEventListener('click', function () {
                window.location.href = '/logout';
            });
        });
    </script>
</body>

</html>
```

## Step 3: Server-Side Code for Hosting the Application

Modify your existing `server` or create a `server.js` file to serve your web
application, drive the PKCE login flow, and receive back-channel logout
notifications:

**`server.js`**

```javascript
const express = require('express');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const session = require('express-session');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Grafword server acting as the identity provider, the client_id Grafword
// issued for this app, and the exact redirect_uri that was registered
// alongside it. See "Getting a client_id" above.
const GRAFWORD_ORIGIN = process.env.GRAFWORD_ORIGIN;
const GRAFWORD_CLIENT_ID = process.env.GRAFWORD_CLIENT_ID;
const GRAFWORD_REDIRECT_URI = process.env.GRAFWORD_REDIRECT_URI;

app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, sameSite: 'lax', maxAge: 86400000 },
}));

// -------- Sign-in with Grafword via Authorization Code + PKCE --------------

// Step A: send the browser to Grafword to log in. Generates a PKCE
// verifier/challenge pair and a random state, stashed in this app's own
// session so /callback can check them.
app.get('/auth/grafword/login', (req, res) => {
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    const state = crypto.randomBytes(16).toString('base64url');

    req.session.pendingLogin = { codeVerifier, state };

    const authorizeUrl = new URL('/authorize', GRAFWORD_ORIGIN);
    authorizeUrl.searchParams.set('client_id', GRAFWORD_CLIENT_ID);
    authorizeUrl.searchParams.set('redirect_uri', GRAFWORD_REDIRECT_URI);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('code_challenge', codeChallenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    authorizeUrl.searchParams.set('state', state);

    res.redirect(authorizeUrl.toString());
});

// Step B: Grafword redirects the browser back here with ?code=&state=.
// Exchange the code for an id_token server-to-server, then start a session
// for this app.
app.get('/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
        return res.status(401).send(`Grafword sign-in failed: ${error_description || error}`);
    }

    const pending = req.session.pendingLogin;
    if (!code || !pending || !state || state !== pending.state) {
        return res.status(400).send('Invalid or expired sign-in attempt. <a href="/">Try again</a>.');
    }
    delete req.session.pendingLogin; // one-time use

    let tokenResponse;
    try {
        const tokenRes = await fetch(`${GRAFWORD_ORIGIN}/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                code,
                redirect_uri: GRAFWORD_REDIRECT_URI,
                client_id: GRAFWORD_CLIENT_ID,
                code_verifier: pending.codeVerifier,
            }),
        });
        if (!tokenRes.ok) {
            console.error('Grafword token exchange failed:', await tokenRes.text());
            return res.status(401).send('Grafword sign-in failed. <a href="/">Try again</a>.');
        }
        tokenResponse = await tokenRes.json();
    } catch (err) {
        console.error('Error exchanging code with Grafword:', err);
        return res.status(500).send('An error occurred while signing in.');
    }

    // Grafword's /oauth/token already verified this id_token's signature
    // server-side before returning it, so it's safe to read its claims
    // here without re-verifying.
    const claimsB64 = tokenResponse.id_token.split('.')[1];
    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString());

    req.session.grafwordUser = { sub: claims.sub, name: claims.name, email: claims.email };
    trackUserSession(claims.sub, req.sessionID); // see Step 4 below

    res.redirect('/profile');
});

app.get('/', (req, res) => {
    if (req.session.grafwordUser) {
        return res.redirect('/profile');
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/profile', (req, res) => {
    if (!req.session.grafwordUser) {
        // Distinguishes "your session ended" from a plain first visit to /
        // (see Step 1's optional index.html addition) - this session could
        // be gone because it naturally expired, or because a back-channel
        // logout destroyed it while the user was on this page.
        return res.redirect('/?sessionEnded=1');
    }
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// profile.html (client-side) hits this to fill in the name/email it
// displays - the session itself never leaves the server.
app.get('/api/profile', (req, res) => {
    if (!req.session.grafwordUser) {
        return res.status(401).json({ error: 'Not signed in.' });
    }
    const { name, email } = req.session.grafwordUser;
    res.json({ name, email });
});

app.get('/logout', (req, res) => {
    const sub = req.session.grafwordUser?.sub;
    if (sub) {
        sessionIdsByUserId.get(sub)?.delete(req.sessionID); // see Step 4 below
    }
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// The cert is generated per-clone by scripts/generate-cert.js rather
// than committed to the repo - every clone gets its own private key.
const certDir = path.join(__dirname, 'certs');
const httpsOptions = {
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    key: fs.readFileSync(path.join(certDir, 'key.pem')),
};

https.createServer(httpsOptions, app).listen(port, () => {
    console.log(`Server running at https://localhost:${port}`);
});
```

## Step 4: Back-Channel Logout (recommended)

When a user signs out of Grafword (or their Grafword session expires),
Grafword tells every app they were signed into to end their session too. This is optional, you can skip it and implement your own session expiry feature.
***Backchannel login*** does not work on localhost.

To implement, copy these into your server.js file:

1. Track which of your own session IDs belong to which Grafword user (`sub`)
   at login time:
   ```javascript
   const sessionIdsByUserId = new Map();

   function trackUserSession(sub, sessionID) {
       if (!sessionIdsByUserId.has(sub)) sessionIdsByUserId.set(sub, new Set());
       sessionIdsByUserId.get(sub).add(sessionID);
   }
   ```
   (Called from `/callback` in Step 3 above, right after the session is set.)

2. Fetch and cache Grafword's public signing key, so you can verify a Logout
   Token's signature:
   ```javascript
   let grafwordJwksCache = null;
   let grafwordJwksCacheAt = 0;
   const GRAFWORD_JWKS_CACHE_MS = 10 * 60 * 1000;

   async function getGrafwordJwks(forceRefresh) {
       if (!forceRefresh && grafwordJwksCache && (Date.now() - grafwordJwksCacheAt) < GRAFWORD_JWKS_CACHE_MS) {
           return grafwordJwksCache;
       }
       const jwksRes = await fetch(`${GRAFWORD_ORIGIN}/.well-known/jwks.json`);
       if (!jwksRes.ok) {
           throw new Error(`Failed to fetch Grafword JWKS: ${jwksRes.status}`);
       }
       const data = await jwksRes.json();
       grafwordJwksCache = data.keys || [];
       grafwordJwksCacheAt = Date.now();
       return grafwordJwksCache;
   }

   async function getGrafwordSigningKey(kid) {
       let keys = await getGrafwordJwks(false);
       let jwk = keys.find(k => k.kid === kid);
       if (!jwk) {
           // Key may have rotated since our cache was populated - refetch once.
           keys = await getGrafwordJwks(true);
           jwk = keys.find(k => k.kid === kid);
       }
       if (!jwk) {
           throw new Error(`No matching Grafword signing key for kid=${kid}`);
       }
       return crypto.createPublicKey({ key: jwk, format: 'jwk' });
   }
   ```

3. Implement the receiving route. Grafword POSTs
   `application/x-www-form-urlencoded` with a `logout_token`:
   ```javascript
   app.post('/backchannel-logout', express.urlencoded({ extended: false }), async (req, res) => {
       const logoutToken = req.body.logout_token;
       if (!logoutToken) {
           return res.status(400).json({ error: 'invalid_request', error_description: 'Missing logout_token.' });
       }

       let claims;
       try {
           const decodedHeader = jwt.decode(logoutToken, { complete: true });
           if (!decodedHeader) throw new Error('Malformed token');
           const publicKey = await getGrafwordSigningKey(decodedHeader.header.kid);
           claims = jwt.verify(logoutToken, publicKey, {
               algorithms: ['RS256'],
               issuer: GRAFWORD_ORIGIN,
               audience: GRAFWORD_CLIENT_ID,
           });
       } catch (err) {
           console.error('Back-channel logout token verification failed:', err.message);
           return res.status(400).json({ error: 'invalid_request', error_description: 'Invalid logout_token.' });
       }

       // Required by the OIDC Back-Channel Logout spec: a Logout Token must
       // carry the backchannel-logout event member and must NOT carry a
       // nonce (that would make it indistinguishable from an id_token).
       if (!claims.events || !claims.events['http://schemas.openid.net/event/backchannel-logout']) {
           return res.status(400).json({ error: 'invalid_request', error_description: 'Missing backchannel-logout event.' });
       }
       if (claims.nonce) {
           return res.status(400).json({ error: 'invalid_request', error_description: 'Logout tokens must not contain a nonce.' });
       }
       if (!claims.sub) {
           return res.status(400).json({ error: 'invalid_request', error_description: 'Missing sub/userID.' });
       }

       // Destroy all sessions for the user identified by claims.sub.
       // This is a back-channel logout, so we don't have a browser
       // session to destroy - we just destroy all sessions for that
       // user on all devices and browsers.
       const sessionIDs = sessionIdsByUserId.get(claims.sub);
       if (sessionIDs) {
           sessionIdsByUserId.delete(claims.sub);
           for (const sid of sessionIDs) {
               req.sessionStore.destroy(sid, (err) => {
                   if (err) console.error(`Failed to destroy session ${sid}:`, err.message);
               });
           }
       }

       res.set('Cache-Control', 'no-store');
       res.sendStatus(200);
   });
   ```

That's the full mechanism — this repo's own `server.js` already includes all
of it, wired together.

## Running it locally

```bash
npm install
npm start
```

This app terminates HTTPS itself, using a self-signed certificate — only
used for the connection between a browser/reverse proxy and this process,
not a publicly-trusted cert. **Both Grafword's `/authorize` and this app's
own session cookie are `Secure`**, which means the browser refuses to send
them over plain `http://` — so this app has to run over HTTPS even for
local testing.

The certificate isn't committed to this repo — every clone generates its
own private key. `npm install` runs `scripts/generate-cert.js`
automatically (via the `postinstall` script in `package.json`), which
writes `certs/key.pem` and `certs/cert.pem` if they don't already exist. If
that step fails (usually because OpenSSL isn't installed or isn't on your
`PATH`), install OpenSSL and run it manually:
```bash
npm run generate-cert
```

#### About the browser warning

The first time you visit, your browser will show a warning like "Your
connection is not private." This is expected — the certificate is
self-signed for local development, not issued by a trusted CA. Click
through it once:

- **Chrome**: "Advanced" → "Proceed to localhost (unsafe)"
- **Firefox**: "Advanced..." → "Accept the Risk and Continue"
- **Safari**: "Show Details" → "visit this website"

If you'd rather avoid that warning entirely, generate a locally-trusted certificate instead with [mkcert](https://github.com/FiloSottile/mkcert), and write it to `certs/cert.pem`/`certs/key.pem` (or point `httpsOptions` in `server.js` wherever you put it).

## Conclusion

By following this tutorial, you've installed Grafword as a Single Sign-On
(SSO) provider into your web application using OAuth 2.0's Authorization
Code flow with PKCE. Users can now securely
log in to your application using Grafword alongside other SSO methods like
Google or GitHub, and (if you implemented Step 4) their sign-out from
Grafword propagates to your app automatically too.

If you run into any issues or have questions about this implementation, feel free to reach out to the Grafword team at info@throughputer.com.
