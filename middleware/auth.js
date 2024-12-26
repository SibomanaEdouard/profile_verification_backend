
const authMiddleware = (req, res, next) => {
    if (req.isAuthenticated()) {
      // User is authenticated, allow them to proceed to the next middleware/route handler
      return next();
    } else {
      // User is not authenticated, send an Unauthorized error
      return res.status(401).json({
        success: false,
        message: "Unauthorized access. Please log in."
      });
    }
  };
  
  module.exports = authMiddleware;
  