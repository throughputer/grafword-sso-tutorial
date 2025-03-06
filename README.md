# Add Grafword as a Single Sign On to Your Web Application

### This tutorial will walk you through installing Grafword as a Single Sign-On (SSO) into your existing Node.js web application or using this repo as a starting point for your app. 

#### By the end of this guide, your application will allow users to sign in with Grafword in addition to any existing SSO solutions like Google, Facebook, or others.

Grafword login utilizes "implicit flow", a method of OAuth 2.0. For a successful application login, the id_token will be returned in the protected route(s).

## Prerequisites

These instructions require a Linux-based system with `npm` installed.

### Starting from This Repo

To use this repository:

- Create a copy of this repository on GitHub:
  - Log in to GitHub.
  - From this repository page, click the green "Use this template" button.
- Clone your repo, and `cd` into it.
- Run:
```bash
npm install
npm start
```
- View the application at `http://localhost:3000`.
- Build your app based on this code.

### Using Grafword on your Existing App

Or, if you have an existing Node.js web application (e.g., `https://yourApp.com`), follow the steps below.


## Step 1: Set Up the Login Button

Add a button to your existing login page (e.g., index.html) for users to login with grafword.

**`index.html`**

```html
// Button to start grafword login process
<button id="grafwordLogin">Login with Grafword</button>

<script>
let grafword = "https://login.grafword.com";
// Protected_endpoint to redirect the user
let protected_endpoint = `${window.location.origin}/profile`; 

document.getElementById("grafwordLogin").addEventListener("click", function () {
    let parentUrl = window.location.href;
    // URL to open in the popup of grafword
    const loginUrl = `${grafword}?parentUrl=${encodeURIComponent(parentUrl)}`;

    // Open the popup
    const popup = window.open(
        loginUrl,
        "GrafwordSSO",
        "width=600,height=905"
    );
});

// Listen for the id token from the popup
window.addEventListener("message", (event) => {
    // Validate the origin of the message. It has to come from grafword
    if (event.origin !== grafword) {
        console.error("Invalid origin:", event.origin);
        return;
    }
    // Extract the info from grafword
    const { id_token } = event.data;

    if (id_token) {
        // Redirect to protected route with the id_token as a query parameter
        window.location.href = `${protected_endpoint}?q=${encodeURIComponent(id_token)}`;
    }
    else {
        console.log("No id token found")
    }
});
</script>
```

## Step 2: Handle Profile Page for Grafword Authentication

Upon successful login, the browser is redirected. The code in Step 1 redirects to `/profile`, which you may change as you see fit. The `profile.html` file below extracts the `id_token` from the redirection response (from URL parameters), shares it with the grafword server, and displays the user's name and email on the protected profile page. You can incorporate similar code into your application.

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
        const grafword = "https://login.grafword.com";

        // Function to send user's ID token to grafword.
        async function sendIdToken(idToken) {
            try {
                //This is the endpoint to receive id_token
                let response = await fetch(`${grafword}/userRequests`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ idToken: idToken }),
                });

                if (!response.ok) {
                    throw new Error(`Network response was not ok. Status: ${response.status}, Message: ${errorMessage}`);
                }
                let data = await response.json();
                return data;
            } catch (error) {
                console.error('Error:', error);
            }
        }
        window.addEventListener('DOMContentLoaded', async function () {
            const url = new URL(window.location.href);
            // Get idToken to query param
            const id_token = url.searchParams.get('q');
            if (id_token) {
                // Send user's id token to grafword for parsing and returning user information
                let user = await sendIdToken(id_token);
                let firstname = user.firstname;
                let lastname = user.lastname;
                let email = user.email;

                document.getElementById('profileContent').innerHTML = `<p>Name: ${firstname} ${lastname}</p><p>Email: ${email}</p>`;
                document.getElementById('logoutButton-profile').addEventListener('click', function () {
                    window.location.href = '/';
                });
            }
            else {
                document.getElementById('profileContent').innerHTML = `<p>Invalid session. Try login again</p>`;
            }
        });
    </script>
</body>

</html>

```

## Step 3: Server-Side Code for Hosting the Application

Modify your existing or create a `server.js` file to serve your web application and handle the routing.

**`server.js`**

```javascript
const express = require('express');
const path = require('path');
const session = require('express-session');
const app = express();
const port = 3000;

app.use(express.json()); // Parse JSON bodies

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
