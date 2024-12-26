const express = require('express');
const passport = require('passport');
const multer = require('multer');
const auth = require('../middleware/auth');
const authController = require("../controllers/AuthController")
const verificationController = require("../controllers/VerificationController")

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

// LinkedIn Auth Routes
router.get('/auth/linkedin', passport.authenticate('linkedin'));

router.get('/auth/linkedin/callback',
  passport.authenticate('linkedin', { session: false }),
  (req, res) => {
    const token = authController.generateToken(req.user);
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback?token=${token}`);
  }
);

// Profile Verification Routes
router.post('/verify/national-id',
  auth,
  upload.single('nationalId'),
  verificationController.processNationalId
);

router.post('/verify/profile-picture',
  auth,
  upload.single('profilePicture'),
  verificationController.checkProfilePictureSimilarity
);

// Profile Routes
router.get('/profile',
  auth,
  async (req, res) => {
    try {
      const user = await User.findById(req.user.id).select('-password');
      res.json(user);
    } catch (error) {
      res.status(500).json({ error: 'Error fetching profile' });
    }
  }
);

module.exports = router;