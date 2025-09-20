FIG Contact (Microsoft Graph v3) — Quick Start
==============================================

1) Unzip into a clean folder.
2) Run: npm install
3) Copy .env.example to .env and fill in the values (Tenant ID, Client ID, Client Secret, Sender).
4) Start: npm run dev   (or npm start)
5) Visit: http://localhost:3000/contact.html
6) Submit a message; you'll be redirected to /thank-you.html. The email sends via Graph.

If you see 'Unable to send message right now.':
- Rotate GRAPH_CLIENT_SECRET in Entra (App registrations -> Certificates & secrets) and update .env
- Ensure Mail.Send (Application) permission has Admin consent
- Sender mailbox exists and is licensed
