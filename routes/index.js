const express = require('express');
const passport = require('passport');
const multer = require('multer');
const auth = require('../middleware/auth');
const authController = require("../controllers/AuthController");
const verificationController = require("../controllers/VerificationController");
const User = require('../models/User');
const axios = require('axios')
const { v4: uuidv4 } = require('uuid');
const fs = require('fs')
const { body, validationResult } = require('express-validator');


const router = express.Router();

// Create a module-level Map for temporary codes
const tempCodes = new Map();

// Cleanup function for expired codes
const cleanupExpiredCodes = () => {
    for (const [code, data] of tempCodes.entries()) {
        if (data.expires < Date.now()) {
            tempCodes.delete(code);
        }
    }
};

// Run cleanup every 5 minutes
setInterval(cleanupExpiredCodes, 5 * 60 * 1000);

// Ensure the uploads folder exists
const uploadsDir = 'uploads';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '-' + file.originalname);
  }
});


const upload = multer({ storage: storage });


// LinkedIn Auth Routes
router.get('/auth/linkedin', (req, res, next) => {
    console.log('Starting LinkedIn authentication');
    passport.authenticate('linkedin', {
        state: true,
        scope: ['openid', 'profile','email']
    })(req, res, next);
});


// this is the callback route
router.get('/auth/linkedin/callback',
    (req, res, next) => {
        console.log('LinkedIn callback received');
        passport.authenticate('linkedin', { session: false }, async (err, user, info) => {
            if (err) {
                console.error('Authentication error:', err);
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=auth_failed`);
            }
            if (!user) {
                console.error('No user found');
                return res.redirect(`${process.env.FRONTEND_URL}/login?error=no_user`);
            }
            
            // Generate a temporary code using UUID
            const tempCode = uuidv4();
            
            // Store the code with the user data
            tempCodes.set(tempCode, {
                user,
                expires: Date.now() + 5 * 60 * 1000 // 5 minutes expiry
            });
            console.log("The generated temp code ",tempCode)
            // Clean up expired codes
            for (const [code, data] of tempCodes.entries()) {
                if (data.expires < Date.now()) {
                    tempCodes.delete(code);
                }
            }
            
            res.redirect(`${process.env.FRONTEND_URL}/auth/callback?code=${tempCode}`);
        })(req, res, next);
    }
);

// This is the end point for the code exchange 
router.post('/auth/exchange-code', async (req, res) => {
    try {
        const { code } = req.body;
        
        const codeData = tempCodes.get(code);
        if (!codeData || codeData.expires < Date.now()) {
            tempCodes.delete(code);
            return res.status(400).json({ error: 'Invalid or expired code' });
        }
        
        // Delete the code immediately after retrieving it
        tempCodes.delete(code);
        
        const { user } = codeData;
        const token = authController.generateToken(user);
        console.log("token : ",token)
        
        // Make sure token is being generated correctly
        if (!token) {
            return res.status(500).json({ error: 'Failed to generate token' });
        }
        console.log("The generated token ",token)
        
        res.json({
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name
            }
        });
        console.log("The user is : ",user)
    } catch (error) {
        console.error('Code exchange error:', error);
        res.status(500).json({ error: 'Failed to exchange code' });
    }
});

router.get('/auth/me', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password');
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
        console.log("The response ", res.data)
    } catch (error) {
        console.error('Auth check error:', error);
        res.status(500).json({ error: 'Error checking authentication status' });
    }
});


// national Verification Route
router.post(
    '/verify/national-id',
    auth,
    upload.single('nationalId'),
    (req, res, next) => {
      console.log('Processing national ID');
      verificationController.processNationalId(req, res, next);
    }
  );


// Profile Routes
router.get('/profile',
    auth,
    async (req, res) => {
        try {
            const user = await User.findById(req.user.id).select('-password');
            if (!user) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(user);
        } catch (error) {
            console.error('Profile fetch error:', error);
            res.status(500).json({ error: 'Error fetching profile' });
        }
    }
);

// This is the validation middleware 
const validateProfileUpdate = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty if provided'),
  body('email').optional().trim().isEmail().withMessage('Invalid email format'),
  // Education validation
  body('education').optional().isArray(),
  body('education.*.institution').optional().trim().notEmpty()
    .withMessage('Institution name cannot be empty if provided'),
  body('education.*.degree').optional().trim().notEmpty()
    .withMessage('Degree cannot be empty if provided'),
  body('education.*.fieldOfStudy').optional().trim().notEmpty()
    .withMessage('Field of study cannot be empty if provided'),
  body('education.*.startDate').optional()
    .custom((value) => {
      if (value && !isNaN(new Date(value).getTime())) {
        return true;
      }
      throw new Error('Invalid start date format');
    }),
  body('education.*.endDate').optional()
    .custom((value, { req, path }) => {
      if (!value) return true; // Allow empty end date
      if (isNaN(new Date(value).getTime())) {
        throw new Error('Invalid end date format');
      }
      const index = parseInt(path.split('.')[1]);
      const startDate = req.body.education[index]?.startDate;
      if (startDate && new Date(value) < new Date(startDate)) {
        throw new Error('End date must be after start date');
      }
      return true;
    }),
  
  // Work experience validation
  body('workExperience').optional().isArray(),
  body('workExperience.*.company').optional().trim().notEmpty()
    .withMessage('Company name cannot be empty if provided'),
  body('workExperience.*.position').optional().trim().notEmpty()
    .withMessage('Position cannot be empty if provided'),
  body('workExperience.*.startDate').optional()
    .custom((value) => {
      if (value && !isNaN(new Date(value).getTime())) {
        return true;
      }
      throw new Error('Invalid start date format');
    }),
  body('workExperience.*.endDate').optional()
    .custom((value, { req, path }) => {
      if (!value) return true; // Allow empty end date
      if (isNaN(new Date(value).getTime())) {
        throw new Error('Invalid end date format');
      }
      const index = parseInt(path.split('.')[1]);
      const startDate = req.body.workExperience[index]?.startDate;
      if (startDate && new Date(value) < new Date(startDate)) {
        throw new Error('End date must be after start date');
      }
      return true;
    })
];

// Update profile endpoint
router.put('/profile', 
  auth,
  validateProfileUpdate,
  async (req, res) => {
    try {
      // Check for validation errors
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('Validation errors:', errors.array());
        return res.status(400).json({
          message: 'Validation failed',
          errors: errors.array()
        });
      }

      const { name, email, education, workExperience } = req.body;
      
      // Log the received data for debugging
      console.log('Received profile update:', {
        name,
        email,
        educationCount: education?.length,
        workExperienceCount: workExperience?.length
      });

      // Find user and check if exists
      const user = await User.findById(req.user.id);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }

      // Only update fields that are provided
      if (name !== undefined) user.name = name;
      if (email !== undefined) {
        // Check if email is being changed and if it's already in use
        if (email !== user.email) {
          const emailExists = await User.findOne({ email, _id: { $ne: req.user.id } });
          if (emailExists) {
            return res.status(400).json({ message: 'Email already in use' });
          }
        }
        user.email = email;
      }
      
      // Update arrays only if they are provided
      if (Array.isArray(education)) {
        user.education = education.map(edu => ({
          institution: edu.institution || '',
          degree: edu.degree || '',
          fieldOfStudy: edu.fieldOfStudy || '',
          startDate: edu.startDate || null,
          endDate: edu.endDate || null
        }));
      }

      if (Array.isArray(workExperience)) {
        user.workExperience = workExperience.map(work => ({
          company: work.company || '',
          position: work.position || '',
          startDate: work.startDate || null,
          endDate: work.endDate || null
        }));
      }

      user.updatedAt = new Date();

      // Save the updated user
      await user.save();

      // Return updated user without sensitive information
      const updatedUser = await User.findById(req.user.id)
        .select('-password -__v');
        
      console.log('Profile updated successfully');
      
      res.json({
        message: 'Profile updated successfully',
        user: updatedUser
      });

    } catch (error) {
      console.error('Profile update error:', error);
      res.status(500).json({ 
        message: 'Error updating profile',
        error: error.message 
      });
    }
});

// Verification Status Endpoint
router.get('/verification/status', auth, async (req, res) => {
    try {
      const user = await User.findById(req.user.id).select('-password');
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
  
      // Fetch verification details from the user object or related database
      const verificationDetails = {
        linkedInVerified: user.linkedInVerified || true,
        idVerified: user.nationalId.verified,
        pictureVerified: user.profilePicture.verified,
        details: {
          name: user.name,
          email: user.email,
          nationalId: user.nationalId,
          updatedAt: user.updatedAt,
        },
      };
      console.log("The verification details : ",verificationDetails)
  
      // Return verification details
      res.json(verificationDetails);
    } catch (error) {
      console.error('Verification status error:', error);
      res.status(500).json({ error: 'Failed to fetch verification status' });
    }
  });

  router.post(
    '/verify/profile-picture',
    auth,
    upload.single('profilePicture'),
    verificationController.checkProfilePictureSimilarity
  );
  
  router.post(
    '/verify/profile-picture/resolve-conflict',
    auth,
    verificationController.resolveProfilePictureConflict
  );
  
  router.post('/profile-picture/notify-similarity',
    auth,
    verificationController.notifyProfilePictureSimilarity
  );

  // This is the endpoint to delete the user account
router.delete('/delete-account', auth, async (req, res) => {
  try {
      const userId = req.user.id; 

      // Find and delete the user from the database
      const user = await User.findByIdAndDelete(userId);

      if (!user) {
          return res.status(404).json({ message: 'User not found' });
      }

      console.log(`User with ID ${userId} has been deleted`);

      res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
      console.error('Account deletion error:', error);
      res.status(500).json({ message: 'Failed to delete account', error: error.message });
  }
});

  

module.exports = router;