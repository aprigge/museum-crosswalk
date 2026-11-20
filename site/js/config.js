// Where "Ask the graph" sends questions: the Cloudflare Worker that holds the API key.
// Local testing uses `npm run worker:dev`; set DEPLOYED_ASK_URL after `wrangler deploy`.
const DEPLOYED_ASK_URL = 'https://museum-crosswalk-ask.museum-crosswalk.workers.dev/ask';

const local = ['127.0.0.1', 'localhost'].includes(location.hostname);
export const ASK_URL = local ? 'http://127.0.0.1:8787/ask' : DEPLOYED_ASK_URL;
