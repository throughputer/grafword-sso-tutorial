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
// alongside it. See README.md for how to get these.
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

// ---------------------------------------------------------------------------
// Back-channel logout receiver: Grafword POSTs a signed Logout Token here
// when a user's Grafword session ends (explicit logout, or session expiry),
// Grafword tells this app to destroy all sessions for that user and log them out.
// ---------------------------------------------------------------------------
const sessionIdsByUserId = new Map();

function trackUserSession(sub, sessionID) {
    // Get the sub (Grafword user ID) from the /callback, allowing Grafword to track 
    // all session IDs for that user on all devices/ browsers they are logged into. 
    if (!sessionIdsByUserId.has(sub)) sessionIdsByUserId.set(sub, new Set());
    sessionIdsByUserId.get(sub).add(sessionID);
}

// Gets Grafword's public signing keys from the JWKS endpoint to verify the Logout Token signature.
let grafwordJwksCache = null;
let grafwordJwksCacheAt = 0;

// Cache 10 minutes to avoid refetching the JWKS on every back-channel logout request.
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

// Resolves a signing key by kid using Node's built-in JWK import
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

// ---------------------------------------------------------------------------
// Sign-in with Grafword via Authorization Code + PKCE.
// ---------------------------------------------------------------------------
// Step 1: send the browser to Grafword to log in. Generates a PKCE
// verifier/challenge pair and a random state, stashed in this app's own
// session so /callback can check them - nothing about them touches the URL.
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

// Step 2: Grafword redirects the browser back to this app with ?code=&state=.
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
    // server-side before returning it
    const claimsB64 = tokenResponse.id_token.split('.')[1];
    const claims = JSON.parse(Buffer.from(claimsB64, 'base64url').toString());

    req.session.grafwordUser = { sub: claims.sub, name: claims.name, email: claims.email };
    trackUserSession(claims.sub, req.sessionID); // For back-channel logout support

    // Serves both the plain full-page flow and the optional popup flow
    res.send(`<!DOCTYPE html><html><body><script>
        if (window.opener) {
            // Opened as a popup: tell the main tab we're done and close -
            // no token, just a plain signal.
            window.opener.postMessage({ grafwordLoginComplete: true }, window.location.origin);
            window.close();
        } else {
            // Normal full-page flow: just go to /profile as before.
            window.location.href = '/profile';
        }
    </script></body></html>`);
});

app.get('/', (req, res) => {
    // index.html checks /api/profile itself and shows signed-in state in
    // place, so this always serves it rather than redirecting to /profile
    // when a session exists - otherwise that check would never get a
    // chance to run.
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/profile', (req, res) => {
    if (!req.session.grafwordUser) {
        // Distinguishes "your session ended" from a plain first visit to /
        // (see public/index.html) - this session could be gone because it
        // naturally expired, or because a back-channel logout destroyed it
        // out from under the user while they were on this page.
        return res.redirect('/?sessionEnded=1');
    }
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// profile.html (client-side) hits this to fill in the name/email it
// displays without exposing the id_token to the browser.
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
        sessionIdsByUserId.get(sub)?.delete(req.sessionID);
    }
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Generated per-clone by scripts/generate-cert.js (runs automatically on
// `npm install`, see package.json "postinstall") rather than committed to
// the repo - every clone of this template gets its own private key.
const certDir = path.join(__dirname, 'certs');
const httpsOptions = {
    cert: fs.readFileSync(path.join(certDir, 'cert.pem')),
    key: fs.readFileSync(path.join(certDir, 'key.pem')),
};

https.createServer(httpsOptions, app).listen(port, () => {
    console.log(`Server running at https://localhost:${port}`);
});
