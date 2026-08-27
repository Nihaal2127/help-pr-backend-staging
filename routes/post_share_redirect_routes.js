const express = require('express');
const path = require('path');

const router = express.Router();

const REDIRECT_HTML = path.join(__dirname, '..', 'public', 'html', 'post_share_redirect.html');

/**
 * Public share landing page for Helppr user-app posts.
 * GET /post/:postId → App Link / custom scheme, else Play/App Store.
 */
router.get('/:postId', (req, res) => {
  const postId = String(req.params.postId || '').trim();
  if (!postId) {
    return res.status(400).type('html').send('<!DOCTYPE html><html><body><p>Invalid share link.</p></body></html>');
  }

  res.set({
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.sendFile(REDIRECT_HTML);
});

module.exports = router;
