FIG Contact (Microsoft Graph) — Quick Start
==========================================

1) Copy files into your project root so you have:
   - server.js
   - public/contact.html
   - public/thank-you.html
   - public/404.html

2) Create .env using .env.example values.

3) Install deps:
   npm i express helmet compression morgan express-rate-limit express-validator @azure/identity @microsoft/microsoft-graph-client isomorphic-fetch

4) Run:
   node server.js      (or npm run dev)

5) Test:
   - Open http://localhost:3000/contact.html
   - Submit the form. You should be redirected to /thank-you.html
   - Email should arrive in GRAPH_TO_EMAIL; a copy is in Sent Items for GRAPH_SENDER.

If you see 'Unable to send message right now.':
   - Rotate GRAPH_CLIENT_SECRET in Entra (App registrations -> Certificates & secrets)
   - Ensure Mail.Send (Application) permission has Admin consent
   - Sender mailbox exists and is licensed
