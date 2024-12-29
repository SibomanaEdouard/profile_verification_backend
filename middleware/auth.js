
// const authMiddleware = (req, res, next) => {
//     if (req.isAuthenticated()) {
//       // User is authenticated, allow them to proceed to the next middleware/route handler
//       return next();
//     } else {
//       // User is not authenticated, send an Unauthorized error
//       return res.status(401).json({
//         success: false,
//         message: "Unauthorized access. Please log in to continue."
//       });
//     }
//   };
  
//   module.exports = authMiddleware;


const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
    try {
        // Get token from header
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({ 
                success: false, 
                message: 'No authentication token provided' 
            });
        }

        // Extract token (remove "Bearer " prefix)
        const token = authHeader.replace('Bearer ', '');
        
        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Find user
        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({ 
                success: false, 
                message: 'User not found' 
            });
        }

        // Attach user and token to request object
        req.user = user;
        req.token = token;
        
        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        return res.status(401).json({
            success: false,
            message: 'Please authenticate properly'
        });
    }
};

module.exports = authMiddleware;
  