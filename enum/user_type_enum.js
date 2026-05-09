const UserType = new Map([
    [1, 'Admin'],
    [2, 'Partner'],
    [3, 'Employee'],
    [4, 'User'],
    [5, 'Super Admin'],
    [6, 'Staff'],
  ]);

  const getUserType = (key) => UserType.get(key) || "";
 
  const getUserTypeKey = (value) => {
    for (let [key, val] of UserType.entries()) {
      if (val === value) return key;
    }
    return null;
  };
  module.exports = {
    getUserType,
    getUserTypeKey,
  }