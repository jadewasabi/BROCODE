- [ ] Create Vercel serverless API routes (Upstash Redis): /api/signup, /api/login, /api/posts, /api/posts/:id/comment, /api/posts/:id/react
- [x] Add shared frontend JS for auth (store JWT; include Authorization header)

- [ ] Update register.html to POST /api/signup and show “you successfully signed up!” + link to join.html
- [ ] Update join.html to POST /api/login and redirect to timeline.html on success
- [ ] Create timeline.html + timeline.css: post composer (text + optional image), timeline rendering, comment + react UI, and username/post search bar
- [ ] Wire timeline UI to backend endpoints
- [ ] Run a quick local check (optional) to ensure pages load and JS calls match endpoints
- [ ] Document required Vercel environment variables (UPSTASH_REDIS_* and JWT_SECRET)

