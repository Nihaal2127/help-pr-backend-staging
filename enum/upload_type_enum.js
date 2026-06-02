const UploadType = new Map([
    [1, 'partner_document'],
    [2, 'category'],
    [3, 'service'],
    [4, 'user_profile'],
    [5, 'partner_post'],
  ]);

  const getUploadType = (key) => UploadType.get(key) || "";
  const getUploadTypeKey = (value) => {
    for (let [key, val] of UploadType.entries()) {
      if (val === value) return key;
    }
    return null;
  };
  module.exports = {
    getUploadType,
    getUploadTypeKey,
  }