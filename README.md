# Add Grafword as a Single Sign On to Your Web Application

## Overview

This tutorial will walk you through installing Grafword as a Single Sign-On (SSO) into your existing web application via implicit flow. 

By the end of this guide, your application will allow users to sign in with Grafword in addition to any existing SSO solutions like Google, Facebook, or others.

Grafword login utilizes "implicit flow", a method of OAuth 2.0. For successful application login, the user must already be logged into their Grafword account within
their browser window, session, or profile (depending on your browser).
A request URL (authUrl variable in Step 1) makes the login request, and an access token and user information are returned as URL parameters in a redirect response
if successful.

## Prerequisites
- An existing web application (e.g., `https://yourApp.com`) using Node.js.
- Determine a "redirect URI". This is the URL the browser will be redirected to after authentication.
  For example, you may wish the user to land on `https://yourApp.com/profile.html` after authentication.
- Grafword credentials: You will need to request a `client_id` by sending an <a href="mailto:info@throughputer.com?subject=Client%20ID%20Request&body=I%20wish%20to%20request%20a%20client_id%20as%20per%20https://github.com/throughputer/grafword-sso-for-existing-apps.%0A%0AThe%20associated%20redirect%20URI%20should%20be%3A%20https%3A%2F%2F%3Cmy-domain%3E%2F%3Credirect-path%3E
" target="_blank" rel=noopener noreferrer>email to the Grafword team</a>, providing in this email your desired Redirect URI.

## Step 1: Set Up the Login Button
Add a button to your existing login page (e.g., index.html) for users to login with Grafword. Replace `client_id` with the one you receive from Grafword team, and fill in your chosen `redirect_uri`.

```bash
<button id="grafwordLogin">Login with Grafword</button>

<script>
    document.getElementById('grafwordLogin').addEventListener('click', function () {
        var grafwordDomain = "dev-266224.okta.com";
        var redirect_uri = "https://yourApp.com/profile";
        var client_id = "grafword_client_id";
        var state = Math.random().toString(36).substring(2);
        var authUrl = `https://${grafwordDomain}/oauth2/v1/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=id_token%20token&scope=openid%20profile%20email&nonce=your_nonce&state=${state}`;
        window.location.href = authUrl;
    });
</script>
```
This button will direct the browser window to Grafword for authentication and respond with a redirection to the redirect URI. A login ID token will be provided if the user's browser session was 

## Step 2: Handle Profile Page for Grafword Authentication
Upon redirection, your application must handle the response. You could use the below `profile.html` page, replacing the `client_id` and `redirect_uri`, or similarly modify an existing page. Notably, this page does the following to handle the authentication:

  - on document load, extracts the fields of the response (from URL parameters)
  - if successful, extracts and displays the user information (name and email), and provides a logout button
  - if unsuccessful, provides instructions for Grafword session login

```bash
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Profile Page</title>
</head>
<body>
    <div id="profileContent" style="display: none;" class="profile-info"></div>
    <button id="logoutButton" style="display: none;">Logout</button>
    <div id="noToken" class="profile-info" style="display: none;"></div>

    <script>
        window.addEventListener('DOMContentLoaded', function () {
            var hash = window.location.hash.substr(1);
            var params = new URLSearchParams(hash);
            var id_token = params.get('id_token');

            if (id_token) {
                // If there is an ID token, show the profile content and logout button
                document.getElementById('profileContent').style.display = 'block';
                var payload = id_token.split('.')[1];
                var decoded = atob(payload);
                var user_info = JSON.parse(decoded);

                document.getElementById('profileContent').innerHTML = `<p>Name: ${user_info.name}</p><p>Email: ${user_info.email}</p>`;

                document.getElementById('logoutButton').style.display = 'inline-block';
                document.getElementById('logoutButton').addEventListener('click', function () {
                    window.location.href = '/';
                });

            } else {
                // If no token, hide profile content and logout button, show noToken message
                document.getElementById('profileContent').style.display = 'none';  // Hide profile content
                document.getElementById('logoutButton').style.display = 'none';    // Hide logout button
                document.getElementById('noToken').style.display = 'block';        // Show the noToken message

                var grafwordDomain = "dev-266224.okta.com";
                var redirect_uri = "http://yourApp.com/profile";
                var client_id = "grafword_client_id";
                var state = Math.random().toString(36).substring(2)
                document.getElementById('noToken').innerHTML += `Please first login at <a href="https://login.grafword.com" target="_blank"> grafword</a>. Then
                <a href="https://${grafwordDomain}/oauth2/v1/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&response_type=id_token%20token&scope=openid%20profile%20email&prompt=none&nonce=n-0S6_WzA2Mj&state=${state}">continue to your profile page</a>.`;
            }
        });
    </script>
</body>
</html>

```

## Step 3: Server-Side Code for Hosting the Application
Modify your existing or create a `server.js` file to serve your web application and handle the routing. Full `server.js`:
```bash
const express = require('express');
const path = require('path');
const session = require('express-session');

const app = express();
const port = 3000;

// Middleware to serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Session management
app.use(session({ secret: 'your_secret_key', resave: true, saveUninitialized: true }));

// Serve index.html on root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Handle the profile page after authentication
app.get('/profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Start the server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
```

## Conclusion
By following this tutorial, you have successfully installed Grafword as a Single Sign-On (SSO) provider into your existing web application using OAuth 2.0’s implicit flow. Users can now securely log in to your application using Grafword in addition to other SSO methods, such as Google or Facebook.

This setup not only enhances the security and usability of your application but also simplifies user account management by centralizing authentication with Grafword.

If you run into any issues or have questions about this implementation, feel free to reach out to the Grafword team at info@throughputer.com. 
