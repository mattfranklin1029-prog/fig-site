// graphMail.js
require("isomorphic-fetch");
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");

function getGraphClient() {
  const credential = new ClientSecretCredential(
    process.env.GRAPH_TENANT_ID,
    process.env.GRAPH_CLIENT_ID,
    process.env.GRAPH_CLIENT_SECRET
  );
  return Client.initWithMiddleware({
    authProvider: {
      getAccessToken: async () => {
        const t = await credential.getToken("https://graph.microsoft.com/.default");
        return t.token;
      }
    }
  });
}

async function sendMailViaGraph({ from, to, replyTo, subject, text }) {
  const client = getGraphClient();
  const payload = {
    message: {
      subject: subject || "Message",
      body: { contentType: "Text", content: text || "" },
      toRecipients: [{ emailAddress: { address: to } }],
      ...(replyTo ? { replyTo: [{ emailAddress: { address: replyTo } }] } : {})
    },
    saveToSentItems: true
  };

  try {
    await client.api(`/users/${encodeURIComponent(from)}/sendMail`).post(payload);
    // Success is 202 No Content from Graph
    return { ok: true };
  } catch (err) {
    // Normalize useful details
    const code = err?.code || err?.statusCode;
    // some SDKs put JSON in err.body; others nest at err.body.error.message
    let detail = err?.message || "";
    try {
      const parsed = typeof err?.body === "string" ? JSON.parse(err.body) : err?.body;
      detail = parsed?.error?.message || detail || JSON.stringify(parsed);
    } catch (_) {}
    return { ok: false, error: `${code || ""} ${detail}`.trim() };
  }
}

module.exports = { sendMailViaGraph };
