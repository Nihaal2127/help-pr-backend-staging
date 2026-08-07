const DEFAULT_PARTNER_PLAN_NAME = 'basic';
const PLATINUM_PLAN_NAME = 'platinum';

const AUTO_BASIC_SUBSCRIPTION_NOTES = {
  mobile: 'Auto-assigned on mobile registration',
  web: 'Auto-assigned on web partner create',
};

/** Matches `accessible_screens` page/url for staff and franchise employees. */
const PARTNER_SUBSCRIPTION_SCREEN_MARKERS = [
  'subscription',
  'partner-subscription',
  'partner_subscription',
];

module.exports = {
  DEFAULT_PARTNER_PLAN_NAME,
  PLATINUM_PLAN_NAME,
  AUTO_BASIC_SUBSCRIPTION_NOTES,
  PARTNER_SUBSCRIPTION_SCREEN_MARKERS,
};
