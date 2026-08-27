const express = require('express');

const router = express.Router();

const parseFingerprints = () =>
  String(process.env.ANDROID_SHA256_CERT_FINGERPRINTS || '')
    .split(/[,;\n]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);

const jsonHeaders = {
  'Content-Type': 'application/json',
  'Cache-Control': 'public, max-age=3600',
};

const assetLinksHandler = (_req, res) => {
  res.set(jsonHeaders);
  return res.status(200).json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: process.env.ANDROID_PACKAGE_NAME || 'com.helppr',
        sha256_cert_fingerprints: parseFingerprints(),
      },
    },
  ]);
};

const appleAppSiteAssociationHandler = (_req, res) => {
  const teamId = String(process.env.IOS_TEAM_ID || '').trim();
  const bundleId = String(process.env.IOS_BUNDLE_ID || 'com.helppr').trim();
  const appID = teamId ? `${teamId}.${bundleId}` : bundleId;

  res.set(jsonHeaders);
  return res.status(200).json({
    applinks: {
      apps: [],
      details: [
        {
          appID,
          paths: ['/post/*'],
        },
      ],
    },
  });
};

router.get('/assetlinks.json', assetLinksHandler);
router.get('/apple-app-site-association', appleAppSiteAssociationHandler);

module.exports = {
  wellKnownRouter: router,
  appleAppSiteAssociationHandler,
};
