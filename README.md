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
in with Grafword with full-page redirect:

```html
<a id="grafwordLogin" href="/auth/grafword/login">Login with Grafword</a>
```

That's the whole login trigger - clicking it hands off to your server's
`/auth/grafword/login` route (Step 3), which drives the rest of the flow.

`public/index.html` contains full redirect login:

- **A session-ended message.** `GET /profile` (Step 3) redirects here with
  `?sessionEnded=1` when it finds no session - either it expired naturally,
  or a back-channel logout ended it (Step 4). The page checks for that query
  param on load and shows an explanation instead of silently landing the
  user back on the login page with no context.
- **An active-session check.** On load, it also calls `GET /api/profile`
  (Step 2) directly. If that comes back `200`, the user is already signed
  in (e.g., revisiting `/` after logging in elsewhere), so the page shows
  their name/email and a Logout button instead of the login link.

**Optional**: If page redirects are undesirable in your use model, this flow
may be utilized in a pop-up (though user experience may be affected by
pop-up blockers). Replace the code in `public/index.html` with the below.

```html
<p id="sessionEndedMessage" style="display:none;">You've been signed out. Please sign in again.</p>
    <button id="grafwordLoginPopup">Login with Grafword</button>

    <div id="userInfo" style="display:none;">
        <p>Name: <span id="userName"></span></p>
        <p>Email: <span id="userEmail"></span></p>
        <button id="logoutButton">Logout</button>
    </div>

    <script>
        // GET /profile (server.js) redirects here with ?sessionEnded=1 when
        // it finds no session - either it expired naturally, or a
        // back-channel logout ended it.
        if (new URLSearchParams(window.location.search).has('sessionEnded')) {
            document.getElementById('sessionEndedMessage').style.display = 'block';
            // Clean the URL so refreshing/sharing the link doesn't keep
            // showing the message.
            history.replaceState(null, '', '/');
        }

        document.getElementById('grafwordLoginPopup').addEventListener('click', () => {
            // Must be called synchronously inside the click handler, or browsers
            // will block it as an unrequested popup.
            window.open('/auth/grafword/login', 'GrafwordSSO', 'width=700,height=900');
        });

        document.getElementById('logoutButton').addEventListener('click', () => {
            window.location.href = '/logout';
        });

        function showSignedInUser(user) {
            document.getElementById('grafwordLoginPopup').style.display = 'none';
            document.getElementById('userName').textContent = user.name;
            document.getElementById('userEmail').textContent = user.email;
            document.getElementById('userInfo').style.display = 'block';
        }

        window.addEventListener('message', async (event) => {
            // Only trust messages from this same app - not just any window that
            // happens to have opened one.
            if (event.origin !== window.location.origin) return;
            if (event.data && event.data.grafwordLoginComplete) {
                const response = await fetch('/api/profile');
                const user = await response.json();
                showSignedInUser(user);
            }
        });

        // Runs immediately to check if the user is already signed in when the page loads.
        (async () => {
            const response = await fetch('/api/profile');
            if (response.ok) {
                showSignedInUser(await response.json());
            }
        })();
</script>
```

That `fetch('/api/profile')` is a session-gated JSON endpoint (see `GET /api/profile` in Step 3) with two possible responses:
- **Signed in**: `200` with `{"name": "...", "email": "..."}`.
- **Not signed in**: `401` with `{"error": "Not signed in."}`.

The snippet above reads `.name`/`.email` off that response and writes them
into the page, filling in `#userName`/`#userEmail`,
and revealing the logout button - no reload, no navigation.

One tradeoff worth knowing: some browsers/extensions block popups more
aggressively than plain navigation even when opened correctly inside a
click handler, so it's slightly less reliable across browsers than a
redirect. On mobile, popups often behave like regular tabs anyway, so the
"state preserved" benefit is mainly a desktop thing.

## Step 2: Handle the Profile Page for Grafword Authentication for non-pop-up

Your server's `GET /profile` route (Step 3) already checks that a session
exists before serving this page, so `profile.html` just asks the server who's
signed in and displays it.

See `public/profile.html` in this repo for the exact code.
- On load, it calls `GET /api/profile` (the same endpoint Step 1's
  active-session check uses) and fills `#profileContent` with the
  name/email from the response - or an "Invalid session" message if it
  comes back `401`.

## Step 3: Server-Side Code for Hosting the Application

Modify your existing `server` or create a `server.js` file to serve your web
application, drive the PKCE login flow, and receive back-channel logout
notifications.

See `server.js` in this repo for the exact code. Its shape:

- **Setup**: reads `GRAFWORD_ORIGIN`/`GRAFWORD_CLIENT_ID`/`GRAFWORD_REDIRECT_URI`
  from `.env`, serves `public/` as static files, and configures
  `express-session` with a `Secure` cookie (required - see "About the
  browser warning" below for why this app runs over HTTPS even locally).
- **`GET /auth/grafword/login`**: generates a PKCE verifier/challenge pair
  and a random `state`, stashes them in this app's own session, and
  redirects the browser to Grafword's `/authorize` with them. This is
  where Step 1's login link/button sends the user.
- **`GET /callback`**: Grafword redirects here with `?code=&state=`. Checks
  `state` against what was stashed, then exchanges `code` for an
  `id_token` server-to-server via Grafword's `/oauth/token` - the token
  itself never touches the browser or the URL. Reads `sub`/`name`/`email`
  out of the (already Grafword-verified) `id_token` claims into
  `req.session.grafwordUser`, calls `trackUserSession()` (Step 4) so a
  future back-channel logout can find this session, then finishes with a
  small HTML response that either closes the popup and messages the
  opener, or redirects the full page to `/profile`.
- **`GET /`**: always serves `public/index.html` regardless of session
  state, rather than redirecting signed-in users to `/profile` - that
  page's own `GET /api/profile`.
- **`GET /profile`**: redirects to `/?sessionEnded=1` if there's no
  session (naturally expired, or ended by a back-channel logout - Step 4),
  otherwise serves `public/profile.html` (Step 2).
- **`GET /api/profile`**: the session-gated JSON endpoint both `index.html`
  and `profile.html` call - `200` with `{name, email}`, or `401` if not
  signed in.
- **`GET /logout`**: stops tracking this session for its user (Step 4) and
  destroys it.

## Step 4: Back-Channel Logout (recommended)

When a user signs out of Grafword (or their Grafword session expires),
Grafword tells every app they were signed into to end their session too. This is optional, you can skip it and implement your own session expiry feature.

**Grafword can't reach a `redirect_uri`/back-channel logout URL on
`localhost`**. Test this against a domain Grafword can
actually reach, not `localhost`.

This repo's own `server.js` already includes the full implementation,
wired together - use it as your reference. It's three pieces:

1. **Track which of your own session IDs belong to which Grafword user
   (`sub`)**, via a `Map` from `sub` to a `Set` of session IDs, added to at
   login time. `trackUserSession()` is called from `/callback` (Step 3)
   right after the session is set.

2. **Fetch and cache Grafword's public signing key** from
   `GET /.well-known/jwks.json`, so a Logout Token's signature can be
   verified without a shared secret. Cached for 10 minutes; if a `kid`
   isn't found in the cache (e.g. Grafword rotated its key), it refetches
   once before giving up.

3. **The receiving route**, `POST /backchannel-logout`. Grafword posts
   `application/x-www-form-urlencoded` with a `logout_token` - a JWT whose
   signature gets verified against the cached key, then checked against
   the OIDC Back-Channel Logout spec's requirements: it must carry a
   `sub`, an `events` claim with the
   `http://schemas.openid.net/event/backchannel-logout` member, and must
   **not** carry a `nonce` (that would make it indistinguishable from an
   `id_token`). Any of those failing gets a `400`. Once verified, it looks
   up every session tracked for that `sub` and destroys them via
   `req.sessionStore.destroy()` - not a browser-session action, since this
   request comes from Grafword's server, not the user's browser.

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
