const express = require('express');
const path = require('path');

const router = express.Router();

const REDIRECT_HTML = path.join(__dirname, '..', 'public', 'html', 'post_share_redirect.html');

/**
 * Public share landing page for Helppr user-app posts.
 * GET /post/:token → try helppr://post/:token, else Play/App Store.
 */
router.get('/:token', (req, res) => {
  const token = String(req.params.token || '').trim();
  if (!token) {
    return res.status(400).type('html').send('<!DOCTYPE html><html><body><p>Invalid share link.</p></body></html>');
  }

  res.set({
    'Cache-Control': 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  });
  return res.sendFile(REDIRECT_HTML);
});

module.exports = router;
