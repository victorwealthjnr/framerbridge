// Tiny HTTP -> Framer Server API bridge for n8n.
// Framer's Server API is a WebSocket-based npm package (framer-api), not a plain REST endpoint,
// so n8n calls this service and this service talks to Framer.
//
// Env vars:
//   FRAMER_PROJECT_URL   e.g. https://framer.com/projects/Your-Site--abc123
//   FRAMER_API_KEY       created in Framer site settings
//   BRIDGE_TOKEN         shared secret; n8n sends it as "Authorization: Bearer <token>"
//   FRAMER_FIELD_MAP     optional JSON to override Framer field names, e.g. {"body":"Post Content"}
//   PORT                 default 3000
import express from 'express';
import { connect } from 'framer-api';

const { FRAMER_PROJECT_URL, FRAMER_API_KEY, BRIDGE_TOKEN, PORT = 3000 } = process.env;
const FIELD_NAMES = {
  title: 'Title', excerpt: 'Excerpt', body: 'Content',
  metaTitle: 'Meta Title', metaDescription: 'Meta Description',
  ...JSON.parse(process.env.FRAMER_FIELD_MAP || '{}'),
};

const app = express();
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/publish', async (req, res) => {
  if (!BRIDGE_TOKEN || req.get('authorization') !== `Bearer ${BRIDGE_TOKEN}`) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  const { collection, slug, title, excerpt, contentHtml, metaTitle, metaDescription, publish } = req.body;
  let framer;
  try {
    framer = await connect(FRAMER_PROJECT_URL, FRAMER_API_KEY); // key is a plain string, not {apiKey}
    const collections = await framer.getCollections();
    const col = collections.find((c) => c.name === collection);
    if (!col) throw new Error(`Collection "${collection}" not found`);

    const fields = await col.getFields();
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    const values = { title, excerpt, body: contentHtml, metaTitle, metaDescription };
    const fieldData = {};
    for (const [key, value] of Object.entries(values)) {
      const field = byName[FIELD_NAMES[key]];
      if (!field || value == null) continue; // skip fields your collection doesn't have
      fieldData[field.id] = field.type === 'formattedText'
        ? { type: 'formattedText', value, contentType: 'html' }
        : { type: field.type, value };
    }

    await col.addItems([{ slug, draft: !publish, fieldData }]);

    if (publish) {
      const result = await framer.publish();
      await framer.deploy(result.deployment.id);
    }
    res.json({ ok: true, published: Boolean(publish) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: String(err.message || err) });
  } finally {
    if (framer) await framer.disconnect();
  }
});

app.listen(PORT, () => console.log(`framer-bridge listening on ${PORT}`));
