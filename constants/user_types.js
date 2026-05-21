/** Matches models/user.js type field */
const USER_TYPE_ADMIN = 1;
const USER_TYPE_PARTNER = 2;
const USER_TYPE_EMPLOYEE = 3;
const USER_TYPE_CUSTOMER = 4;
const USER_TYPE_SUPER_ADMIN = 5;
const USER_TYPE_STAFF = 6;

const BACKOFFICE_TYPES = new Set([
  USER_TYPE_ADMIN,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
]);

const mapUserTypeToRole = (type) => {
  switch (Number(type)) {
    case USER_TYPE_ADMIN:
      return "admin";
    case USER_TYPE_PARTNER:
      return "partner";
    case USER_TYPE_EMPLOYEE:
      return "employee";
    case USER_TYPE_CUSTOMER:
      return "customer";
    case USER_TYPE_SUPER_ADMIN:
      return "super_admin";
    case USER_TYPE_STAFF:
      return "staff";
    default:
      return "user";
  }
};

module.exports = {
  USER_TYPE_ADMIN,
  USER_TYPE_PARTNER,
  USER_TYPE_EMPLOYEE,
  USER_TYPE_CUSTOMER,
  USER_TYPE_SUPER_ADMIN,
  USER_TYPE_STAFF,
  BACKOFFICE_TYPES,
  mapUserTypeToRole,
};
