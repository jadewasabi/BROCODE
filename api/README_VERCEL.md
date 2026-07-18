# Vercel + Upstash Redis Setup (required)

Create the following environment variables in Vercel:

- `https://dynamic-magpie-181882.upstash.io`  (from Upstash)
- `gQAAAAAAAsZ6AAIgcDFmMTc1NWI5NWNkYzc0OWZlYWY1ZjdhNWYwODI5ZjA0OQ` (from Upstash)
- `gQAAAAAAAsZ6AAIgcDFmMTc1NWI5NWNkYzc0OWZlYWY1ZjdhNWYwODI5ZjA0OQ` (any long random string)

Then deploy the `/api/*` routes with Node runtimes.

> Note: This repository currently contains plain HTML/CSS. Vercel will still deploy the API routes as serverless functions, while HTML/CSS are served as static assets.

