// Utility function to handle errors
const handleError = (error, res) => {
    console.error('Error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation Error',
        details: error.message,
      });
    }
  
    if (error.name === 'MongoError' && error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate key error',
        details: error.message,
      });
    }
  
    // Generic internal server error
    return res.status(500).json({
      success: false,
      message: 'Internal Server Error',
      details: error.message,
    });
  };
  
  module.exports = {
    handleError,
  };
  