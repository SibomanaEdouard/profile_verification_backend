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
        // console.log("The user is ", user)
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


// // this is the profile picture
// router.post('/verify/profile-picture',
//     auth,
//     upload.single('profilePicture'),
//     (req, res, next) => {
//         console.log('Processing profile picture');
//         verificationController.checkProfilePictureSimilarity(req, res, next);
//     }
// );

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
        idVerified: user.idVerified || false,
        pictureVerified: user.pictureVerified || false,
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
  

module.exports = router;