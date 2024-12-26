const Tesseract = require('tesseract.js');
const Jimp = require('jimp');
const User = require('../models/User');

class VerificationController {
  // Process National ID
  static async processNationalId(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Perform OCR on the uploaded ID
      const { data: { text } } = await Tesseract.recognize(
        req.file.path,
        'eng',
        { logger: m => console.log(m) }
      );

      // Extract relevant information (this is a simple example - you'll need to adapt based on ID format)
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

  // Check profile picture similarity
  static async checkProfilePictureSimilarity(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      // Load the uploaded image
      const uploadedImage = await Jimp.read(req.file.path);
      
      // Get all users with profile pictures
      const users = await User.find({
        'profilePicture.url': { $exists: true },
        _id: { $ne: req.user.id }
      });

      let conflicts = [];

      // Compare with existing profile pictures
      for (const user of users) {
        const existingImage = await Jimp.read(user.profilePicture.url);
        
        // Calculate image similarity (this is a simple example - you might want to use more sophisticated methods)
        const distance = Jimp.distance(uploadedImage, existingImage);
        const similarity = 1 - distance;

        if (similarity > 0.8) { // Threshold for similarity
          conflicts.push({
            userId: user._id,
            similarity: similarity * 100
          });
        }
      }

      if (conflicts.length > 0) {
        res.json({
          success: false,
          conflicts,
          message: 'Similar profile pictures found'
        });
      } else {
        // Save the profile picture if no conflicts
        const user = await User.findByIdAndUpdate(
          req.user.id,
          {
            'profilePicture.url': req.file.path,
            'profilePicture.verified': true
          },
          { new: true }
        );

        res.json({
          success: true,
          message: 'Profile picture uploaded successfully'
        });
      }
    } catch (error) {
      console.error('Error processing profile picture:', error);
      res.status(500).json({ error: 'Error processing profile picture' });
    }
  }
}

module.exports = VerificationController;