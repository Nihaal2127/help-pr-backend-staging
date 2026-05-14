/**
 * True if the authenticated user is a direct participant on the order
 * (customer, partner, creator, or assigned employee).
 */
const callerMatchesOrderParticipant = (reqUserId, order) => {
  if (!reqUserId || !order) return false;
  const uid = String(reqUserId);
  const ids = [order.user_id, order.partner_id, order.created_by_id, order.employee_id]
    .filter((x) => x != null)
    .map((x) => String(x));
  return ids.includes(uid);
};

module.exports = { callerMatchesOrderParticipant };
