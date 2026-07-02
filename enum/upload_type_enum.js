const UploadType = new Map([
  [1, "partner_document"],
  [2, "category"],
  [3, "service"],
  [4, "user_profile"],
  [5, "partner_post"],
  [6, "order_work_proof"],
  [7, "chat_attachment"],
]);

const UPLOAD_TYPE_PARTNER_DOCUMENT = 1;
const UPLOAD_TYPE_CATEGORY = 2;
const UPLOAD_TYPE_SERVICE = 3;
const UPLOAD_TYPE_USER_PROFILE = 4;
const UPLOAD_TYPE_PARTNER_POST = 5;
const UPLOAD_TYPE_ORDER_WORK_PROOF = 6;
const UPLOAD_TYPE_CHAT_ATTACHMENT = 7;

const getUploadType = (key) => UploadType.get(Number(key)) || "";

const getUploadTypeKey = (value) => {
  for (const [key, val] of UploadType.entries()) {
    if (val === value) return key;
  }
  return null;
};

const isValidUploadType = (key) => UploadType.has(Number(key));

const isPrivateUploadType = (key) => Number(key) === UPLOAD_TYPE_PARTNER_DOCUMENT;

module.exports = {
  UploadType,
  UPLOAD_TYPE_PARTNER_DOCUMENT,
  UPLOAD_TYPE_CATEGORY,
  UPLOAD_TYPE_SERVICE,
  UPLOAD_TYPE_USER_PROFILE,
  UPLOAD_TYPE_PARTNER_POST,
  UPLOAD_TYPE_ORDER_WORK_PROOF,
  UPLOAD_TYPE_CHAT_ATTACHMENT,
  getUploadType,
  getUploadTypeKey,
  isValidUploadType,
  isPrivateUploadType,
};
