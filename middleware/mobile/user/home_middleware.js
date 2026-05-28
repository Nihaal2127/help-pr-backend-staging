const validateHomeLocationQuery = (req, res, next) => {
  const location = req.query.location;
  if (location === undefined || location === null || String(location).trim() === '') {
    return res.status(400).json({
      success: false,
      status: 400,
      message: 'Location is required.',
    });
  }
  next();
};

module.exports = {
  validateHomeLocationQuery,
};
