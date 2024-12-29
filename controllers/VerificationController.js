const Tesseract = require('tesseract.js');
// const Jimp = require('jimp');
const User = require('../models/User');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');

class VerificationController {
  static async processNationalId(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Log the received file details
      console.log('Received file:', {
        fieldname: req.file.fieldname,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        path: req.file.path
      });

      // Perform OCR on the uploaded ID
      const { data: { text } } = await Tesseract.recognize(
        req.file.path,
        'eng',
        { logger: m => console.log(m) }
      );

      // Extract relevant information
      const idNumber = text.match(/ID:\s*([A-Z0-9]+)/i)?.[1];
      const dateOfBirth = text.match(/DOB:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1];
      const name = text.match(/Name:\s*([A-Za-z\s]+)/i)?.[1];

      // Update user document
      const user = await User.findByIdAndUpdate(
        req.user.id,
        {
          'nationalId.idNumber': idNumber,
          'nationalId.dateOfBirth': dateOfBirth ? new Date(dateOfBirth) : undefined,
          'nationalId.document': req.file.path,
          'nationalId.verified': true
        },
        { new: true }
      );

      res.json({
        success: true,
        data: {
          idNumber,
          dateOfBirth,
          name
        }
      });
    } catch (error) {
      console.error('Error processing National ID:', error);
      res.status(500).json({ error: 'Error processing National ID' });
    }
  }


 // Generate image signature for comparison
 static async generateImageSignature(imageUrl) {
  try {
    // Download image from Cloudinary URL
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    // Create hash as image signature
    return crypto.createHash('sha256').update(buffer).digest('hex');
  } catch (error) {
    console.error('Error generating image signature:', error);
    throw error;
  }
}

static calculateSimilarity(sig1, sig2) {
  // Existing code remains the same
  let differences = 0;
  const totalBits = sig1.length * 4;
  
  for (let i = 0; i < sig1.length; i++) {
    const byte1 = parseInt(sig1[i], 16);
    const byte2 = parseInt(sig2[i], 16);
    differences += (byte1 ^ byte2).toString(2).replace(/0/g, '').length;
  }
  
  return 100 - (differences * 100 / totalBits);
}

static async checkProfilePictureSimilarity(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Processing uploaded file:', req.file.path);

    // Generate signature for uploaded image
    const uploadedSignature = await VerificationController.generateImageSignature(req.file.path);

    // Get all users with profile pictures
    const users = await User.find({
      'profilePicture.url': { $exists: true },
      _id: { $ne: req.user.id }
    });

    // Check for similar images
    const conflicts = await Promise.all(users.map(async user => {
      try {
        const existingSignature = await VerificationController.generateImageSignature(user.profilePicture.url);
        const similarity = VerificationController.calculateSimilarity(uploadedSignature, existingSignature);

        if (similarity > 85) {
          return {
            userId: user._id,
            username: user.username,
            similarity: similarity.toFixed(2)
          };
        }
      } catch (error) {
        console.error(`Error comparing with user ${user._id}:`, error);
      }
      return null;
    }));

    const validConflicts = conflicts.filter(Boolean);

    if (validConflicts.length > 0) {
      // Store temporary Cloudinary URL
      await User.findByIdAndUpdate(req.user.id, {
        'profilePicture.tempPath': req.file.path
      });

      return res.json({
        success: false,
        conflicts: validConflicts,
        tempPath: req.file.path,
        message: 'Similar profile pictures found'
      });
    }

    // If no conflicts, proceed with upload
    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        'profilePicture.url': req.file.path,
        'profilePicture.verified': true,
        'profilePicture.uploadedAt': new Date()
      },
      { new: true }
    );

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      profilePicture: user.profilePicture
    });

  } catch (error) {
    console.error('Error processing profile picture:', error);
    res.status(500).json({ error: 'Error processing profile picture' });
  }
}


// Handle user's decision about conflict
static async resolveProfilePictureConflict(req, res) {
  try {
    const { action } = req.body;
    const user = await User.findById(req.user.id);
    const tempPath = user.profilePicture?.tempPath;

    if (!tempPath) {
      return res.status(400).json({ error: 'No pending profile picture upload found' });
    }

    if (action === 'proceed') {
      // Update user's profile picture
      const updatedUser = await User.findByIdAndUpdate(
        req.user.id,
        {
          'profilePicture.url': tempPath,
          'profilePicture.verified': true,
          'profilePicture.uploadedAt': new Date(),
          'profilePicture.tempPath': null
        },
        { new: true }
      );

      res.json({
        success: true,
        message: 'Profile picture updated successfully',
        profilePicture: updatedUser.profilePicture
      });
    } else {
      // Cancel upload
      await User.findByIdAndUpdate(req.user.id, {
        'profilePicture.tempPath': null
      });

      res.json({
        success: true,
        message: 'Upload cancelled successfully'
      });
    }
  } catch (error) {
    console.error('Error resolving profile picture conflict:', error);
    res.status(500).json({ error: 'Error resolving profile picture conflict' });
  }
}


// Notify user of similar profile picture upload
static async notifyProfilePictureSimilarity(req, res) {
  try {
    const { userId, similarityDetails } = req.body;

    // Get user details
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Create notification
    const notification = new Notification({
      userId: user._id,
      type: 'PROFILE_PICTURE_SIMILARITY',
      message: 'Someone attempted to upload a profile picture similar to yours',
      data: similarityDetails,
      status: 'unread'
    });

    await notification.save();

    res.json({
      success: true,
      message: 'Notification sent successfully'
    });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Error sending notification' });
  }
}
}

module.exports = VerificationController;