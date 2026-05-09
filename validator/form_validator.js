const mongoose = require("mongoose");
const phoneRegex = /^\+?[1-9]\d{1,14}$/; // E.164 format
const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
const urlRegex = /^(https?:\/\/)?([\w.-]+)\.([a-z]{2,6})([\/\w .-]*)*\/?$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateEmail = (email) => {
    if (!email || email.trim() === '') {
        return { valid: false, message: 'Email is required.' };
    }
    if (!emailRegex.test(email)) {
        return { valid: false, message: 'Invalid email format.' };
    }
    return { valid: true };
};

const validatePhoneNumber = (phone_number) => {
    if (!phone_number || phone_number.trim() === '') {
        return { valid: false, message: 'Phone number is required.' };
    }
    if (!phoneRegex.test(phone_number)) {
        return { valid: false, message: 'Invalid phone number format.' };
    }
    return { valid: true };
};

const validatePassword = (password) => {
    if (!password || password.trim() === '') {
        return { valid: false, message: 'Password is required.' };
    }
    if (!passwordRegex.test(password)) {
        return { valid: false, message: 'Password must be at least 8 characters long, contain an uppercase letter, a lowercase letter, a number, and a special character.' };
    }
    return { valid: true };
};

const validateURL = (url) => {
    if (!url || url.trim() === '') {
        return { valid: false, message: 'URL is required.' };
    }
    if (!urlRegex.test(url)) {
        return { valid: false, message: 'Invalid URL format.' };
    }
    return { valid: true, message: '' };
};

const validateObjectId = (id, type) => {

    if (!id || id.trim() === '') {
        return { valid: false, message: `${type} id is required.` };
    } else if (!mongoose.Types.ObjectId.isValid(id)) {
        return { valid: false, message: `Invalid ${type} id.` };
    }
    return { valid: true };
};
const isValidPrice = (price) => {
    const priceNew = parseFloat(price)
    if (priceNew === undefined || priceNew === 0) {
        return { valid: false, message: 'Price is required.' };
    }
    if (priceNew <= 0) {
        return { valid: false, message: 'Price must be greater then 0 required.' };
    }
    return true
};
const isValidPercentage = (price) => {
    const priceNew = parseFloat(price)
    if (priceNew === undefined || priceNew === 0) {
        return { valid: false, message: 'Percentage is required.' };
    }
    if (priceNew < 0 || priceNew > 100) {
        return { valid: false, message: 'Percentage value should be 0 to 100.' };
    }
    return true
};

const isValidCount = (price) => {
    const priceNew = parseFloat(price)
    if (priceNew === undefined || priceNew === 0) {
        return { valid: false, message: 'Count is required.' };
    }
    if (priceNew <= 0) {
        return { valid: false, message: 'Count must be greater then 0 required.' };
    }
    return true
};
module.exports = { validateEmail, validatePhoneNumber, validatePassword, validateURL, isValidPrice, validateObjectId, isValidPercentage, isValidCount };
