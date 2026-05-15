const GENDER_MALE = 'male';
const GENDER_FEMALE = 'female';
const GENDER_OTHER = 'other';

const VALID_GENDER_VALUES = [GENDER_MALE, GENDER_FEMALE, GENDER_OTHER];

const normalizeGender = (value) => {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
  return String(value).trim().toLowerCase();
};

const isValidGender = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return VALID_GENDER_VALUES.includes(normalizeGender(value));
};

const getGenderLabel = (value) => {
  const key = normalizeGender(value);
  if (key === GENDER_MALE) return 'Male';
  if (key === GENDER_FEMALE) return 'Female';
  if (key === GENDER_OTHER) return 'Other';
  return '';
};

module.exports = {
  GENDER_MALE,
  GENDER_FEMALE,
  GENDER_OTHER,
  VALID_GENDER_VALUES,
  normalizeGender,
  isValidGender,
  getGenderLabel,
};
