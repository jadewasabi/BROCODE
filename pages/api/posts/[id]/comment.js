import orig from '../../../../../api/posts-comment.js';

export default function handler(req, res) {
  // Inject postId from the URL parameter into the request body
  if (req.query && req.query.id) {
    req.body = req.body || {};
    req.body.postId = req.query.id;
  }
  return orig(req, res);
}

