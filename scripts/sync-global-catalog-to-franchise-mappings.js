#!/usr/bin/env node
/**
 * @deprecated This script previously cascaded global inactive state into franchise mappings.
 * Effective availability is now computed dynamically (see utils/catalog_availability_resolver.js).
 * Franchise/partner local preferences are preserved when globals are deactivated.
 *
 * Usage (from help-pr-backend-staging/):
 *   node scripts/sync-global-catalog-to-franchise-mappings.js
 */

console.log(
    'sync-global-catalog-to-franchise-mappings.js is deprecated.\n' +
        'Global deactivation no longer mutates franchise/partner mapping preferences.\n' +
        'Use resolver-based effective availability (catalog_availability_resolver) instead.'
);
process.exit(0);
